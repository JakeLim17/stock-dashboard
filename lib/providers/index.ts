import "server-only";
import {
  fetchQuote as fetchYahooQuote,
  fetchQuotesBatch as fetchYahooQuotesBatch,
  fetchHistorical as fetchYahooHistorical,
  computeTech,
  seedHistoryFromQuote,
} from "./yahoo";
import { fetchNaverQuote, fetchNaverFlow, isKrStock } from "./naver";
import {
  fetchKrHistorical,
  fetchUsHistorical,
  kisEnabled,
  yahooIndexToKisCode,
} from "./kis";
import {
  getKrFlowCached,
  getKrIndexCached,
  getKrQuoteCached,
  getUsQuoteCached,
  invalidateKisExtraCache,
} from "./kisExtraCache";
import { mockFlow } from "./mock";
import type { FlowData, Quote } from "../types";

// 라우팅 정책 (2026-06 재정비, 2026-07 KIS OFF 스위치)
// KIS 토큰/문자 부담은 실시간성이 필요한 곳에만. OFF 시 토큰·REST 0회.
//   OFF: KIS_ENABLED 미설정(기본) | KIS_DISABLED=1 | 키 없음 → isKisApiEnabled()
//
//   - 시세(fetchQuote) — KIS ON 일 때
//       한국:   네이버 → KIS 폴백 → Yahoo
//       해외:   KIS(us-stock) 1순위 → Yahoo 폴백
//       한국 지수: KIS → Yahoo
//   - 시세 — KIS OFF 일 때
//       한국:   네이버 → Yahoo / 해외·지수: Yahoo only
//   - 일별(fetchHistorical)
//       Yahoo 1순위 → (KIS ON 시) KIS 폴백
//   - 수급(fetchFlowOrMock)
//       KIS ON:  KIS → 네이버 → kis-unavailable
//       KIS OFF: 네이버 → mock
//
// KIS 전담(다른 진입점에서 호출):
//   - 분봉(1m/5m/15m): app/api/intraday-chart → fetchKrIntradayCandles
//   - 10호가 + 체결강도 + 실시간 체결: app/api/intraday → fetchKrAskingPrice/fetchKrExecutions
//     (StockDetailPanel "호가" 탭 활성 시에만 폴링 — 옵트인)
//   - 시장순위: app/api/leaders → fetchKrMarketLeaders (30s 캐시)
//   - 프로그램매매·공매도: kisExtraCache (snapshot 빌드 시)
//
// KIS 시세·수급은 kisExtraCache 로 세션별 TTL+SWR+in-flight 공유:
//   시세 장중 8s / 장후 45s (+ SWR 20s) · 수급 5분.
//   KR lite 시세는 네이버 1순위라 보통 KIS 시세 TTL과 무관(폴백·지수·해외만 영향).

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
    const kisIdx = await getKrIndexCached(code, name);
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
      const kis = await getKrQuoteCached(code, name);
      if (kis) return kis;
    }
    return fetchYahooQuote(code, name);
  }

  // 해외: KIS(us-stock) 1순위 → Yahoo 폴백.
  // KIS HHDFS00000300 은 ~100ms 안에 실시간 last 를 주는데 Yahoo free API 는 정규장에서도
  // 종종 수 분 stale 응답을 준다. 화면에 "5분 전" 으로 굳어 보이는 원인.
  // KIS 키가 없거나 비ASCII 티커(인덱스/환율)는 자연스럽게 Yahoo 로 떨어진다.
  // 신규상장(SKHY 등)은 KIS 가 rt_cd=0·빈 last 를 주는 경우가 있어 Yahoo chart 폴백이 필수.
  if (kisEnabled() && isUsTicker(code)) {
    const kis = await getUsQuoteCached(code, name).catch(() => null);
    if (kis && kis.price > 0) return kis;
  }
  const yahoo = await fetchYahooQuote(code, name);
  if (!(yahoo.price > 0)) {
    throw new Error(`${code}: 유효 시세 없음`);
  }
  return yahoo;
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
  seedHistoryFromQuote,
};
export {
  fetchAllNews,
  didNewsFetchFail,
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
// 라우팅 (옵션 F): KIS → 네이버 폴백 → kis-unavailable.
//
// 정책:
//   1순위 KIS inquire-investor — KRX 원본·실시간, 토스와 정합.
//   2순위 네이버 dealTrendInfos — 일별 누적. 토요/장후엔 어제 영업일자(`bizdate`) 반환.
//          → bizdate 를 결과에 포함해서 UI 가 "M/D 마감 기준" 라벨로 정직하게 표시.
//          단위/부호: `quant × close = 원`, 매수+/매도-. (직전 검증으로 단위 확정.)
//   3순위 빈 표시 (`kis-unavailable`).
//
// 직전 옵션 E 의 "네이버 응답 무시 + 빈 표시" 정책은 사용자가 production 에서 KIS 가
// 안정화되기 전까지 카드들이 모두 비어 보이는 문제로 이어져 옵션 F 로 부활.
// 잘못된 시점 오해 방지를 위해 bizdate 를 UI 까지 그대로 전달한다.
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
  // 캐시: 장중 1h / 장후·휴장 24h + KV (kisExtraCache.getKrFlowCached).
  if (kisEnabled()) {
    const kisFlow = await getKrFlowCached(code);
    if (kisFlow && (kisFlow.foreignNet != null || kisFlow.institutionNet != null)) {
      return { flow: kisFlow, source: "kis" };
    }
  }

  // 2순위: 네이버 dealTrendInfos. bizdate 가 어제이면 UI 가 "M/D 마감 기준" 라벨로 안내.
  if (currentPrice) {
    const naverFlow = await fetchNaverFlow(code, currentPrice).catch(() => null);
    if (
      naverFlow &&
      (naverFlow.foreignNet != null || naverFlow.institutionNet != null)
    ) {
      return {
        flow: {
          foreignNet: naverFlow.foreignNet,
          institutionNet: naverFlow.institutionNet,
          individualNet: naverFlow.individualNet,
          foreignNet5d: naverFlow.foreignNet5d,
          institutionNet5d: naverFlow.institutionNet5d,
          individualNet5d: naverFlow.individualNet5d,
          foreignStreak: naverFlow.foreignStreak ?? null,
          institutionStreak: naverFlow.institutionStreak ?? null,
          source: "naver",
          bizdate: naverFlow.bizdate,
          fetchedAt: Date.now(),
        },
        source: "naver",
      };
    }
  }

  // KIS OFF 이면 빈 칸 대신 mock (의도적으로 한투를 안 쓰는 설정).
  if (!kisEnabled()) {
    const m = mockFlow(code);
    return { flow: m, source: "mock" };
  }

  // KIS ON 인데 KIS·네이버 모두 실패 → 빈 표시.
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
export { invalidateKisExtraCache };
