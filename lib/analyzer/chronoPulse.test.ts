import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHRONO_PULSE_NAME,
  chronoPulseDriftForHorizon,
  computeChronoPulse,
  formatChronoPulseBps,
} from "./chronoPulse";
import type { StockSnapshot } from "../types";

function bearishSnap(): StockSnapshot {
  return {
    meta: { code: "000660.KS", name: "SK하이닉스", kind: "kr-stock", sector: "반도체" },
    quote: {
      code: "000660.KS",
      name: "SK하이닉스",
      price: 2_500_000,
      prevClose: 2_600_000,
      changeAbs: -100_000,
      changeRate: -0.038,
      volume: null,
      fetchedAt: Date.now(),
      valuation: { per: 95, forwardPer: 72, pbr: 4.2 },
    },
    tech: {},
    flow: {
      foreignNet: -50_000_000_000,
      institutionNet: -20_000_000_000,
      foreignNet5d: -400_000_000_000,
      institutionNet5d: -150_000_000_000,
      source: "kis",
    },
    analysis: {
      signal: "SELL",
      headline: "",
      reasons: [],
      buyScore: 32,
      heatScore: 82,
      shortTerm: { signal: "SELL", headline: "", reasons: [], score: 30 },
      longTerm: { signal: "HOLD", headline: "", reasons: [], score: 45 },
      verdict: {
        action: "REDUCE",
        label: "SELL",
        tone: "sell",
        headline: "",
        detail: "",
      },
      externalRisk: {
        level: "high",
        score: 78,
        drivers: [
          {
            label: "지정학",
            category: "지정학",
            headline: "중동 리스크",
            date: Date.now(),
            weight: 1,
            contribution: 40,
          },
        ],
        matchCount: 4,
      },
      externalOpportunity: { level: "low", score: 5, drivers: [], matchCount: 0 },
      volatility: { score: 72, level: "high", drivers: [] },
    },
    predictions: {
      ranges: [],
      targets: null,
      scenarios: [],
      strength: { buy: 32, sell: 70 },
      macroBetas: {
        ixic: { beta: 1.1, r2: 0.45, residStd: 0.02, samples: 55 },
        sox: { beta: 1.3, r2: 0.52, residStd: 0.025, samples: 55 },
      },
    },
    marketContext: {
      vix: 26,
      nasdaqRate: -0.018,
      soxRate: -0.022,
      kospiRate: -0.012,
      fxRate: 0.008,
      semiHeat: 78,
    },
    consensus: {
      targetMean: 2_200_000,
      targetMedian: 2_200_000,
      targetHigh: 2_500_000,
      targetLow: 1_900_000,
      upsidePercent: -0.12,
      analystCount: 20,
      recommendationKey: "hold",
      recommendationMean: 3.2,
      strongBuy: 2,
      buy: 5,
      hold: 10,
      sell: 3,
      strongSell: 0,
      source: "merged",
      asOf: Date.now(),
    },
  };
}

describe("ChronoPulse", () => {
  it("알고리즘 이름·부제 노출", () => {
    const r = computeChronoPulse({
      quote: bearishSnap().quote,
      flow: bearishSnap().flow,
      buyScore: 32,
      heatScore: 82,
      externalRisk: bearishSnap().analysis.externalRisk,
      externalOpportunity: bearishSnap().analysis.externalOpportunity,
      meta: bearishSnap().meta,
      marketContext: bearishSnap().marketContext,
      predictions: bearishSnap().predictions,
      consensusUpside: -0.12,
      todayChangeRate: -0.038,
    });
    assert.equal(r.name, CHRONO_PULSE_NAME);
    assert.ok(r.subtitle.length > 0);
  });

  it("하락 모멘텀·악재·외국인 순매도 → 음의 drift", () => {
    const snap = bearishSnap();
    const r = computeChronoPulse({
      meta: snap.meta,
      quote: snap.quote,
      flow: snap.flow,
      buyScore: snap.analysis.buyScore,
      heatScore: snap.analysis.heatScore,
      externalRisk: snap.analysis.externalRisk,
      externalOpportunity: snap.analysis.externalOpportunity,
      valuation: snap.quote.valuation,
      consensusUpside: snap.consensus?.upsidePercent,
      marketContext: snap.marketContext,
      predictions: snap.predictions,
      todayChangeRate: snap.quote.changeRate,
      newsRisk: snap.analysis.externalRisk,
    });
    assert.ok(r.driftDaily < 0, `expected negative drift, got ${r.driftDaily}`);
    const supply = r.factors.find((f) => f.id === "supply");
    assert.ok(supply && supply.bps < 0, "수급 요인 음수");
    const news = r.factors.find((f) => f.id === "news-risk");
    assert.ok(news && news.bps < 0, "뉴스 리스크 음수");
  });

  it("장기 horizon drift도 음수 가능", () => {
    const snap = bearishSnap();
    const daily = computeChronoPulse({
      meta: snap.meta,
      quote: snap.quote,
      flow: snap.flow,
      buyScore: snap.analysis.buyScore,
      heatScore: snap.analysis.heatScore,
      externalRisk: snap.analysis.externalRisk,
      marketContext: snap.marketContext,
      predictions: snap.predictions,
      consensusUpside: -0.12,
      todayChangeRate: -0.038,
    });
    const month = chronoPulseDriftForHorizon(daily.driftDaily, 22, {
      structuralDaily: daily.structuralDaily,
      lag0Daily: daily.lag0Daily,
    });
    assert.ok(month < 0);
  });

  it("호재 뉴스가 있으면 구조 drift가 양수로 커진다", () => {
    const snap = bearishSnap();
    const base = computeChronoPulse({
      meta: snap.meta,
      quote: snap.quote,
      flow: { foreignNet: null, institutionNet: null, individualNet: null, source: "mock" },
      buyScore: 50,
      heatScore: 50,
      externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
      externalOpportunity: { level: "low", score: 0, drivers: [], matchCount: 0 },
    });
    const withNews = computeChronoPulse({
      meta: snap.meta,
      quote: snap.quote,
      flow: { foreignNet: null, institutionNet: null, individualNet: null, source: "mock" },
      buyScore: 50,
      heatScore: 50,
      externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
      externalOpportunity: {
        level: "high",
        score: 70,
        drivers: [
          {
            label: "HBM",
            category: "수주",
            headline: "하이닉스 HBM 수주 확대",
            date: Date.now(),
            weight: 3,
            contribution: 3,
          },
        ],
        matchCount: 2,
      },
    });
    assert.ok(
      withNews.structuralDaily > base.structuralDaily,
      `expected structural boost, base=${base.structuralDaily} with=${withNews.structuralDaily}`
    );
    assert.ok(withNews.factors.some((f) => f.id === "news-opp"));
    assert.ok(!withNews.factors.some((f) => f.id === "news-calm"));
    const month = chronoPulseDriftForHorizon(withNews.driftDaily, 22, {
      structuralDaily: withNews.structuralDaily,
      lag0Daily: withNews.lag0Daily,
    });
    assert.ok(
      Math.abs(month) > Math.abs(withNews.lag0Daily) * 0.1,
      "월간 곡선이 lag0만으로 평평하지 않아야 함"
    );
  });

  it("formatChronoPulseBps — 부호 표기", () => {
    assert.equal(formatChronoPulseBps(-35), "-0.3%");
    assert.equal(formatChronoPulseBps(30), "+0.3%");
  });
});
