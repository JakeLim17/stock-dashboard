import "server-only";
import { cache } from "react";
import {
  fetchQuote,
  fetchQuotesBatch,
  fetchHistorical,
  computeTech,
  fetchFlowOrMock,
  fetchAllNews,
  riskKeywords,
  fetchYahooQuotesBatch,
} from "./providers";
import { getConsensusBundle } from "./providers/consensusCache";
import { getMarketAlertCached } from "./providers/marketAlertCache";
import {
  getProgramTradeCached,
  getShortBalanceCached,
} from "./providers/kisExtraCache";
import { kisEnabled } from "./providers/kis";
import { isKrStock } from "./providers/naver";
import { fetchIntradayBars, isKrMarketOpen } from "./providers/naverIntraday";
import {
  fetchEventsForSymbol,
  getMacroEventsCached,
} from "./providers/eventCalendar";
import {
  analyze,
  marketMoodLabel,
  predict,
  assessVolatility,
  computeIntradayMetrics,
  evaluateSignalMarks,
  pickTopSignalMarks,
} from "./analyzer";
import { dailySigmaFromCloses } from "./analyzer/statHelpers";
import { assessNewsRisk } from "./news/riskScore";
import { assessOpportunity } from "./news/opportunityScore";
import { saveQuote, saveFlow, saveTech, saveAnalysis, saveNews } from "./db";
import {
  PRIMARY_SYMBOLS,
  MARKET_INDICATORS,
  getOverseasNightProxy,
  resolveWatchSymbols,
} from "./symbols";
import type {
  DashboardSnapshot,
  EventItem,
  MarketIndicator,
  NewsItem,
  OverseasNightIndicator,
  Quote,
  SymbolMeta,
  StockSnapshot,
} from "./types";

export interface BuildSnapshotOptions {
  includeOverseasNight?: boolean;
}

// 시장 분위기·반도체 과열도 계산에 쓰이는 컨텍스트.
// fetchMarketIndicators() 결과로 자동 도출되며, 이후 fetchWatchlistSnapshots()의
// 종목 분석/예측에 그대로 전달돼 일관된 시장 컨텍스트를 유지한다.
export interface MarketContextSnapshot {
  semiHeat: number; // 0~100
  nasdaqRate: number;
  fxRate: number;
  vix: number;
}

export interface MarketIndicatorsResult {
  indicators: MarketIndicator[];
  errors: Record<string, string>;
  context: MarketContextSnapshot;
  // 환율(KRW=X) — 해외 야간 지표 계산에 재사용. 없으면 null.
  usdKrw: number | null;
}

export interface WatchlistSnapshotsResult {
  primaries: StockSnapshot[];
  errors: Record<string, string>;
}

export interface WatchlistDeps {
  indicators?: MarketIndicator[];
  news?: NewsItem[];
  context?: MarketContextSnapshot;
  usdKrw?: number | null;
  options?: BuildSnapshotOptions;
}

