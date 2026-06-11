import "server-only";
import {
  fetchQuote as fetchYahooQuote,
  fetchQuotesBatch as fetchYahooQuotesBatch,
  fetchHistorical as fetchYahooHistorical,
  computeTech,
} from "./yahoo";
import { fetchNaverQuote, fetchNaverFlow, isKrStock } from "./naver";
import {
  fetchKrQuote,
  fetchKrHistorical,
  fetchKrFlow,
  fetchKrIndex,
  fetchUsQuote,
  fetchUsHistorical,
  kisEnabled,
  yahooIndexToKisCode,
} from "./kis";
import { mockFlow } from "./mock";
import type { FlowData, Quote } from "../types";

// 라우팅 정책 (2026-06 재정비) — "한 번 가져오면 끝나는 데이터"는 무료 소스(네이버/Yahoo)에 맡기고
// KIS 토큰/문자 부담은 정말 실시간성이 필요한 곳에만 집중한다.
//
//   - 시세(fetchQuote)
//       한국:   네이버 → KIS 폴백 → Yahoo
//       해외:   KIS(us-stock) 1순위 → Yahoo 폴백  (Yahoo free API stale 응답 회피)
//       한국 지수(^KS11/^KQ11/^KS200): KIS inquire-index-price 1순위 → Yahoo 폴백
//       기타 지수/환율/선물: Yahoo
//   - 일별(fetchHistorical) — 네이버에 공식 historical API 없음
//       한국:   Yahoo → KIS 폴백
//       해외:   Yahoo → KIS(us-stock) 폴백
//       기타:  Yahoo
//   - 수급(fetchFlowOrMock) — KIS inquire-investor 가 KRX 원본에 가장 가깝고 실시간
//       한국:   KIS → 네이버 폴백 → mock
//       해외:  mock (의미 없음)
//
// KIS 전담(다른 진입점에서 호출):
//   - 분봉(1m/5m/15m): app/api/intraday-chart → fetchKrIntradayCandles
//   - 10호가 + 체결강도 + 실시간 체결: app/api/intraday → fetchKrAskingPrice/fetchKrExecutions
//     (StockDetailPanel "호가" 탭 활성 시에만 폴링 — 옵트인)
//   - 시장순위: app/api/leaders → fetchKrMarketLeaders (30s 캐시)
//   - 프로그램매매·공매도: kisExtraCache (snapshot 빌드 시)

function isUsTicker(code: string): boolean {
  // KIS 해외시세는 NYSE/NASDAQ/AMEX 등 미국 종목만 다룬다.
  // 인덱스/환율/선물은 KIS 범위 밖.
  if (code.includes("=") || code.startsWith("^") || code.includes(".")) return false;
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(code);
}

async function fetchQuote(code: string, name: string): Promise<Quote> {
  // 한국 지수(^KS11, ^KQ11, ^KS200) — KIS inquire-index-price 우선 → Yahoo 폴백.
  // 지수는 실시간성이 중요하고 KIS 토큰 1회로 KOSPI/KOSDAQ 동시 갱신 가능.
  if (kisEnabled() && yahooIndexToKisCode(code) != null) {
    const kisIdx = await fetchKrIndex(code, name);
    if (kisIdx) {
      // IndexQuote → Quote 변환. 지수는 거래량 외 valuation/marketCap 없음.
      const prevClose = kisIdx.value - kisIdx.changeAbs;
      return {
        code,
        name,
        price: kisIdx.value,
        prevClose,
        changeAbs: kisIdx.changeAbs,
        changeRate: kisIdx.changeRate,
        volume: kisIdx.volume,
        currency: "KRW",
        marketCap: null,
        valuation: null,
        fetchedAt: kisIdx.fetchedAt,
        marketState: undefined,
        priceTime: kisIdx.fetchedAt,
        extendedHours: null,
      };
    }
  }

  if (isKrStock(code)) {
    // 한국 종목: 네이버 1순위 → KIS 폴백 → Yahoo 폴백.
    // 네이버는 SMS·토큰 부담이 없어 1순위로. KIS는 네이버 실패 시 백업.
    const naver = await fetchNaverQuote(code, name);
    if (naver) return naver;
    if (kisEnabled()) {
      const kis = await fetchKrQuote(code, name);
      if (kis) return kis;
    }
    return fetchYahooQuote(code, name);
  }

  // 해외: KIS(us-stock) 1순위 → Yahoo 폴백.
  // KIS HHDFS00000300 은 ~100ms 안에 실시간 last 를 주는데 Yahoo free API 는 정규장에서도
  // 종종 수 분 stale 응답을 준다. 화면에 "5분 전" 으로 굳어 보이는 원인.
  // KIS 키가 없거나 비ASCII 티커(인덱스/환율)는 자연스럽게 Yahoo 로 떨어진다.
  if (kisEnabled() && isUsTicker(code)) {
    const kis = await fetchUsQuote(code, name).catch(() => null);
    if (kis && kis.price > 0) return kis;
  }
  return fetchYahooQuote(code, name);
}

