import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMacroFairValueAdjustment } from "./fair-value-macro";
import type { StockSnapshot } from "./types";

function baseSnap(): StockSnapshot {
  return {
    meta: { code: "000660.KS", name: "SK하이닉스", kind: "kr-stock" },
    quote: {
      code: "000660.KS",
      name: "SK하이닉스",
      price: 2_764_000,
      prevClose: 2_685_000,
      changeAbs: 79_000,
      changeRate: 0.029,
      volume: null,
      fetchedAt: Date.now(),
    },
    tech: {},
    flow: { foreignNet: null, institutionNet: null, individualNet: null },
    analysis: {
      signal: "HOLD",
      headline: "",
      reasons: [],
      buyScore: 62,
      heatScore: 78,
      shortTerm: { signal: "HOLD", headline: "", reasons: [], score: 50 },
      longTerm: { signal: "HOLD", headline: "", reasons: [], score: 50 },
      verdict: {
        action: "HOLD_WAIT",
        label: "HOLD",
        tone: "hold",
        headline: "",
        detail: "",
      },
      externalRisk: { level: "low", score: 10, drivers: [], matchCount: 0 },
      externalOpportunity: { level: "high", score: 70, drivers: [], matchCount: 2 },
      volatility: { score: 30, level: "moderate", drivers: [] },
    },
    predictions: {
      ranges: [],
      targets: null,
      scenarios: [],
      strength: { buy: 62, sell: 30 },
    },
    marketContext: {
      semiHeat: 72,
      nasdaqRate: 0,
      fxRate: 0,
      vix: 16,
      kospiRate: 0,
      soxRate: 0,
    },
    consensus: {
      targetMean: 3_100_000,
      targetMedian: 3_050_000,
      targetHigh: 3_400_000,
      targetLow: 2_800_000,
      upsidePercent: 0.12,
      analystCount: 24,
      recommendationKey: "buy",
      recommendationMean: 2.1,
      strongBuy: 8,
      buy: 10,
      hold: 5,
      sell: 1,
      strongSell: 0,
      source: "merged",
      asOf: Date.now(),
    },
    upcomingEvents: [
      {
        kind: "earnings",
        date: Date.now() + 12 * 86_400_000,
        label: "SK하이닉스 미국 ADR 상장",
        importance: "high",
        symbolCode: "000660.KS",
        detail: "ipo",
      },
      {
        kind: "earnings",
        date: Date.now() + 28 * 86_400_000,
        label: "SK하이닉스 실적 발표",
        importance: "high",
        symbolCode: "000660.KS",
      },
    ],
  };
}

describe("computeMacroFairValueAdjustment horizon", () => {
  it("1개월은 내일보다 호재·컨센 반영이 크다", () => {
    const snap = baseSnap();
    const tomorrow = computeMacroFairValueAdjustment(snap, {
      horizon: "tomorrow",
    });
    const month = computeMacroFairValueAdjustment(snap, { horizon: "month" });
    assert.ok(month.rate > tomorrow.rate);
    assert.ok(month.factors.some((f) => f.label === "일정 호재"));
    assert.ok(month.factors.some((f) => f.label === "컨센 목표"));
  });

  it("장기 시계는 단기 과열·반도체 과열 페널티를 완화한다", () => {
    const snap = baseSnap();
    const tomorrow = computeMacroFairValueAdjustment(snap, {
      horizon: "tomorrow",
    });
    const month = computeMacroFairValueAdjustment(snap, { horizon: "month" });
    assert.ok(
      tomorrow.factors.some((f) => f.label === "단기 과열" || f.label === "반도체 과열")
    );
    assert.ok(!month.factors.some((f) => f.label === "단기 과열"));
    assert.ok(!month.factors.some((f) => f.label === "반도체 과열"));
  });

  it("7월 초 분할·지배구조 호재가 custom catalyst로 잡힌다", () => {
    const snap = baseSnap();
    snap.meta = { code: "402340.KS", name: "SK스퀘어", kind: "kr-stock" };
    snap.quote.code = "402340.KS";
    snap.upcomingEvents = [
      {
        kind: "earnings",
        date: Date.now() + 4 * 86_400_000,
        label: "SK스퀘어 지배구조·분할 전환 기대",
        importance: "medium",
        symbolCode: "402340.KS",
        detail: "지주 구조 개선·분할 이슈",
      },
    ];
    const tomorrow = computeMacroFairValueAdjustment(snap, {
      horizon: "tomorrow",
    });
    assert.ok(tomorrow.factors.some((f) => f.label === "일정 호재"));
    const catalyst = tomorrow.factors.find((f) => f.label === "일정 호재");
    assert.ok(catalyst && catalyst.bps > 0);
  });

  it("컨센 하방(목표가 < 현재가)이면 월간 컨센 팩터가 음수", () => {
    const snap = baseSnap();
    snap.upcomingEvents = [];
    snap.analysis.externalOpportunity = {
      level: "low",
      score: 5,
      drivers: [],
      matchCount: 0,
    };
    snap.consensus = {
      ...snap.consensus!,
      targetMean: 2_400_000,
      upsidePercent: -0.13,
    };
    const month = computeMacroFairValueAdjustment(snap, { horizon: "month" });
    const consensusFactor = month.factors.find((f) => f.label === "컨센 목표");
    assert.ok(consensusFactor, "컨센 목표 팩터 존재");
    assert.ok(
      consensusFactor!.bps < 0,
      `하방 컨센은 음수 bps여야 함, got ${consensusFactor!.bps}`
    );
  });

  it("부풀린 컨센 upside(+80%)도 월간 ±2.5% 상한으로 억제", () => {
    const snap = baseSnap();
    snap.consensus = {
      ...snap.consensus!,
      upsidePercent: 0.8,
    };
    const month = computeMacroFairValueAdjustment(snap, { horizon: "month" });
    const consensusFactor = month.factors.find((f) => f.label === "컨센 목표");
    assert.ok(consensusFactor);
    assert.ok(
      consensusFactor!.bps <= 250,
      `월간 컨센 상한 250bps 초과: ${consensusFactor!.bps}`
    );
  });

  it("SK스퀘어는 하이닉스 ADR 일정 호재를 장기에 반영", () => {
    const snap = baseSnap();
    snap.meta = { code: "402340.KS", name: "SK스퀘어", kind: "kr-stock" };
    snap.quote.code = "402340.KS";
    snap.quote.name = "SK스퀘어";
    snap.upcomingEvents = [
      {
        kind: "earnings",
        date: Date.now() + 10 * 86_400_000,
        label: "SK하이닉스 미국 ADR 상장",
        importance: "medium",
        symbolCode: "402340.KS",
        detail: "하이닉스 ADR·실적 연동",
      },
    ];
    const month = computeMacroFairValueAdjustment(snap, { horizon: "month" });
    assert.ok(month.rate > 0);
    assert.ok(month.factors.some((f) => f.label === "일정 호재"));
  });
});
