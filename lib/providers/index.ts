import "server-only";
import { fetchQuote as fetchYahooQuote, fetchQuotesBatch as fetchYahooQuotesBatch, fetchHistorical, computeTech } from "./yahoo";
import { fetchNaverQuote, isKrStock } from "./naver";
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

// 외인/기관 수급: KIS 활성화면 실제, 아니면 mock (UI 깨짐 방지용).
export async function fetchFlowOrMock(code: string): Promise<{
  flow: FlowData;
  source: "kis" | "mock";
}> {
  if (kisEnabled()) {
    const flow = await fetchFlow(code);
    // KIS가 null만 돌려주면 mock fallback
    if (flow.foreignNet != null || flow.institutionNet != null) {
      return { flow: { ...flow, source: "kis" }, source: "kis" };
    }
  }
  const m = mockFlow(code);
  return { flow: m, source: "mock" };
}

export { kisEnabled };
