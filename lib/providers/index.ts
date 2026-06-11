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

// 외인/기관 수급: KIS(inquire-investor) 만 신뢰. 네이버 dealTrendInfos 는 비활성.
//
// 배경 (사용자 보고 비교):
//   토스 삼성전기 오늘 외인 +3,082(백만원=30.82억) / 기관 +7,000 / 개인 0
//   우리 화면(네이버 fallback) 외인 -2,409억 / 기관 -885억 / 개인 +3,426억
//   → 정확히 ~1000배 + 부호 반전.
//
// 네이버 dealTrendInfos 의 응답 단위·부호·시점이 KIS/KRX 와 다르게 해석되는 것으로 보이는데
// production 직접 호출 없이 raw 값을 확정할 수 없어, "잘못된 숫자로 사용자 혼란" 보다
// "비표시 + KIS 복귀 안내" 가 안전하다고 판단 (사용자 결정·옵션 E).
//
// 네이버 호출은 **로그 목적으로 유지** — `naver.ts` 에서 raw bizdate/quant 를 한 줄씩 찍어
// Vercel Functions Logs 로 추적 가능. 추후 단위 확정 시 다시 사용 가능.
//
// KIS 실패 시: source="kis-unavailable" 로 빈 flow 반환 → UI 가 "KIS 일시 실패" 안내.
export async function fetchFlowOrMock(
  code: string,
  currentPrice?: number
): Promise<{
  flow: FlowData;
  source: FlowData["source"];
}> {
  if (!isKrStock(code)) {
    const m = mockFlow(code);
    return { flow: m, source: "mock" };
  }

  // 1순위: KIS 실시간 (FHKST01010900) — 토스/KRX 와 정합.
  if (kisEnabled()) {
    const kisFlow = await fetchKrFlow(code);
    if (kisFlow && (kisFlow.foreignNet != null || kisFlow.institutionNet != null)) {
      return { flow: kisFlow, source: "kis" };
    }
  }

  // 네이버 호출은 raw 값 로깅 목적으로만 실행 — 결과 숫자는 사용 안 함.
  // (단위/부호 확정 후 다시 활성화 시 위 if 블록 바깥에 옮기면 됨.)
  if (currentPrice) {
    await fetchNaverFlow(code, currentPrice).catch(() => null);
  }

  // KIS 실패 + 네이버 비신뢰 → 빈 표시.
  return {
    flow: {
      foreignNet: null,
      institutionNet: null,
      individualNet: null,
      foreignNet5d: null,
      institutionNet5d: null,
      individualNet5d: null,
      source: "kis-unavailable",
      fetchedAt: Date.now(),
    },
    source: "kis-unavailable",
  };
}

export { kisEnabled };
