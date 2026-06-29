import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyGroupCatalystSpillover,
  computeGroupLeaderSpilloverBps,
} from "./group-catalyst-spillover";
import { computeMacroFairValueAdjustment } from "./fair-value-macro";
import type { StockSnapshot } from "./types";

function miniSnap(
  code: string,
  name: string,
  buyScore: number,
  opts: {
    momentum?: boolean;
    opp?: "low" | "medium" | "high";
    events?: StockSnapshot["upcomingEvents"];
  } = {}
): StockSnapshot {
  return {
    meta: { code, name, kind: "kr-stock" },
    quote: {
      code,
      name,
      price: 100_000,
      prevClose: 98_000,
      changeAbs: 2_000,
      changeRate: 0.02,
      volume: null,
      fetchedAt: Date.now(),
    },
    tech: {},
    flow: { foreignNet: null, institutionNet: null, individualNet: null },
    analysis: {
      signal: "HOLD",
      headline: "",
      reasons: [],
      buyScore,
      heatScore: 55,
      shortTerm: { signal: "HOLD", headline: "", reasons: [], score: 50 },
      longTerm: { signal: "HOLD", headline: "", reasons: [], score: 50 },
      verdict: {
        action: "HOLD",
        label: "관망",
        tone: "hold",
        headline: "",
        detail: "",
        momentumOverride: opts.momentum,
      },
      externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
      externalOpportunity: {
        level: opts.opp ?? "low",
        score: opts.opp === "high" ? 70 : 10,
        drivers: [],
        matchCount: 0,
      },
    },
    upcomingEvents: opts.events,
    marketContext: {
      semiHeat: 70,
      nasdaqRate: 0,
      fxRate: 0,
      vix: 16,
      kospiRate: 0,
      soxRate: 0,
    },
  };
}

describe("group-catalyst-spillover", () => {
  it("하이닉스 강세 시 SK스퀘어 buy·fair-value가 상대적으로 올라간다", () => {
    const hynix = miniSnap("000660.KS", "SK하이닉스", 68, {
      momentum: true,
      opp: "high",
    });
    const squareBefore = miniSnap("402340.KS", "SK스퀘어", 50, { opp: "low" });
    const squareAfter = miniSnap("402340.KS", "SK스퀘어", 50, { opp: "low" });

    applyGroupCatalystSpillover([hynix, squareAfter]);

    assert.ok(squareAfter.analysis.buyScore > squareBefore.analysis.buyScore);
    assert.ok(squareAfter.groupLeaderContext);
    assert.match(
      squareAfter.analysis.shortTerm.reasons.join(" "),
      /SK 계열 호재 연동/
    );

    const macroBefore = computeMacroFairValueAdjustment(squareBefore, {
      horizon: "tomorrow",
    });
    squareAfter.groupLeaderContext = {
      leaderCode: "000660.KS",
      leaderName: "SK하이닉스",
      catalystShare: 0.88,
      label: "하이닉스 ADR·실적 연동",
      leaderBuyScore: 68,
      leaderMomentum: true,
      opportunityLevel: "high",
    };
    const macroAfter = computeMacroFairValueAdjustment(squareAfter, {
      horizon: "tomorrow",
    });
    assert.ok(macroAfter.rate > macroBefore.rate);
    assert.ok(macroAfter.factors.some((f) => f.label === "SK 계열 연동"));
  });

  it("리더 약세면 spillover bps가 0에 가깝다", () => {
    const bps = computeGroupLeaderSpilloverBps({
      leaderCode: "000660.KS",
      leaderName: "SK하이닉스",
      catalystShare: 0.88,
      label: "연동",
      leaderBuyScore: 48,
      leaderMomentum: false,
      opportunityLevel: "low",
    });
    assert.equal(bps, 0);
  });
});
