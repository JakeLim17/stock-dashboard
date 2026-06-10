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

// 라우팅 정책:
//   - 시세(fetchQuote)
//       한국:   KIS → 네이버 → Yahoo
//       해외:   KIS(us-stock 한정) → Yahoo
//       지수/환율/선물: Yahoo (한국 지수 KIS는 KIS_INDEX_ENABLED=1 일 때만)
//   - 일별(fetchHistorical)
//       기본 Yahoo. KIS_HISTORY_ENABLED=1 이면 한국/미국 주식 KIS 우선.
//       기타:  Yahoo
//   - 수급(fetchFlowOrMock)
//       한국:   기본 네이버 → mock. KIS_FLOW_ENABLED=1 이면 KIS 우선.
//       해외:  mock (의미 없음)

function isUsTicker(code: string): boolean {
  // KIS 해외시세는 NYSE/NASDAQ/AMEX 등 미국 종목만 다룬다.
  // 인덱스/환율/선물은 KIS 범위 밖.
  if (code.includes("=") || code.startsWith("^") || code.includes(".")) return false;
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(code);
}

function envEnabled(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function fetchQuote(code: string, name: string): Promise<Quote> {
  // 한국 지수(^KS11, ^KQ11, ^KS200) — KIS inquire-index-price 우선 → Yahoo 폴백.
  // 첫 로딩의 시장 지표는 빠른 표시가 중요해 기본은 Yahoo를 사용한다.
  if (
    envEnabled("KIS_INDEX_ENABLED") &&
    kisEnabled() &&
    yahooIndexToKisCode(code) != null
  ) {
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
    if (kisEnabled()) {
      const kis = await fetchKrQuote(code, name);
      if (kis) return kis;
    }
    const naver = await fetchNaverQuote(code, name);
    if (naver) return naver;
    return fetchYahooQuote(code, name);
  }

  if (kisEnabled() && isUsTicker(code)) {
    const kis = await fetchUsQuote(code, name);
    if (kis) return kis;
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
  // 분석용 일봉은 첫 로딩 병목이 커서 기본 Yahoo를 사용한다.
  // KIS 일봉이 꼭 필요하면 KIS_HISTORY_ENABLED=1 로 opt-in.
  if (envEnabled("KIS_HISTORY_ENABLED") && kisEnabled()) {
    if (isKrStock(code)) {
      const kis = await fetchKrHistorical(code, days);
      if (kis && kis.length > 0) return kis;
    } else if (isUsTicker(code)) {
      const kis = await fetchUsHistorical(code, days);
      if (kis && kis.length > 0) return kis;
    }
  }
  return fetchYahooHistorical(code, days);
}

export {
  fetchQuote,
  fetchQuotesBatch,
  fetchHistorical,
  computeTech,
  fetchYahooQuotesBatch,
};
export { fetchAllNews, riskKeywords } from "./news";

// 외인/기관 수급: KIS → 네이버 → mock 순으로 시도.
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

  if (envEnabled("KIS_FLOW_ENABLED") && kisEnabled()) {
    const kisFlow = await fetchKrFlow(code);
    if (kisFlow && (kisFlow.foreignNet != null || kisFlow.institutionNet != null)) {
      return { flow: kisFlow, source: "kis" };
    }
  }

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
