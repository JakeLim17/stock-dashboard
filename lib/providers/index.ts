import "server-only";
import { fetchQuote, fetchQuotesBatch, fetchHistorical, computeTech } from "./yahoo";
import { fetchFlow, kisEnabled } from "./kis";
import { mockFlow } from "./mock";
import type { FlowData } from "../types";

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
