import "server-only";
import {
  fetchQuotesBatch,
  fetchHistorical,
  computeTech,
  fetchFlowOrMock,
  fetchAllNews,
  riskKeywords,
} from "./providers";
import { analyze, marketMoodLabel } from "./analyzer";
import { saveQuote, saveFlow, saveTech, saveAnalysis, saveNews } from "./db";
import { PRIMARY_SYMBOLS, MARKET_INDICATORS, resolveWatchSymbols } from "./symbols";
import type {
  DashboardSnapshot,
  MarketIndicator,
  NewsItem,
  SymbolMeta,
  StockSnapshot,
} from "./types";

// 메인 대시보드 1회 분의 스냅샷을 만든다. 실패한 부분은 errors 맵에 기록하고 가능한 부분은 채워서 반환.
export async function buildSnapshot(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code)
): Promise<DashboardSnapshot> {
  const errors: Record<string, string> = {};
  const watchSymbols: SymbolMeta[] = resolveWatchSymbols(requestedSymbols);

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

  // 2) 관심 종목 — quote, historical, flow 병렬
  const primaries: StockSnapshot[] = [];
  const primaryResults = await Promise.allSettled(
    watchSymbols.map(async (meta) => {
      const [quoteRes, hist, flowRes] = await Promise.all([
        fetchQuotesBatch([meta]).then((r) => r[0]),
        fetchHistorical(meta.code, 90),
        fetchFlowOrMock(meta.code),
      ]);

      if (!quoteRes.ok) throw new Error(quoteRes.error);
      const quote = quoteRes.quote;
      const tech = computeTech(hist);
      const flow = flowRes.flow;
      const analysis = analyze({ quote, tech, flow, context });

      // 저장
      saveQuote(quote);
      saveFlow(meta.code, quote.fetchedAt, flow);
      saveTech(meta.code, quote.fetchedAt, tech);
      saveAnalysis(meta.code, quote.fetchedAt, analysis);

      return { meta, quote, tech, flow, analysis };
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
