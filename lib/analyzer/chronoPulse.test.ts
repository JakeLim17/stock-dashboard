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
  it("알고리즘 이름은 UI용 「예측」", () => {
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
    assert.equal(r.name, "예측");
    assert.equal(r.subtitle, "");
  });

  it("SKHY·원주 — 상장·ADR 호재 요인", () => {
    const listingDate = Date.UTC(2026, 6, 10) - 9 * 3600_000; // 2026-07-10 KST
    const r = computeChronoPulse({
      quote: bearishSnap().quote,
      flow: { foreignNet: 0, institutionNet: 0, individualNet: 0 },
      buyScore: 50,
      heatScore: 50,
      externalRisk: {
        level: "low",
        score: 0,
        drivers: [],
        matchCount: 0,
      },
      meta: {
        code: "SKHY",
        name: "SK하이닉스 ADR",
        kind: "us-stock",
        sector: "글로벌반도체",
      },
      events: [
        {
          kind: "earnings",
          symbolCode: "SKHY",
          label: "SKHY 나스닥 ADR 상장",
          date: listingDate,
          importance: "high",
          detail: "NASDAQ 직상장 · ipo",
        },
      ],
    });
    const listing = r.factors.find((f) => f.id === "listing-adr");
    assert.ok(listing, "상장·ADR 호재 요인 필요");
    assert.ok(listing!.bps > 0, `bps=${listing!.bps}`);
    assert.match(listing!.label, /상장|ADR/);
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
    const supply = r.factors.find((f) => f.id.startsWith("supply"));
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

  it("SKHY ADR +15% → 000660 단기 overnight 알파 유의미 증가", () => {
    const base = computeChronoPulse({
      meta: bearishSnap().meta,
      quote: bearishSnap().quote,
      flow: { foreignNet: null, institutionNet: null, source: "kis-unavailable" },
      buyScore: 50,
      heatScore: 50,
      externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
      overseasNightRate: 0,
      overseasNightKind: "adr",
    });
    const surge = computeChronoPulse({
      meta: bearishSnap().meta,
      quote: bearishSnap().quote,
      flow: { foreignNet: null, institutionNet: null, source: "kis-unavailable" },
      buyScore: 50,
      heatScore: 50,
      externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
      overseasNightRate: 0.15,
      overseasNightKind: "adr",
    });
    const overnight = surge.factors.find((f) => f.id === "overnight");
    assert.ok(overnight, "overnight 요인 필요");
    assert.equal(overnight!.bps, 200); // 15%×40% → 캡 200bps
    assert.match(overnight!.label, /^ADR 야간 \+2\.0% 반영$/);
    assert.ok(
      surge.lag0Daily > base.lag0Daily + 0.01,
      `ADR 급등 시 lag0 증가: base=${base.lag0Daily} surge=${surge.lag0Daily}`
    );
    // 1거래일 horizon에 단기 집중
    const d1 = chronoPulseDriftForHorizon(surge.driftDaily, 1, {
      structuralDaily: surge.structuralDaily,
      lag0Daily: surge.lag0Daily,
    });
    const d10 = chronoPulseDriftForHorizon(surge.driftDaily, 10, {
      structuralDaily: surge.structuralDaily,
      lag0Daily: surge.lag0Daily,
    });
    assert.ok(d1 > d10 * 0.5 || surge.lag0Daily > 0.01, "단기(1~2일) 가중");
  });

  it("한국 종목 — 야간 선물 칩 (확정 아님, 캡 안)", () => {
    const r = computeChronoPulse({
      meta: bearishSnap().meta,
      quote: bearishSnap().quote,
      flow: { foreignNet: null, institutionNet: null, source: "kis-unavailable" },
      buyScore: 50,
      heatScore: 50,
      externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
      marketContext: {
        vix: 16,
        nasdaqRate: 0.01,
        esRate: 0.008,
        ymRate: 0.006,
        soxRate: 0,
        kospiRate: 0,
        fxRate: 0,
        semiHeat: 50,
      },
    });
    const chip = r.factors.find((f) => f.id === "night-fut");
    assert.ok(chip);
    assert.match(chip!.label, /^야간 선물 \+/);
    assert.ok(chip!.bps > 0 && chip!.bps <= 80);
  });

  it("000660 상장 구간 — ADR 급등 시 overnight·listing 동방향·1개월 완만", () => {
    const listingDate = Date.now() - 2 * 86_400_000;
    const resolvedRate = 168 / 149 - 1; // 공모 대비 급등
    const r = computeChronoPulse({
      meta: {
        code: "000660.KS",
        name: "SK하이닉스",
        kind: "kr-stock",
        sector: "반도체",
      },
      quote: bearishSnap().quote,
      flow: {
        foreignNet: -300_000_000_000,
        institutionNet: -50_000_000_000,
        foreignNet5d: -600_000_000_000,
        foreignStreak: -4,
        source: "kis",
      },
      buyScore: 40,
      heatScore: 81,
      externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
      events: [
        {
          kind: "earnings",
          symbolCode: "000660.KS",
          label: "SK하이닉스 미국 ADR 상장",
          date: listingDate,
          importance: "high",
          detail: "ADR 상장",
        },
      ],
      overseasNightRate: resolvedRate,
      overseasNightKind: "adr",
    });
    const overnight = r.factors.find((f) => f.id === "overnight");
    const listing = r.factors.find((f) => f.id === "listing-adr");
    assert.ok(overnight && overnight.bps > 0, "ADR 야간 양수");
    assert.ok(listing && listing.bps > 0, "상장 호재 양수");
    const d1 = chronoPulseDriftForHorizon(r.driftDaily, 1, {
      structuralDaily: r.structuralDaily,
      lag0Daily: r.lag0Daily,
    });
    const d22 = chronoPulseDriftForHorizon(r.driftDaily, 22, {
      structuralDaily: r.structuralDaily,
      lag0Daily: r.lag0Daily,
    });
    assert.ok(d1 > 0, `1일 상방 expected, got ${d1}`);
    assert.ok(d22 > -0.055, `1개월 −5.5% 초과 하방 금지, got ${d22}`);
    // 예측 center 환산 — SKHY +12% 이상이면 1일 center > 현재가
    const price = 2_180_000;
    assert.ok(
      price * Math.exp(d1) > price,
      "000660 1일 center > 현재가"
    );
  });

  it("외인 연속매수·5일 누적 칩", () => {
    const r = computeChronoPulse({
      meta: bearishSnap().meta,
      quote: bearishSnap().quote,
      flow: {
        foreignNet: 50_000_000_000,
        institutionNet: 10_000_000_000,
        foreignNet5d: 250_000_000_000,
        institutionNet5d: 50_000_000_000,
        foreignStreak: 4,
        institutionStreak: 3,
        source: "kis",
      },
      buyScore: 55,
      heatScore: 45,
      externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
    });
    const f5 = r.factors.find((f) => f.id === "supply-f5");
    const streak = r.factors.find((f) => f.id === "supply-fstreak");
    const iStreak = r.factors.find((f) => f.id === "supply-istreak");
    assert.ok(f5 && f5.bps > 0, "외인 5일 순매수");
    assert.ok(streak && /외인 연속매수 4일/.test(streak.label));
    assert.ok(iStreak && /기관 연속매수 3일/.test(iStreak.label));
  });

  it("해외 종목은 수급 칩 스킵", () => {
    const r = computeChronoPulse({
      meta: {
        code: "NVDA",
        name: "엔비디아",
        kind: "us-stock",
        sector: "글로벌반도체",
      },
      quote: { ...bearishSnap().quote, code: "NVDA", name: "엔비디아" },
      flow: {
        foreignNet: 100_000_000_000,
        institutionNet: 50_000_000_000,
        foreignNet5d: 500_000_000_000,
        foreignStreak: 5,
        source: "mock",
      },
      buyScore: 50,
      heatScore: 50,
      externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
    });
    assert.ok(!r.factors.some((f) => f.id.startsWith("supply")));
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
