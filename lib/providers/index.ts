import "server-only";
import { fetchQuote as fetchYahooQuote, fetchQuotesBatch as fetchYahooQuotesBatch, fetchHistorical, computeTech } from "./yahoo";
import { fetchNaverQuote, fetchNaverFlow, isKrStock } from "./naver";
import { fetchFlow, kisEnabled } from "./kis";
import { mockFlow } from "./mock";
import type { FlowData, Quote } from "../types";

async function fetchQuote(code: string, name: string): Promise<Quote> {
  if (isKrStock(code)) {
    const naver = await fetchNaverQuote(code, name);
    if (naver) return naver;
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

export { fetchQuote, fetchQuotesBatch, fetchHistorical, computeTech };
export { fetchAllNews, riskKeywords } from "./news";

// 외인/기관 수급: Naver > KIS > mock 순으로 시도.
export async function fetchFlowOrMock(
  code: string,
  currentPrice?: number
): Promise<{
  flow: FlowData;
  source: "naver" | "kis" | "mock";
}> {
  // 1) 한국 종목이면 Naver에서 수급 시도
  if (isKrStock(code) && currentPrice) {
    const naverFlow = await fetchNaverFlow(code, currentPrice);
    if (naverFlow && (naverFlow.foreignNet != null || naverFlow.institutionNet != null)) {
      return {
        flow: { ...naverFlow, source: "kis" as const },
        source: "naver",
      };
    }
  }

  // 2) KIS 활성화면 KIS 시도
  if (kisEnabled()) {
    const flow = await fetchFlow(code);
    if (flow.foreignNet != null || flow.institutionNet != null) {
      return { flow: { ...flow, source: "kis" }, source: "kis" };
    }
  }

  // 3) fallback: mock
  const m = mockFlow(code);
  return { flow: m, source: "mock" };
}

export { kisEnabled };
