import "server-only";
import {
  fetchHistorical,
  fetchQuotesBatch,
  fetchFlowOrMock,
  computeTech,
} from "./providers";
import { getConsensusBundle } from "./providers/consensusCache";
import { isKrStock } from "./providers/naver";
import { fetchIntradayBars, isKrMarketOpen } from "./providers/naverIntraday";
import {
  fetchEventsForSymbol,
  getMacroEventsCached,
} from "./providers/eventCalendar";
import {
  analyze,
  predict,
  assessVolatility,
  computeIntradayMetrics,
} from "./analyzer";
import {
  assessDataQuality,
  applyThinHistoryAnalysisGate,
  applyThinHistoryPredictionGate,
} from "./analyzer/dataQuality";
import { getAnalysisCache, saveAnalysisCache } from "./analysisCache";
import {
  PRIMARY_SYMBOLS,
  RECOMMENDATION_SCREEN_POOL,
} from "./symbols";
import type { EventItem, SymbolMeta, StockSnapshot } from "./types";

/** 크론 대상 — PRIMARY 3 + 추천 스크리닝 풀 (~66종) 중복 제거. */
export function getCronAnalysisSymbols(): SymbolMeta[] {
  const byCode = new Map<string, SymbolMeta>();
  for (const m of PRIMARY_SYMBOLS) byCode.set(m.code, m);
  for (const m of RECOMMENDATION_SCREEN_POOL) byCode.set(m.code, m);
  return [...byCode.values()];
}

export interface HourlyRefreshResult {
  refreshed: number;
  errors: Record<string, string>;
  symbols: string[];
  cachedAt: number;
}

/** 경량 재분석 — quote+history+predict 중심. KIS 호출 최소(수급 1회/종목). */
export async function runHourlyAnalysisRefresh(): Promise<HourlyRefreshResult> {
  const symbols = getCronAnalysisSymbols();
  const errors: Record<string, string> = {};
  const cachedAt = Date.now();
  let refreshed = 0;

  // 매크로 시계열 — 풀당 1회만 (종목 루프 밖)
  const [
    nasdaqHistory,
    fxHistory,
    ixicHistory,
    kospiHistory,
    soxHistory,
    dxyHistoryPrimary,
    us10yHistory,
  ] = await Promise.all([
    fetchHistorical("NQ=F", 90).catch(() => []),
    fetchHistorical("KRW=X", 90).catch(() => []),
    fetchHistorical("^IXIC", 90).catch(() => []),
    fetchHistorical("^KS11", 90).catch(() => []),
    fetchHistorical("^SOX", 90).catch(() => []),
    fetchHistorical("DX-Y.NYB", 90).catch(() => []),
    fetchHistorical("^TNX", 90).catch(() => []),
  ]);
  const dxyHistory =
    dxyHistoryPrimary.length >= 30
      ? dxyHistoryPrimary
      : await fetchHistorical("DX=F", 90).catch(() => []);

  const vixHist = await fetchHistorical("^VIX", 5).catch(() => []);
  const vix =
    vixHist.length > 0
      ? vixHist[vixHist.length - 1].close
      : null;

  const macroEvents = getMacroEventsCached();

  // 동시성 4 — KIS rate limit 보호
  const BATCH = 4;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (meta) => {
        try {
          await refreshOneSymbol(meta, {
            nasdaqHistory,
            fxHistory,
            ixicHistory,
            kospiHistory,
            soxHistory,
            dxyHistory,
            us10yHistory,
            vix,
            macroEvents,
            cachedAt,
          });
          refreshed += 1;
        } catch (e) {
          errors[meta.code] = e instanceof Error ? e.message : String(e);
        }
      })
    );
  }

  return {
    refreshed,
    errors,
    symbols: symbols.map((s) => s.code),
    cachedAt,
  };
}

