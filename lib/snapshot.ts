import "server-only";
import {
  fetchQuote,
  fetchQuotesBatch,
  fetchHistorical,
  computeTech,
  fetchFlowOrMock,
  fetchAllNews,
  riskKeywords,
} from "./providers";
import { analyze, marketMoodLabel, predict } from "./analyzer";
import { saveQuote, saveFlow, saveTech, saveAnalysis, saveNews } from "./db";
import {
  PRIMARY_SYMBOLS,
  MARKET_INDICATORS,
  getOverseasNightProxy,
  resolveWatchSymbols,
} from "./symbols";
import type {
  DashboardSnapshot,
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

// 메인 대시보드 1회 분의 스냅샷을 만든다. 실패한 부분은 errors 맵에 기록하고 가능한 부분은 채워서 반환.
export async function buildSnapshot(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  options: BuildSnapshotOptions = {}
): Promise<DashboardSnapshot> {
  const errors: Record<string, string> = {};
  const watchSymbols: SymbolMeta[] = resolveWatchSymbols(requestedSymbols);
  const includeOverseasNight = options.includeOverseasNight === true;

  // 1) 시장 지표 먼저 (분석 컨텍스트로 필요)
  const indicatorResults = await fetchQuotesBatch(MARKET_INDICATORS);
  const indicators: MarketIndicator[] = [];
  for (let i = 0; i < indicatorResults.length; i++) {
    const r = indicatorResults[i];
    const meta = MARKET_INDICATORS[i];
    if (!r.ok) {
      errors[meta.code] = r.error;
      continue;
    }
    const q = r.quote;
    saveQuote(q);
    indicators.push({
      code: meta.code,
      name: meta.name,
      value: q.price,
      changeRate: q.changeRate,
      status: indicatorStatus(meta.code, q.changeRate, q.price),
      hint: indicatorHint(meta.code, q.changeRate),
    });
  }

  // 컨텍스트 추출
  const sox = indicators.find((i) => i.code === "^SOX");
  const nvda = indicators.find((i) => i.code === "NVDA");
  const nq = indicators.find((i) => i.code === "NQ=F");
  const fx = indicators.find((i) => i.code === "KRW=X");
  const vix = indicators.find((i) => i.code === "^VIX");

  // 반도체 과열도 = SOX + NVDA 평균을 0~100으로 환산
  const semiSignal = ((sox?.changeRate ?? 0) + (nvda?.changeRate ?? 0)) / 2;
  const semiHeat = Math.round(50 + semiSignal * 1500); // 1%변동 → ±15점
  const semiHeatClamped = Math.max(0, Math.min(100, semiHeat));

  const context = {
    semiHeat: semiHeatClamped,
    nasdaqRate: nq?.changeRate ?? 0,
    fxRate: fx?.changeRate ?? 0,
    vix: vix?.value ?? 15,
  };

  const usdKrw = fx?.value ?? null;

  // 1.5) 베타 시나리오용 시장 시계열/환율 (관심 종목 전체에서 공유, 한 번만 호출)
  const [nasdaqHistory, fxHistory, eurUsdQuote] = await Promise.all([
    fetchHistorical("NQ=F", 90).catch(() => []),
    fetchHistorical("KRW=X", 90).catch(() => []),
    includeOverseasNight
      ? fetchQuote("EURUSD=X", "유로/달러").catch((e) => {
          errors["EURUSD=X"] = e instanceof Error ? e.message : String(e);
          return null;
        })
      : Promise.resolve(null),
  ]);
  const eurUsd = eurUsdQuote?.price ?? null;

  // 2) 관심 종목 — quote, historical, flow 병렬
  const primaries: StockSnapshot[] = [];
  const primaryResults = await Promise.allSettled(
    watchSymbols.map(async (meta) => {
      const [quoteRes, hist] = await Promise.all([
        fetchQuotesBatch([meta]).then((r) => r[0]),
        fetchHistorical(meta.code, 90),
      ]);

      if (!quoteRes.ok) throw new Error(quoteRes.error);
      const quote = quoteRes.quote;
      const overseasNight = includeOverseasNight
        ? await fetchOverseasNightIndicator(meta, quote, usdKrw, eurUsd).catch(
            (e) => {
              errors[`night:${meta.code}`] =
                e instanceof Error ? e.message : String(e);
              return null;
            }
          )
        : null;

      const flowRes = await fetchFlowOrMock(meta.code, quote.price);
      const tech = computeTech(hist);
      const flow = flowRes.flow;
      const analysis = analyze({
        quote,
        tech,
        flow,
        context: {
          ...context,
          overseasNightRate: overseasNight?.changeRate ?? null,
        },
      });
      const predictions = predict({
        quote,
        history: hist,
        nasdaqHistory,
        fxHistory,
        buyScore: analysis.buyScore,
        heatScore: analysis.heatScore,
        overseasNight,
      });

      // 저장
      saveQuote(quote);
      saveFlow(meta.code, quote.fetchedAt, flow);
      saveTech(meta.code, quote.fetchedAt, tech);
      saveAnalysis(meta.code, quote.fetchedAt, analysis);

      return { meta, quote, tech, flow, analysis, overseasNight, predictions };
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

  // 3) 뉴스
  let news: NewsItem[] = [];
  try {
    const fetched = await fetchAllNews(30);
    saveNews(fetched);
    news = fetched;
  } catch (e) {
    errors["news"] = e instanceof Error ? e.message : String(e);
  }

  const marketMood = {
    label: marketMoodLabel(indicators),
    semiHeat: semiHeatClamped,
    riskKeywords: riskKeywords(news),
  };

  return {
    generatedAt: Date.now(),
    primaries,
    indicators,
    marketMood,
    news,
    errors,
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