function envEnabled(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

// ──────────────────────────────────────────────────────────────
// 1) 시장 지표 — 빠른 영역 (1-2초). SummaryBar / MarketPanel 1차 채움용.
//    Suspense streaming 단계 중 가장 먼저 도착한다.
// ──────────────────────────────────────────────────────────────
export async function fetchMarketIndicators(): Promise<MarketIndicatorsResult> {
  const errors: Record<string, string> = {};
  // 시세 batch + 모든 인디케이터 일별 close history(최근 35영업일)를 병렬로.
  // history는 (1) KRW=X 변동성 σ 계산, (2) 모든 카드의 Sparkline 렌더에 사용.
  // 실패한 심볼은 빈 배열로 fallback — 시세는 살아 있을 수 있으므로 카드 자체는 그대로 노출.
  const [indicatorResults, historyResults] = await Promise.all([
    fetchYahooQuotesBatch(MARKET_INDICATORS),
    Promise.all(
      MARKET_INDICATORS.map((meta) =>
        fetchHistorical(meta.code, 35).catch(() => [])
      )
    ),
  ]);
  const historyMap = new Map<string, number[]>();
  for (let i = 0; i < MARKET_INDICATORS.length; i++) {
    const meta = MARKET_INDICATORS[i];
    const closes = historyResults[i]
      .map((p) => p.close)
      .filter((v) => Number.isFinite(v) && v > 0);
    historyMap.set(meta.code, closes);
  }
  const indicators: MarketIndicator[] = [];

  // KRW=X 변동성 — 일별 close → 로그수익률 → 1개월(EWMA) / 1주(표본 stddev) σ%.
  // σ는 단위 % / day. 한 줄에 2개를 보여줘 사용자가 "최근 변동성 안정/확대"를 직관 파악.
  const fxCloses = historyMap.get("KRW=X") ?? [];
  const fxVolatility = (() => {
    if (fxCloses.length < 6) return null;
    const sigma30 = dailySigmaFromCloses(fxCloses.slice(-22)); // 약 1개월 거래일
    // 1주(직전 5거래일) 표본 표준편차 — 짧은 윈도우엔 단순 stddev가 직관적.
    const recent = fxCloses.slice(-6);
    const r1w: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      const p = recent[i - 1];
      const c = recent[i];
      if (p > 0 && c > 0) r1w.push(Math.log(c / p));
    }
    const mu1w = r1w.length > 0 ? r1w.reduce((a, b) => a + b, 0) / r1w.length : 0;
    const var1w =
      r1w.length > 1
        ? r1w.reduce((acc, x) => acc + (x - mu1w) ** 2, 0) / (r1w.length - 1)
        : 0;
    const sigma1w = Math.sqrt(Math.max(var1w, 0));

    if (sigma30 <= 0 && sigma1w <= 0) return null;
    const pct30 = sigma30 * 100;
    const pct1w = sigma1w * 100;
    return {
      window: "1m" as const,
      sigmaPct: pct30,
      label: `σ(1M) ${pct30.toFixed(2)}% / day`,
      secondaryWindow: "1w" as const,
      secondarySigmaPct: pct1w,
    };
  })();

  for (let i = 0; i < indicatorResults.length; i++) {
    const r = indicatorResults[i];
    const meta = MARKET_INDICATORS[i];
    if (!r.ok) {
      errors[meta.code] = r.error;
      continue;
    }
    const q = r.quote;
    saveQuote(q);
    const closeHistory = historyMap.get(meta.code) ?? [];
    indicators.push({
      code: meta.code,
      name: meta.name,
      value: q.price,
      changeRate: q.changeRate,
      status: indicatorStatus(meta.code, q.changeRate, q.price),
      hint: indicatorHint(meta.code, q.changeRate),
      priceTime: q.priceTime ?? null,
      marketState: q.marketState,
      changeAbs: q.changeAbs ?? null,
      prevClose: q.prevClose ?? null,
      dayHigh: q.high ?? null,
      dayLow: q.low ?? null,
      volatility: meta.code === "KRW=X" ? fxVolatility : null,
      // 최근 30영업일치만 잘라 응답 크기 절감 (Sparkline에 충분).
      closeHistory: closeHistory.length >= 2 ? closeHistory.slice(-30) : undefined,
    });
  }

  const sox = indicators.find((i) => i.code === "^SOX");
  const nvda = indicators.find((i) => i.code === "NVDA");
  const nq = indicators.find((i) => i.code === "NQ=F");
  const fx = indicators.find((i) => i.code === "KRW=X");
  const vix = indicators.find((i) => i.code === "^VIX");

  // 반도체 과열도 = SOX + NVDA 평균을 0~100으로 환산 (1% 변동 → ±15점)
  const semiSignal = ((sox?.changeRate ?? 0) + (nvda?.changeRate ?? 0)) / 2;
  const semiHeat = Math.round(50 + semiSignal * 1500);
  const semiHeatClamped = Math.max(0, Math.min(100, semiHeat));

  return {
    indicators,
    errors,
    context: {
      semiHeat: semiHeatClamped,
      nasdaqRate: nq?.changeRate ?? 0,
      fxRate: fx?.changeRate ?? 0,
      vix: vix?.value ?? 15,
    },
    usdKrw: fx?.value ?? null,
  };
}

// ──────────────────────────────────────────────────────────────
// 2) 뉴스 — 빠른 영역 (1-2초). NewsPanel + externalRisk 입력.
// ──────────────────────────────────────────────────────────────
export async function fetchNewsItems(limit = 30): Promise<NewsItem[]> {
  const news = await fetchAllNews(limit);
  if (news.length > 0) {
    try {
      saveNews(news);
    } catch {
      /* 메모리 DB 등 — 무시 */
    }
  }
  return news;
}

// ──────────────────────────────────────────────────────────────
// React.cache로 한 SSR request 내 중복 호출 제거.
//   - app/page.tsx에서 first-paint RSC들이 같은 데이터를 await하더라도 1번만 fetch
//   - buildSnapshot도 동일 cached 버전 사용 → DashboardLoader와 first-paint slot이 fetch 공유
//   - 클라이언트 polling이 /api/snapshot으로 호출하는 buildSnapshot은 매 request 별로 새 캐시
//     스코프라 polling 신선도에 영향 없음
// ──────────────────────────────────────────────────────────────
export const cachedMarketIndicators = cache(fetchMarketIndicators);
export const cachedNewsItems = cache(() => fetchNewsItems(30));

