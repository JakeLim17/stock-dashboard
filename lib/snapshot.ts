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
import { getConsensusBundle } from "./providers/consensusCache";
import { getMarketAlertCached } from "./providers/marketAlertCache";
import { isKrStock } from "./providers/naver";
import { fetchIntradayBars, isKrMarketOpen } from "./providers/naverIntraday";
import {
  analyze,
  marketMoodLabel,
  predict,
  assessVolatility,
  computeIntradayMetrics,
} from "./analyzer";
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
      priceTime: q.priceTime ?? null,
      marketState: q.marketState,
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

  // 1.5) 베타 시나리오용 시장 시계열/환율 + 뉴스(외부 리스크 평가에 필요) — 병렬.
  // 뉴스는 종목 분석 전에 받아야 종목별 externalRisk를 analyze()에 넣을 수 있다.
  const [nasdaqHistory, fxHistory, eurUsdQuote, newsFetched] = await Promise.all([
    fetchHistorical("NQ=F", 90).catch(() => []),
    fetchHistorical("KRW=X", 90).catch(() => []),
    includeOverseasNight
      ? fetchQuote("EURUSD=X", "유로/달러").catch((e) => {
          errors["EURUSD=X"] = e instanceof Error ? e.message : String(e);
          return null;
        })
      : Promise.resolve(null),
    fetchAllNews(30).catch((e) => {
      errors["news"] = e instanceof Error ? e.message : String(e);
      return [] as NewsItem[];
    }),
  ]);
  const eurUsd = eurUsdQuote?.price ?? null;
  const newsAll: NewsItem[] = newsFetched;
  // 뉴스 DB 저장은 비차단으로 — 분석은 메모리 newsAll 기준.
  if (newsAll.length > 0) {
    try {
      saveNews(newsAll);
    } catch {
      /* 메모리 DB 등 — 무시 */
    }
  }

  // 2) 관심 종목 — quote, historical, flow, 컨센서스(캐시) 병렬
  const primaries: StockSnapshot[] = [];
  const primaryResults = await Promise.allSettled(
    watchSymbols.map(async (meta) => {
      const [quoteRes, hist, bundle, marketAlert] = await Promise.all([
        fetchQuotesBatch([meta]).then((r) => r[0]),
        fetchHistorical(meta.code, 90),
        // 컨센서스/밸류에이션은 종목당 6시간 캐시. miss일 때만 Yahoo+Naver 호출.
        getConsensusBundle(meta.code).catch(() => ({
          consensus: null,
          valuation: null,
          researches: [],
        })),
        // 한국 종목만 시장경보(투자주의/경고/위험 등) 조회 — 6시간 캐시.
        // 미국 종목·지수는 호출 자체를 스킵해 네트워크 낭비 방지.
        isKrStock(meta.code)
          ? getMarketAlertCached(meta.code).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (!quoteRes.ok) throw new Error(quoteRes.error);
      // 시장경보를 quote에 부착 — UI/분석 룰이 quote 한 객체에서 모두 읽도록.
      const quote: typeof quoteRes.quote = { ...quoteRes.quote, marketAlert };

      // 컨센서스 upsidePercent는 캐시 시점 가격 기준이라 오차가 누적된다.
      // 현재 시세 대비로 매번 재계산해 룰/UI가 같은 값을 본다.
      // domestic/global도 같이 재계산 — 3-way 컨센 UI/룰에서 모두 일관된 값 사용.
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
      // flow의 신선도 라벨용 — 최초엔 quote.fetchedAt에 동기화 (이후 KIS 도입 시
      // KIS 자체 timestamp로 교체 가능). 네이버 일별 누적은 사실상 일 단위라 분 단위
      // 정확도가 없지만, "조회한 시점"을 표시함으로써 사용자가 stale 여부를 가늠할 수 있다.
      const flow = { ...flowRes.flow, fetchedAt: quote.fetchedAt };

      // 한국 종목 + 정규장 진행 중일 때만 1분봉 호출 (TTL 60s 캐시).
      // 미국·지수·환율은 호출 자체를 스킵해 네트워크 낭비 방지.
      // intraday는 변동성 점수 + 진폭 예측 정밀화에만 사용.
      const intradayBars =
        isKrStock(meta.code) && isKrMarketOpen()
          ? await fetchIntradayBars(meta.code).catch(() => null)
          : null;
      const intradayMetrics = intradayBars
        ? computeIntradayMetrics(intradayBars)
        : null;

      // 종목 관련 뉴스 + 시장 전반(symbol 미지정) 뉴스를 합쳐 외부 리스크 평가.
      // 시장 전반 뉴스(예: "트럼프, 중국 반도체에 100% 관세")는 모든 watchlist에 영향.
      const relatedNews = newsAll.filter(
        (n) =>
          n.symbol === meta.code ||
          (n.title || "").includes(meta.name) ||
          n.symbol == null
      );
      const externalRisk = assessNewsRisk(relatedNews);
      // 호재(opportunity)는 종목명 매칭이 엄격해야 펌프 방지 → assessOpportunity 내부에서
      // 시장 전반 뉴스는 자동 제외한다. (newsAll 통째로 넘겨도 안전.)
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
          ...context,
          overseasNightRate: overseasNight?.changeRate ?? null,
        },
      });
      // 변동성("사팔사팔") 점수 — 일봉 + 수급 + (한국+장중) 분봉 가중.
      // verdict shift는 하지 않고 analysis.volatility 로만 노출 (안전장치 유지).
      const volatility = assessVolatility({
        history: hist,
        flow,
        todayChangeRate: quote.changeRate,
        intraday: intradayMetrics,
      });
      analysis.volatility = volatility;
      // 도박장 등급이면 단기 reasons 첫 줄에 한 줄 prepend.
      // verdict 자체는 안 흔들고 사용자에게 시각적으로 강조하는 용도.
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
      const predictions = predict({
        quote,
        history: hist,
        nasdaqHistory,
        fxHistory,
        buyScore: analysis.buyScore,
        heatScore: analysis.heatScore,
        overseasNight,
        intradayDailyVol: intradayMetrics?.parkinsonDaily ?? null,
      });

      saveQuote(quote);
      saveFlow(meta.code, quote.fetchedAt, flow);
      saveTech(meta.code, quote.fetchedAt, tech);
      saveAnalysis(meta.code, quote.fetchedAt, analysis);

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

  // 3) 뉴스는 이미 §1.5에서 newsAll로 받아 두었다.
  const marketMood = {
    label: marketMoodLabel(indicators),
    semiHeat: semiHeatClamped,
    riskKeywords: riskKeywords(newsAll),
  };

  return {
    generatedAt: Date.now(),
    primaries,
    indicators,
    marketMood,
    news: newsAll,
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
