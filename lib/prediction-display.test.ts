import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFairValueEstimate } from "./prediction-display";
import type { StockSnapshot } from "./types";

function minimalSnap(
  overrides: Partial<StockSnapshot> = {}
): StockSnapshot {
  return {
    meta: { code: "005930.KS", name: "삼성전자", kind: "kr-stock" },
    quote: {
      code: "005930.KS",
      name: "삼성전자",
      price: 100_000,
      prevClose: 95_000,
      changeAbs: 5_000,
      changeRate: 5_000 / 95_000,
      volume: null,
      fetchedAt: Date.now(),
      marketState: "CLOSED",
      ...overrides.quote,
    },
    tech: { rsi14: 50, trend: "sideways", heat: 50 },
    flow: { foreignNet: null, institutionNet: null, individualNet: null },
    analysis: {
      signal: "HOLD",
      headline: "",
      reasons: [],
      buyScore: 50,
      heatScore: 50,
      shortTerm: { signal: "HOLD", headline: "", reasons: [], score: 50 },
      longTerm: { signal: "HOLD", headline: "", reasons: [], score: 50 },
      verdict: {
        action: "HOLD_WAIT",
        label: "HOLD",
        tone: "hold",
        headline: "",
        detail: "",
      },
      externalRisk: {
        level: "low",
        score: 10,
        drivers: [],
        matchCount: 0,
      },
      volatility: { score: 30, level: "moderate", drivers: [] },
    },
    predictions: {
      ranges: [
        {
          horizonDays: 1,
          horizonLabel: "1일",
          low: 98_000,
          high: 102_000,
          center: 101_000,
          confidence: 0.95,
        },
      ],
      targets: null,
      scenarios: [],
      strength: { buy: 50, sell: 30 },
    },
    ...overrides,
  };
}

describe("buildFairValueEstimate", () => {
  it("GDR + 야간 혼합 가중치를 적용한다", () => {
    const snap = minimalSnap({
      overseasNight: {
        baseCode: "005930.KS",
        proxyCode: "SMSN.IL",
        name: "삼성전자 GDR",
        exchange: "LSE",
        sharesPerReceipt: 25,
        price: 10,
        changeRate: 0.01,
        impliedKrwPrice: 110_000,
        krxClose: 100_000,
        fetchedAt: Date.now(),
      },
    });
    const fv = buildFairValueEstimate(snap);
    assert.ok(fv);
    // 110000*0.6 + 101000*0.25 + 100000*0.15 = 106250
    assert.equal(fv!.price, 106_250);
    assert.equal(fv!.methodLabel, "야간 혼합");
  });

  it("GDR 없으면 σ 드리프트 혼합", () => {
    const fv = buildFairValueEstimate(minimalSnap());
    assert.ok(fv);
    // 101000*0.45 + 100000*0.55 = 100450
    assert.equal(fv!.price, 100_450);
    assert.equal(fv!.methodLabel, "σ 드리프트");
  });
});