// ──────────────────────────────────────────────────────────────
// 3) 매크로 이벤트 — 즉시 (24h 메모리 캐시). FOMC·KOSPI 만기·KRX 휴장.
// ──────────────────────────────────────────────────────────────
export function fetchMacroEvents(): EventItem[] {
  const now = Date.now();
  return getMacroEventsCached().filter(
    (e) => e.date >= now - 86_400_000 && e.date <= now + 60 * 86_400_000
  );
}

// ──────────────────────────────────────────────────────────────
// 4) marketMood 조립 — indicators + news 둘 다 있어야 가능.
//    별도 함수로 두면 page.tsx에서 두 데이터가 도착하는 시점에 호출 가능.
// ──────────────────────────────────────────────────────────────
export function buildMarketMood(
  indicators: MarketIndicator[],
  news: NewsItem[],
  semiHeat: number
): DashboardSnapshot["marketMood"] {
  return {
    label: marketMoodLabel(indicators),
    semiHeat,
    riskKeywords: riskKeywords(news),
  };
}

// ──────────────────────────────────────────────────────────────
// 5) 관심 종목 분석 — 가장 느린 영역 (3-5초).
//    indicators / news / context 가 없으면 내부에서 직접 fetch한다(독립 호출 가능).
//    있으면 그대로 재사용 (buildSnapshot 등 합성 호출에서 중복 방지).
// ──────────────────────────────────────────────────────────────
export async function fetchWatchlistSnapshots(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  deps: WatchlistDeps = {}
): Promise<WatchlistSnapshotsResult> {
  const errors: Record<string, string> = {};
  const watchSymbols: SymbolMeta[] = resolveWatchSymbols(requestedSymbols);
  const includeOverseasNight = deps.options?.includeOverseasNight === true;

  // indicators / news / context 가 없으면 자체 fetch (독립 호출 시 안전망).
  let indicators = deps.indicators;
  let context = deps.context;
  let usdKrw = deps.usdKrw ?? null;
  if (!indicators || !context) {
    const r = await fetchMarketIndicators();
    indicators = r.indicators;
    context = r.context;
    usdKrw = r.usdKrw;
    Object.assign(errors, r.errors);
  }

  const newsAllPromise: Promise<NewsItem[]> = deps.news
    ? Promise.resolve(deps.news)
    : fetchNewsItems(30).catch((e) => {
        errors["news"] = e instanceof Error ? e.message : String(e);
        return [] as NewsItem[];
      });

  // 베타 시나리오용 시장 시계열 + (옵션) 유로/달러 시세 — 종목 분석 전 병렬 fetch.
  const [nasdaqHistory, fxHistory, eurUsdQuote, newsAll] = await Promise.all([
    fetchHistorical("NQ=F", 90).catch(() => []),
    fetchHistorical("KRW=X", 90).catch(() => []),
    includeOverseasNight
      ? fetchQuote("EURUSD=X", "유로/달러").catch((e) => {
          errors["EURUSD=X"] = e instanceof Error ? e.message : String(e);
          return null;
        })
      : Promise.resolve(null),
    newsAllPromise,
  ]);
  const eurUsd = eurUsdQuote?.price ?? null;

  const primaries: StockSnapshot[] = [];
  const primaryResults = await Promise.allSettled(
    watchSymbols.map(async (meta) => {
      // 프로그램 매매/공매도는 보조 정보라 첫 로딩 병목을 피하기 위해 opt-in.
      const wantsKisExtras =
        envEnabled("KIS_EXTRAS_ENABLED") && kisEnabled() && isKrStock(meta.code);
      const [
        quoteRes,
        hist,
        bundle,
        marketAlert,
        upcomingEvents,
        programTrade,
        shortBalance,
      ] = await Promise.all([
        fetchQuotesBatch([meta]).then((r) => r[0]),
        fetchHistorical(meta.code, 90),
        getConsensusBundle(meta.code).catch(() => ({
          consensus: null,
          valuation: null,
          researches: [],
        })),
        isKrStock(meta.code)
          ? getMarketAlertCached(meta.code).catch(() => null)
          : Promise.resolve(null),
        fetchEventsForSymbol(meta).catch(() => []),
        wantsKisExtras
          ? getProgramTradeCached(meta.code).catch(() => null)
          : Promise.resolve(null),
        wantsKisExtras
          ? getShortBalanceCached(meta.code).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (!quoteRes.ok) throw new Error(quoteRes.error);
      const quote: typeof quoteRes.quote = {
        ...quoteRes.quote,
        marketAlert,
      };

      // 컨센서스 upsidePercent는 캐시 시점 가격 기준이라 매번 재계산 — 룰/UI가 같은 값을 보도록.
      const consensus = bundle.consensus
        ? {
            ...bundle.consensus,
            upsidePercent:
              bundle.consensus.targetMean != null && quote.price > 0
                ? bundle.consensus.targetMean / quote.price - 1
                : null,
            domesticUpsidePercent:
              bundle.consensus.domesticMean != null && quote.price > 0
                ? bundle.consensus.domesticMean / quote.price - 1
                : null,
            globalUpsidePercent:
              bundle.consensus.globalMean != null && quote.price > 0
                ? bundle.consensus.globalMean / quote.price - 1
                : null,
          }
        : null;
      const consensusValuation = bundle.valuation;
      const researches = bundle.researches;

      const overseasNight = includeOverseasNight
        ? await fetchOverseasNightIndicator(
            meta,
            quote,
            usdKrw,
            eurUsd
          ).catch((e) => {
            errors[`night:${meta.code}`] =
              e instanceof Error ? e.message : String(e);
            return null;
          })
        : null;

      const flowRes = await fetchFlowOrMock(meta.code, quote.price);
      const tech = computeTech(hist);
      const flow = { ...flowRes.flow, fetchedAt: quote.fetchedAt };

      // 한국 종목 + 정규장 진행 중일 때만 1분봉 호출 (TTL 60s 캐시).
      const intradayBars =
        isKrStock(meta.code) && isKrMarketOpen()
          ? await fetchIntradayBars(meta.code).catch(() => null)
          : null;
      const intradayMetrics = intradayBars
        ? computeIntradayMetrics(intradayBars)
        : null;

      // 종목 + 시장 전반 뉴스를 합쳐 외부 리스크 평가.
      const relatedNews = newsAll.filter(
        (n) =>
          n.symbol === meta.code ||
          (n.title || "").includes(meta.name) ||
          n.symbol == null
      );
      const externalRisk = assessNewsRisk(relatedNews);
      const externalOpportunity = assessOpportunity(
        newsAll,
        meta.code,
        meta.name
      );

      const analysis = analyze({
        quote,
        tech,
        flow,
        consensus,
        valuation: consensusValuation,
        externalRisk,
        externalOpportunity,
        context: {
          ...context!,
          overseasNightRate: overseasNight?.changeRate ?? null,
        },
      });
      const volatility = assessVolatility({
        history: hist,
        flow,
        todayChangeRate: quote.changeRate,
        intraday: intradayMetrics,
      });
      analysis.volatility = volatility;
      if (volatility.level === "gambling" || volatility.level === "high") {
        const top = volatility.drivers[0]?.label;
        const tag =
          volatility.level === "gambling"
            ? `도박장 ⚠ 변동성 ${volatility.score}`
            : `고변동 변동성 ${volatility.score}`;
        analysis.shortTerm.reasons = [
          `· ${tag}${top ? ` · ${top}` : ""}`,
          ...analysis.shortTerm.reasons,
        ].slice(0, 3);
        analysis.reasons = analysis.shortTerm.reasons;
      }
      // 임박 가격 이벤트(종목별 실적·배당) + 매크로(FOMC·KOSPI 만기) 를 σ 부풀림 산정에 전달.
      // 가장 임팩트 큰 단일 이벤트만 적용 (eventVolatility.ts 단일 선택).
      const eventsForVolatility: EventItem[] = [
        ...upcomingEvents,
        ...getMacroEventsCached(),
      ];
      const predictions = predict({
        quote,
        history: hist,
        nasdaqHistory,
        fxHistory,
        buyScore: analysis.buyScore,
        heatScore: analysis.heatScore,
        overseasNight,
        intradayDailyVol: intradayMetrics?.parkinsonDaily ?? null,
        events: eventsForVolatility,
      });

      saveQuote(quote);
      saveFlow(meta.code, quote.fetchedAt, flow);
      saveTech(meta.code, quote.fetchedAt, tech);
      saveAnalysis(meta.code, quote.fetchedAt, analysis);

      const signalMarks = pickTopSignalMarks(
        evaluateSignalMarks({
          quote,
          history: hist,
          flow,
          valuation: consensusValuation,
          upcomingEvents,
        }),
        4
      );
      const closeHistory = hist
        .map((p) => p.close)
        .filter((v) => Number.isFinite(v) && v > 0)
        .slice(-30);

      return {
        meta,
        quote,
        tech,
        flow,
        analysis,
        overseasNight,
        predictions,
        consensus,
        consensusValuation,
        researches,
        signalMarks,
        upcomingEvents,
        programTrade,
        shortBalance,
        closeHistory: closeHistory.length >= 2 ? closeHistory : undefined,
      };
    })
  );

  for (let i = 0; i < primaryResults.length; i++) {
    const r = primaryResults[i];
    if (r.status === "fulfilled") {
      primaries.push(r.value);
    } else {
      errors[watchSymbols[i].code] =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  }

  return { primaries, errors };
}

// ──────────────────────────────────────────────────────────────
// 기존 호환 — 메인 대시보드 1회 분의 통합 스냅샷.
//   indicators + news 를 병렬로 받고 → watchlist 분석에 deps로 주입.
//   외부 인터페이스(반환 shape)는 종전과 동일.
// ──────────────────────────────────────────────────────────────
export async function buildSnapshot(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  options: BuildSnapshotOptions = {}
): Promise<DashboardSnapshot> {
  // 뉴스 실패는 치명적이지 않음 — 빈 배열로 진행. 호출자가 별도 fetch 시도해도 무방.
  // cached* 사용 — page.tsx의 first-paint RSC가 동일 request 내에서 먼저 호출했다면
  // 그 결과를 그대로 재사용 (Promise dedup으로 외부 호출 1회).
  const [indicatorResult, news] = await Promise.all([
    cachedMarketIndicators(),
    cachedNewsItems().catch(() => [] as NewsItem[]),
  ]);

  const watchResult = await fetchWatchlistSnapshots(requestedSymbols, {
    indicators: indicatorResult.indicators,
    news,
    context: indicatorResult.context,
    usdKrw: indicatorResult.usdKrw,
    options,
  });

  const errors = { ...indicatorResult.errors, ...watchResult.errors };

  return {
    generatedAt: Date.now(),
    primaries: watchResult.primaries,
    indicators: indicatorResult.indicators,
    marketMood: buildMarketMood(
      indicatorResult.indicators,
      news,
      indicatorResult.context.semiHeat
    ),
    news,
    errors,
    macroEvents: fetchMacroEvents(),
  };
}

async function fetchOverseasNightIndicator(
  meta: SymbolMeta,
  domesticQuote: Quote,
  usdKrw: number | null,
  eurUsd: number | null
): Promise<OverseasNightIndicator | null> {
  const proxy = getOverseasNightProxy(meta.code);
  if (!proxy) return null;

  const quote = await fetchQuote(proxy.proxyCode, proxy.name);
  if (!quote.price || quote.changeRate == null) return null;
  const currency = quote.currency?.toUpperCase();
  const fxToKrw =
    currency === "KRW"
      ? 1
      : currency === "USD"
        ? usdKrw
        : currency === "EUR" && eurUsd != null && usdKrw != null
          ? eurUsd * usdKrw
          : null;
  const impliedKrwPrice =
    fxToKrw != null ? (quote.price * fxToKrw) / proxy.sharesPerReceipt : null;
  const krxClose =
    domesticQuote.extendedHours?.regularClose ??
    domesticQuote.price ??
    domesticQuote.prevClose ??
    null;
  const premiumRate =
    impliedKrwPrice != null && krxClose != null && krxClose > 0
      ? impliedKrwPrice / krxClose - 1
      : null;

  return {
    baseCode: meta.code,
    proxyCode: proxy.proxyCode,
    name: proxy.name,
    exchange: proxy.exchange,
    sharesPerReceipt: proxy.sharesPerReceipt,
    price: quote.price,
    changeRate: quote.changeRate,
    currency: quote.currency,
    fxToKrw,
    usdKrw,
    eurUsd,
    impliedKrwPrice,
    krxClose,
    premiumRate,
    marketState: quote.marketState,
    priceTime: quote.priceTime,
    fetchedAt: quote.fetchedAt,
  };
}

function indicatorStatus(
  code: string,
  rate: number,
  value: number
): MarketIndicator["status"] {
  if (code === "^VIX") {
    if (value >= 25) return "warn";
    if (value >= 20) return "warn";
  }
  if (rate >= 0.003) return "up";
  if (rate <= -0.003) return "down";
  return "flat";
}

function indicatorHint(code: string, rate: number): string | undefined {
  if (code === "^SOX") {
    if (rate >= 0.01) return "반도체 강세";
    if (rate <= -0.01) return "반도체 약세";
  }
  if (code === "KRW=X") {
    if (rate >= 0.005) return "원화 약세 주의";
    if (rate <= -0.005) return "원화 강세";
  }
  if (code === "^VIX") {
    if (rate >= 0.05) return "변동성 확대";
  }
  return undefined;
}
