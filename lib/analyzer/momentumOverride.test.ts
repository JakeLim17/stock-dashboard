import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bumpShortSignalForMomentum,
  detectMomentumOverride,
  applyMomentumScoreAdjust,
  applyMomentumVerdict,
} from "./momentumOverride";
import type { AnalyzeInput } from "./rules";
import type { HistoricalPoint } from "../providers/yahoo";

function baseInput(
  overrides: Partial<AnalyzeInput> = {}
): AnalyzeInput & { history?: HistoricalPoint[] } {
  const base: AnalyzeInput & { history?: HistoricalPoint[] } = {
    quote: {
      code: "000660.KS",
      name: "SK하이닉스",
      price: 210_000,
      prevClose: 198_000,
      changeAbs: 12_000,
      changeRate: 0.06,
      open: 205_000,
      volume: 5_000_000,
      high: 212_000,
      low: 204_000,
      currency: "KRW",
      fetchedAt: Date.now(),
    },
    tech: { rsi14: 72, sma5: 205_000, sma20: 190_000 },
    flow: {
      source: "kis",
      foreignNet: 80_000_000_000,
      institutionNet: 20_000_000_000,
      individualNet: -100_000_000_000,
      foreignNet5d: 320_000_000_000,
      institutionNet5d: 50_000_000_000,
    },
    context: {
      semiHeat: 78,
      nasdaqRate: 0.012,
      fxRate: 0.001,
      vix: 16,
    },
    valuation: {
      per: 18,
      forwardPer: 14,
      pbr: 2.1,
      eps: 10000,
      bps: 100000,
      dividendYield: 0.01,
      week52High: 212_000,
      week52Low: 120_000,
      source: "merged",
      asOf: Date.now(),
    },
    ...overrides,
  };
  if (overrides.quote) base.quote = { ...base.quote, ...overrides.quote };
  if (overrides.flow) base.flow = { ...base.flow, ...overrides.flow };
  return base;
}

describe("momentumOverride", () => {
  it("급등+외인픽+수급 양수 시 override 활성", () => {
    const history = Array.from({ length: 25 }, (_, i) => ({
      date: i,
      open: 180_000 + i * 1000,
      high: 182_000 + i * 1000,
      low: 179_000 + i * 1000,
      close: 181_000 + i * 1000,
      volume: 1_000_000,
    }));
    history[history.length - 1] = {
      ...history[history.length - 1],
      close: 210_000,
      volume: 1_000_000,
    };

    const m = detectMomentumOverride({
      ...baseInput(),
      history,
    });
    assert.equal(m.active, true);
    assert.ok(m.rankBonus > 0);
    assert.equal(m.semiHeatOverridden, true);
  });

  it("mock 수급이면 override 비활성", () => {
    const m = detectMomentumOverride(
      baseInput({
        flow: {
          source: "mock",
          foreignNet: null,
          institutionNet: null,
          individualNet: null,
        },
      })
    );
    assert.equal(m.active, false);
  });

  it("naver fallback(어제 bizdate) 수급이면 override 비활성", () => {
    const m = detectMomentumOverride(
      baseInput({
        flow: {
          source: "naver",
          foreignNet: 80_000_000_000,
          institutionNet: 20_000_000_000,
          individualNet: -100_000_000_000,
          foreignNet5d: 320_000_000_000,
          bizdate: "20260617",
        },
      })
    );
    assert.equal(m.active, false);
  });

  it("kis-unavailable 수급이면 override 비활성", () => {
    const m = detectMomentumOverride(
      baseInput({
        flow: {
          source: "kis-unavailable",
          foreignNet: null,
          institutionNet: null,
          individualNet: null,
        },
      })
    );
    assert.equal(m.active, false);
  });

  it("점수 보정 후 HOLD→ADD 상향 + verdict 관망→추세 추종", () => {
    const momentum = {
      active: true,
      rankBonus: 15,
      strongTrend: true,
      semiHeatOverridden: true,
      reasons: ["외인 5일 누적 +320억"],
      badges: ["과열 추세"],
    };
    const adj = applyMomentumScoreAdjust(72, 48, momentum);
    assert.ok(adj.buy > 48);
    assert.ok(adj.heat < 72);

    assert.equal(bumpShortSignalForMomentum("HOLD"), "ADD");
    assert.equal(bumpShortSignalForMomentum("WATCH"), "HOLD");

    const verdict = applyMomentumVerdict(
      {
        action: "HOLD_WAIT",
        label: "눌림목 대기",
        headline: "장기 양호, 단기 추격 자제",
        tone: "watch",
        detail: "단기 HOLD · 장기 BUY",
      },
      "HOLD",
      "BUY",
      momentum,
      { semiHeat: 78, heat: 65, buy: 62 }
    );
    assert.equal(verdict.action, "SCALE_IN");
    assert.equal(verdict.label, "과열 추세");
    assert.equal(verdict.tone, "add");
    assert.ok(verdict.momentumOverride);

    const shortTrade = applyMomentumVerdict(
      {
        action: "AVOID",
        label: "관망",
        headline: "방향성 불명확 — 관망",
        tone: "watch",
        detail: "단기 WATCH · 장기 SELL",
      },
      "ADD",
      "SELL",
      momentum,
      { semiHeat: 78, heat: 65, buy: 62 }
    );
    assert.equal(shortTrade.action, "SHORT_TRADE");
    assert.equal(shortTrade.tone, "watch");
  });
});