async function refreshOneSymbol(
  meta: SymbolMeta,
  ctx: {
    nasdaqHistory: Awaited<ReturnType<typeof fetchHistorical>>;
    fxHistory: Awaited<ReturnType<typeof fetchHistorical>>;
    ixicHistory: Awaited<ReturnType<typeof fetchHistorical>>;
    kospiHistory: Awaited<ReturnType<typeof fetchHistorical>>;
    soxHistory: Awaited<ReturnType<typeof fetchHistorical>>;
    dxyHistory: Awaited<ReturnType<typeof fetchHistorical>>;
    us10yHistory: Awaited<ReturnType<typeof fetchHistorical>>;
    vix: number | null;
    macroEvents: EventItem[];
    cachedAt: number;
  }
): Promise<void> {
  const [quoteRes, hist, bundle, upcomingEvents] = await Promise.all([
    fetchQuotesBatch([meta]).then((r) => r[0]),
    fetchHistorical(meta.code, 90),
    getConsensusBundle(meta.code).catch(() => ({
      consensus: null,
      valuation: null,
      researches: [],
    })),
    fetchEventsForSymbol(meta).catch(() => []),
  ]);

  if (!quoteRes.ok) throw new Error(quoteRes.error);
  const quote = quoteRes.quote;

  const flowRes = await fetchFlowOrMock(meta.code, quote.price);
  const tech = computeTech(hist);
  const flow = { ...flowRes.flow, fetchedAt: quote.fetchedAt };

  const intradayBars =
    isKrStock(meta.code) && isKrMarketOpen()
      ? await fetchIntradayBars(meta.code).catch(() => null)
      : null;
  const intradayMetrics = intradayBars
    ? computeIntradayMetrics(intradayBars)
    : null;

  const analysisRaw = analyze({
    quote,
    tech,
    flow,
    consensus: bundle.consensus,
    valuation: bundle.valuation,
    context: {
      semiHeat: null,
      nasdaqRate: 0,
      fxRate: 0,
      vix: ctx.vix ?? 0,
    },
    history: hist,
  });
  const dataQuality = assessDataQuality({
    code: meta.code,
    historyLength: hist.length,
    flow,
  });
  let analysis = applyThinHistoryAnalysisGate(analysisRaw, dataQuality);
  const volatility = assessVolatility({
    history: hist,
    flow,
    todayChangeRate: quote.changeRate,
    intraday: intradayMetrics,
  });
  analysis.volatility = volatility;

  const eventsForVolatility: EventItem[] = [
    ...upcomingEvents,
    ...ctx.macroEvents,
  ];
  const rawPredictions = predict({
    quote,
    history: hist,
    nasdaqHistory: ctx.nasdaqHistory,
    fxHistory: ctx.fxHistory,
    ixicHistory: ctx.ixicHistory,
    kospiHistory: ctx.kospiHistory,
    soxHistory: ctx.soxHistory,
    dxyHistory: ctx.dxyHistory,
    us10yHistory: ctx.us10yHistory,
    vix: ctx.vix,
    meta,
    buyScore: analysis.buyScore,
    heatScore: analysis.heatScore,
    intradayDailyVol: intradayMetrics?.parkinsonDaily ?? null,
    events: eventsForVolatility,
    todayChangeRate: quote.changeRate,
    momentumActive: !!analysis.verdict.momentumOverride,
    nowMs: ctx.cachedAt,
  });
  const predictions = applyThinHistoryPredictionGate(rawPredictions, dataQuality);

  saveAnalysisCache({
    symbol: meta.code,
    analysis,
    predictions,
    cachedAt: ctx.cachedAt,
  });
}

export function mergeCachedAnalysis(
  snap: StockSnapshot,
  now = Date.now()
): StockSnapshot {
  const cached = getAnalysisCache(snap.meta.code, now);
  if (!cached) return snap;
  return {
    ...snap,
    analysis: cached.analysis,
    predictions: cached.predictions,
    analysisCachedAt: cached.cachedAt,
  };
}