async function fetchQuotesBatch(
  items: Array<{ code: string; name: string }>
): Promise<Array<{ ok: true; quote: Quote } | { ok: false; code: string; error: string }>> {
  return Promise.all(
    items.map(async (it) => {
      try {
        const quote = await fetchQuote(it.code, it.name);
        return { ok: true as const, quote };
      } catch (e) {
        return {
          ok: false as const,
          code: it.code,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })
  );
}

async function fetchHistorical(
  code: string,
  days = 90
): Promise<Awaited<ReturnType<typeof fetchYahooHistorical>>> {
  // 네이버에 공식 historical API가 없어 Yahoo가 1순위.
  // KIS는 Yahoo 실패 시 폴백 (영업일 60개 안정적으로 줌).
  const yahoo = await fetchYahooHistorical(code, days).catch(() => [] as Awaited<ReturnType<typeof fetchYahooHistorical>>);
  if (yahoo && yahoo.length > 0) return yahoo;
  if (kisEnabled()) {
    if (isKrStock(code)) {
      const kis = await fetchKrHistorical(code, days);
      if (kis && kis.length > 0) return kis;
    } else if (isUsTicker(code)) {
      const kis = await fetchUsHistorical(code, days);
      if (kis && kis.length > 0) return kis;
    }
  }
  return yahoo;
}

export {
  fetchQuote,
  fetchQuotesBatch,
  fetchHistorical,
  computeTech,
  fetchYahooQuotesBatch,
};
export {
  fetchAllNews,
  riskKeywords,
  fetchNewsForSymbol,
  fetchNewsForSymbols,
  reclassifyWithTitleKo,
} from "./news";

// 외인/기관 수급: KIS(inquire-investor) → 네이버(dealTrendInfos) → mock 순.
// KIS FHKST01010900 은 KRX 원본을 거의 실시간(=토스 증권 데이터) 그대로 주고
// 5일 누적도 거래일 단위로 정확히 합산한다. 네이버 dealTrendInfos 는 5~30분 지연·
// 추정치 섞임이 있어 사용자 보고("토스와 안 맞고 늦음") 의 직접 원인이었음.
// KIS cooldown/EGW00133 등으로 실패하면 네이버로 자연 폴백되어 빈 화면 위험 0.
export async function fetchFlowOrMock(
  code: string,
  currentPrice?: number
): Promise<{
  flow: FlowData;
  source: "naver" | "kis" | "mock";
}> {
  if (!isKrStock(code)) {
    const m = mockFlow(code);
    return { flow: m, source: "mock" };
  }

  // 1순위: KIS 실시간 (FHKST01010900)
  if (kisEnabled()) {
    const kisFlow = await fetchKrFlow(code);
    if (kisFlow && (kisFlow.foreignNet != null || kisFlow.institutionNet != null)) {
      return { flow: kisFlow, source: "kis" };
    }
  }

  // 2순위: 네이버 dealTrendInfos (KIS 실패/비활성/cooldown 시 폴백)
  if (currentPrice) {
    const naverFlow = await fetchNaverFlow(code, currentPrice);
    if (naverFlow && (naverFlow.foreignNet != null || naverFlow.institutionNet != null)) {
      return {
        flow: { ...naverFlow, source: "naver" as const },
        source: "naver",
      };
    }
  }

  const m = mockFlow(code);
  return { flow: m, source: "mock" };
}

export { kisEnabled };
