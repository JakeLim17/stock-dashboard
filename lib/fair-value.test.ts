import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFairValueEstimate,
  blendCloseFromOpen,
  getSettlementContext,
} from "./fair-value";
import type { Quote, StockSnapshot } from "./types";

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    code: "000660.KS",
    name: "SK하이닉스",
    price: 2_764_000,
    prevClose: 2_685_000,
    changeAbs: 79_000,
    changeRate: 79_000 / 2_685_000,
    volume: null,
    fetchedAt: Date.now(),
    marketState: "CLOSED",
    priceTime: Date.now() - 36 * 3_600_000,
    ...overrides,
  };
}

function minimalSnap(q: Quote): StockSnapshot {
  return {
    meta: { code: q.code, name: q.name, kind: "kr-stock" },
    quote: q,
    tech: {},
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
          low: 2_700_000,
          high: 2_850_000,
          center: 2_781_000,
          confidence: 0.95,
        },
      ],
      targets: null,
      scenarios: [],
      strength: { buy: 50, sell: 30 },
    },
  };
}

describe("getSettlementContext", () => {
  it("장중이면 익일 추정 불가", () => {
    const ctx = getSettlementContext(
      quote({ marketState: "REGULAR" }),
      "000660.KS"
    );
    assert.equal(ctx.ready, false);
    assert.match(ctx.pendingReason ?? "", /앱장/);
  });

  it("앱장 거래중이면 대기", () => {
    const ctx = getSettlementContext(
      quote({
        marketState: "CLOSED",
        extendedHours: {
          session: "kr-after",
          price: 2_770_000,
          changeAbs: 5000,
          changeRate: 0.002,
          active: true,
          regularClose: 2_764_000,
        },
      }),
      "000660.KS"
    );
    assert.equal(ctx.ready, false);
    assert.match(ctx.pendingReason ?? "", /앱장/);
  });

  it("앱장 종료 후 앱장 종가가 기준가", () => {
    const ctx = getSettlementContext(
      quote({
        marketState: "CLOSED",
        extendedHours: {
          session: "kr-after",
          price: 2_770_000,
          changeAbs: 6000,
          changeRate: 0.0022,
          active: false,
          regularClose: 2_764_000,
        },
      }),
      "000660.KS"
    );
    assert.equal(ctx.ready, true);
    assert.equal(ctx.settlementPrice, 2_770_000);
    assert.equal(ctx.settlementLabel, "앱장 종가");
  });
});

describe("buildFairValueEstimate", () => {
  it("앱장 미확정이면 pending", () => {
    const fv = buildFairValueEstimate(
      minimalSnap(quote({ marketState: "REGULAR" }))
    );
    assert.equal(fv.ready, false);
  });

  it("앱장 종료 후 익일 추정가 산출", () => {
    const fv = buildFairValueEstimate(
      minimalSnap(
        quote({
          marketState: "CLOSED",
          extendedHours: {
            session: "kr-after",
            price: 2_770_000,
            changeAbs: 6000,
            changeRate: 0.0022,
            active: false,
            regularClose: 2_764_000,
          },
        })
      )
    );
    assert.equal(fv.ready, true);
    if (fv.ready) {
      assert.ok(fv.open.price > 0);
      assert.ok(fv.close.price > 0);
      assert.equal(fv.settlementPrice, 2_770_000);
      assert.equal(fv.price, fv.open.price);
    }
  });

  it("GDR 야간 혼합 가중치", () => {
    const snap = minimalSnap(
      quote({
        marketState: "CLOSED",
        extendedHours: {
          session: "kr-after",
          price: 100_000,
          changeAbs: 0,
          changeRate: 0,
          active: false,
          regularClose: 100_000,
        },
        price: 100_000,
        prevClose: 95_000,
      })
    );
    snap.meta.code = "005930.KS";
    snap.overseasNight = {
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
    };
    snap.predictions!.ranges[0].center = 101_000;
    const fv = buildFairValueEstimate(snap);
    assert.equal(fv.ready, true);
    if (fv.ready) {
      assert.equal(fv.open.baseBlendedPrice, 106_250);
      assert.equal(fv.open.price, 106_250);
      assert.ok(fv.close.price > 0);
      assert.ok(fv.targetDateLabel.length > 0);
    }
  });

  it("종가 추정은 시가+드리프트 혼합", () => {
    const blended = blendCloseFromOpen(100_000, 102_000);
    assert.equal(blended.price, 101_000);
  });

  it("VIX 공포 시 매크로 하향 보정", () => {
    const snap = minimalSnap(
      quote({
        marketState: "CLOSED",
        extendedHours: {
          session: "kr-after",
          price: 100_000,
          changeAbs: 0,
          changeRate: 0,
          active: false,
          regularClose: 100_000,
        },
        price: 100_000,
        prevClose: 95_000,
      })
    );
    snap.meta.code = "005930.KS";
    snap.marketContext = {
      semiHeat: 50,
      nasdaqRate: 0,
      fxRate: 0,
      vix: 32,
      kospiRate: 0,
      soxRate: 0,
    };
    const fv = buildFairValueEstimate(snap);
    assert.equal(fv.ready, true);
    if (fv.ready) {
      assert.ok(fv.macroRate < 0);
      assert.ok(fv.open.price < fv.open.baseBlendedPrice);
      assert.ok(fv.macroFactors.some((f) => f.label.includes("VIX")));
    }
  });
});
