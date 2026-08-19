import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFairValueDailySeries,
  buildFairValueEstimate,
  buildMultiHorizonFairValue,
  blendCloseFromOpen,
  getSettlementContext,
  macroGapScale,
} from "./fair-value";
import type { Quote, StockSnapshot } from "./types";

describe("macroGapScale", () => {
  it("1일 갭은 1", () => {
    assert.equal(macroGapScale(1), 1);
  });
  it("3일 갭은 완화", () => {
    assert.ok(macroGapScale(3) < 0.7);
    assert.ok(macroGapScale(3) > 0.5);
  });
});

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

  it("일별 시리즈 — 앵커 일치·거래일 스킵·√t 밴드 확장", () => {
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
        prevClose: 99_000,
      })
    );
    snap.predictions!.ranges = [
      { horizonDays: 1, horizonLabel: "1일", low: 98_000, high: 102_000, center: 100_000, confidence: 0.95 },
      { horizonDays: 5, horizonLabel: "1주", low: 95_600, high: 104_600, center: 100_000, confidence: 0.95 },
      { horizonDays: 22, horizonLabel: "1개월", low: 91_000, high: 109_900, center: 100_000, confidence: 0.95 },
    ];
    const horizons = buildMultiHorizonFairValue(snap);
    const series = buildFairValueDailySeries({
      code: snap.meta.code,
      horizons,
      ranges: snap.predictions!.ranges,
      basePrice: snap.quote.price,
      now: new Date("2026-06-17T12:00:00+09:00"),
    });

    // 오늘(0) ~ 1개월(22) 매 거래일
    assert.equal(series.length, 23);
    assert.equal(series[0].sessionOffset, 0);
    assert.equal(series[22].sessionOffset, 22);

    // 4개 앵커 시점의 일별 값 = 원본 추정치와 정확히 일치
    const offsetById = { today: 0, tomorrow: 1, week: 5, month: 22 } as const;
    for (const h of horizons) {
      if (!h.estimate.ready) continue;
      const pt = series.find(
        (p) => p.sessionOffset === offsetById[h.id]
      );
      assert.ok(pt, `${h.id} 앵커 누락`);
      assert.equal(pt!.price, h.estimate.close.price);
      assert.equal(pt!.horizonId, h.id);
    }

    // 주말 스킵 — 모든 날짜가 서로 다른 거래일
    const isoSet = new Set(series.map((p) => p.isoDate));
    assert.equal(isoSet.size, series.length);

    // 밴드 — 상대 폭이 √t 로 단조 확장 (offset 1 → 22)
    const relWidth = (p: (typeof series)[number]) =>
      p.low != null && p.high != null ? (p.high - p.low) / p.price : 0;
    for (let i = 2; i < series.length; i++) {
      assert.ok(
        relWidth(series[i]) >= relWidth(series[i - 1]) - 1e-9,
        `밴드 폭 역전 @offset ${i}`
      );
    }
    // knot 시점(5일)에서 predictor 상대 폭과 일치
    const d5 = series.find((p) => p.sessionOffset === 5)!;
    const expected = (104_600 - 95_600) / 100_000;
    assert.ok(Math.abs(relWidth(d5) - expected) < 0.002);
  });

  it("일별 시리즈 — 요인 경로면 day-to-day 변화가 수평이 아님", () => {
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
        prevClose: 99_000,
      })
    );
    // 의도적으로 flat-ish 앵커 (예전 보간은 거의 수평)
    snap.predictions!.ranges = [
      { horizonDays: 1, horizonLabel: "1일", low: 99_000, high: 101_500, center: 100_400, confidence: 0.95 },
      { horizonDays: 5, horizonLabel: "1주", low: 97_000, high: 103_500, center: 100_200, confidence: 0.95 },
      { horizonDays: 22, horizonLabel: "1개월", low: 92_000, high: 108_000, center: 100_100, confidence: 0.95 },
    ];
    const horizons = buildMultiHorizonFairValue(snap);
    const series = buildFairValueDailySeries({
      code: snap.meta.code,
      horizons,
      ranges: snap.predictions!.ranges,
      basePrice: snap.quote.price,
      now: new Date("2026-06-17T12:00:00+09:00"),
      pathFactors: [
        { id: "listing-adr", label: "상장·ADR 호재", bps: 40 },
        { id: "supply", label: "수급 순매수", bps: 25 },
        { id: "ixic", label: "나스닥", bps: -15 },
      ],
      realizedVol: 0.015,
      // 상승→급락→반등 패턴 (종목 A)
      recentLogReturns: [
        0.012, 0.008, -0.004, 0.015, -0.02, 0.006, -0.011, 0.009, 0.003, -0.007,
      ],
    });
    let absSum = 0;
    const rets: number[] = [];
    for (let i = 1; i < series.length; i++) {
      const d = series[i]!.price - series[i - 1]!.price;
      absSum += Math.abs(d);
      rets.push(d);
    }
    assert.ok(absSum > 500, `absSum=${absSum} — flat 금지`);
    // 부호가 한쪽으로만 고정되지 않게 (오르락내리락)
    const ups = rets.filter((r) => r > 0).length;
    const downs = rets.filter((r) => r < 0).length;
    assert.ok(ups >= 2 && downs >= 2, `ups=${ups} downs=${downs}`);
    // 시각적 flat 방지 — peak-to-trough 가 가격의 ≥2% (픽셀 대비 확보)
    const prices = series.map((p) => p.price);
    const spanPct =
      ((Math.max(...prices) - Math.min(...prices)) / series[0]!.price) * 100;
    assert.ok(spanPct >= 3.2, `spanPct=${spanPct.toFixed(2)} — 육안 굴곡 부족`);
  });

  it("약한 요인+수평 앵커여도 realizedVol 스케일로 굴곡 유지", () => {
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
        prevClose: 100_000,
      })
    );
    snap.predictions!.ranges = [
      { horizonDays: 1, horizonLabel: "1일", low: 99_000, high: 101_000, center: 100_200, confidence: 0.95 },
      { horizonDays: 5, horizonLabel: "1주", low: 97_500, high: 102_500, center: 100_100, confidence: 0.95 },
      { horizonDays: 22, horizonLabel: "1개월", low: 93_000, high: 107_000, center: 100_050, confidence: 0.95 },
    ];
    const horizons = buildMultiHorizonFairValue(snap);
    const series = buildFairValueDailySeries({
      code: snap.meta.code,
      horizons,
      ranges: snap.predictions!.ranges,
      basePrice: 100_000,
      now: new Date("2026-06-17T12:00:00+09:00"),
      pathFactors: [{ id: "supply", label: "수급", bps: 6 }],
      realizedVol: 0.018,
      recentLogReturns: [
        -0.01, 0.004, 0.012, -0.008, 0.006, -0.015, 0.011, 0.002, -0.005, 0.008,
      ],
    });
    const prices = series.map((p) => p.price);
    const spanPct =
      ((Math.max(...prices) - Math.min(...prices)) / 100_000) * 100;
    assert.ok(spanPct >= 3.5, `weak-factor spanPct=${spanPct.toFixed(2)}`);
    // 앵커 일치
    const d1 = series.find((p) => p.sessionOffset === 1)!;
    const d5 = series.find((p) => p.sessionOffset === 5)!;
    const tomorrow = horizons.find((h) => h.id === "tomorrow")!.estimate;
    const week = horizons.find((h) => h.id === "week")!.estimate;
    assert.ok(tomorrow.ready && week.ready);
    assert.equal(d1.price, tomorrow.close.price);
    assert.equal(d5.price, week.close.price);
  });

  it("종목별 최근 수익률·요인이 다르면 일별 center Δ% 상관이 과도하지 않음", () => {
    // 예전 sine/bend 템플릿은 vol만 달라도 모양이 거의 동일 → 상관 ≈ 1
    function closedSnap(ranges: NonNullable<StockSnapshot["predictions"]>["ranges"]) {
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
          prevClose: 99_000,
        })
      );
      snap.predictions!.ranges = ranges;
      return snap;
    }
    const rangesA = [
      { horizonDays: 1, horizonLabel: "1일", low: 98_000, high: 104_000, center: 102_000, confidence: 0.95 },
      { horizonDays: 5, horizonLabel: "1주", low: 95_000, high: 108_000, center: 103_500, confidence: 0.95 },
      { horizonDays: 22, horizonLabel: "1개월", low: 88_000, high: 115_000, center: 105_000, confidence: 0.95 },
    ];
    const rangesB = [
      { horizonDays: 1, horizonLabel: "1일", low: 96_000, high: 101_000, center: 98_500, confidence: 0.95 },
      { horizonDays: 5, horizonLabel: "1주", low: 92_000, high: 102_000, center: 97_000, confidence: 0.95 },
      { horizonDays: 22, horizonLabel: "1개월", low: 85_000, high: 105_000, center: 96_000, confidence: 0.95 },
    ];
    const snapA = closedSnap(rangesA);
    const snapB = closedSnap(rangesB);
    snapA.meta.code = "402340.KS";
    snapB.meta.code = "000660.KS";

    const seriesA = buildFairValueDailySeries({
      code: snapA.meta.code,
      horizons: buildMultiHorizonFairValue(snapA),
      ranges: rangesA,
      basePrice: 100_000,
      now: new Date("2026-06-17T12:00:00+09:00"),
      pathFactors: [
        { id: "supply-fstreak", label: "외인연속", bps: 35 },
        { id: "listing-adr", label: "ADR", bps: 28 },
      ],
      realizedVol: 0.028,
      recentLogReturns: [
        0.03, -0.02, 0.025, 0.01, -0.035, 0.015, -0.01, 0.02, -0.005, 0.018,
      ],
    });
    const seriesB = buildFairValueDailySeries({
      code: snapB.meta.code,
      horizons: buildMultiHorizonFairValue(snapB),
      ranges: rangesB,
      basePrice: 100_000,
      now: new Date("2026-06-17T12:00:00+09:00"),
      pathFactors: [
        { id: "valuation", label: "밸류", bps: -20 },
        { id: "ixic", label: "나스닥", bps: -18 },
        { id: "supply", label: "수급", bps: 8 },
      ],
      realizedVol: 0.014,
      recentLogReturns: [
        -0.008, -0.012, 0.004, -0.006, 0.002, -0.01, 0.003, -0.005, 0.001, -0.004,
      ],
    });

    const n = Math.min(seriesA.length, seriesB.length);
    // 앵커 구간별 선형(piecewise chord) 대비 잔차 — 글로벌 chord면 반대 앵커만으로도 미러처럼 보임
    const anchorOffs = [0, 1, 5, 22].filter((d) => d < n);
    const segResid = (series: typeof seriesA) => {
      const lns = series.slice(0, n).map((p) => Math.log(Math.max(p.price, 1e-9)));
      const out = new Array(n).fill(0);
      for (let s = 0; s < anchorOffs.length - 1; s++) {
        const a1 = anchorOffs[s]!;
        const a2 = anchorOffs[s + 1]!;
        const span = a2 - a1;
        for (let d = a1; d <= a2; d++) {
          const t = span > 0 ? (d - a1) / span : 0;
          const chord = (1 - t) * lns[a1]! + t * lns[a2]!;
          out[d] = lns[d]! - chord;
        }
      }
      return out as number[];
    };
    const rA = segResid(seriesA);
    const rB = segResid(seriesB);
    const peak = (xs: number[]) =>
      Math.max(...xs.map((x) => Math.abs(x)), 1e-9);
    const nA = rA.map((x) => x / peak(rA));
    const nB = rB.map((x) => x / peak(rB));
    const rms = (xs: number[]) =>
      Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / Math.max(1, xs.length));
    const rmsDiff = rms(nA.map((x, i) => x - nB[i]!));
    const rmsFlip = rms(nA.map((x, i) => x + nB[i]!));
    const templateScore = Math.min(rmsDiff, rmsFlip);
    assert.ok(
      templateScore > 0.25,
      `seg-resid templateScore=${templateScore.toFixed(3)} (diff=${rmsDiff.toFixed(3)} flip=${rmsFlip.toFixed(3)})`
    );
    const peakDay = (r: number[]) => {
      let best = 2;
      let bestAbs = 0;
      for (let i = 2; i < r.length - 1; i++) {
        if (anchorOffs.includes(i)) continue;
        const a = Math.abs(r[i]!);
        if (a > bestAbs) {
          bestAbs = a;
          best = i;
        }
      }
      return best;
    };
    // 피크일이 같으면 Δ% 시계열 상관이라도 낮아야 함
    const dA: number[] = [];
    const dB: number[] = [];
    for (let i = 1; i < n; i++) {
      dA.push(seriesA[i]!.price / seriesA[i - 1]!.price - 1);
      dB.push(seriesB[i]!.price / seriesB[i - 1]!.price - 1);
    }
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const mA = mean(dA);
    const mB = mean(dB);
    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let i = 0; i < dA.length; i++) {
      const a = dA[i]! - mA;
      const b = dB[i]! - mB;
      num += a * b;
      denA += a * a;
      denB += b * b;
    }
    const corr = num / Math.sqrt(Math.max(1e-18, denA * denB));
    const samePeak = peakDay(rA) === peakDay(rB);
    if (samePeak) {
      assert.ok(
        Math.abs(corr) < 0.82,
        `peak 동일·corr=${corr.toFixed(3)} — 템플릿 복붙 의심`
      );
    }
  });

  it("컨센 목표가가 2배여도 1개월 추정은 매크로 상한(±9%) 안", () => {
    // 회귀 방지 — 예전엔 applyConsensusBlend가 targetMean을 가격에 22% 직접
    // 혼합해 1개월 추정이 +20~29%로 부풀었다 (전 종목 우상향 편향의 주범).
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
        prevClose: 99_000,
      })
    );
    snap.predictions!.ranges = [
      { horizonDays: 1, horizonLabel: "1일", low: 98_000, high: 102_000, center: 100_000, confidence: 0.95 },
      { horizonDays: 22, horizonLabel: "1개월", low: 91_000, high: 109_900, center: 100_000, confidence: 0.95 },
    ];
    snap.consensus = {
      targetMean: 200_000,
      targetMedian: 200_000,
      targetHigh: 220_000,
      targetLow: 180_000,
      upsidePercent: 1.0,
      analystCount: 10,
      recommendationKey: "buy",
      recommendationMean: 2.0,
      strongBuy: 5,
      buy: 5,
      hold: 0,
      sell: 0,
      strongSell: 0,
      source: "merged",
      asOf: Date.now(),
    };
    const horizons = buildMultiHorizonFairValue(snap);
    const month = horizons.find((h) => h.id === "month")!.estimate;
    assert.equal(month.ready, true);
    if (month.ready) {
      assert.ok(
        month.close.price <= 100_000 * 1.095,
        `1개월 추정 ${month.close.price} 이 매크로 상한 초과`
      );
    }
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

  it("SKHY ADR +12% — 1일·내일 center > 현재가, day0→day1 상방 (주 앵커 왜곡 방지)", () => {
    // 구버그: predictorBasePrice 가 1주 center 를 기준으로 써서
    // 1일 center(+1.7%) < 1주(+3.5%) 이면 내일 추정이 하방으로 뒤집힘.
    const PRICE = 2_180_000;
    const day1 = Math.round(PRICE * 1.017);
    const week = Math.round(PRICE * 1.035);
    const month = Math.round(PRICE * 1.008);
    const snap = minimalSnap(
      quote({
        marketState: "CLOSED",
        extendedHours: {
          session: "kr-after",
          price: PRICE,
          changeAbs: 0,
          changeRate: 0,
          active: false,
          regularClose: PRICE,
        },
        price: PRICE,
        prevClose: PRICE,
      })
    );
    snap.meta.code = "000660.KS";
    snap.predictions!.ranges = [
      {
        horizonDays: 1,
        horizonLabel: "1일",
        low: Math.round(day1 * 0.97),
        high: Math.round(day1 * 1.03),
        center: day1,
        confidence: 0.95,
      },
      {
        horizonDays: 5,
        horizonLabel: "1주",
        low: Math.round(week * 0.94),
        high: Math.round(week * 1.06),
        center: week,
        confidence: 0.95,
      },
      {
        horizonDays: 22,
        horizonLabel: "1개월",
        low: Math.round(month * 0.9),
        high: Math.round(month * 1.1),
        center: month,
        confidence: 0.95,
      },
    ];
    snap.predictions!.targets = {
      entry: PRICE,
      stopLoss: PRICE * 0.95,
      takeProfit1: PRICE * 1.05,
      takeProfit2: PRICE * 1.08,
      support: PRICE * 0.94,
      resistance: PRICE * 1.1,
      riskReward: 1.5,
    };
    snap.overseasNight = {
      baseCode: "000660.KS",
      proxyCode: "SKHY",
      name: "SK하이닉스 ADR",
      exchange: "NASDAQ",
      sharesPerReceipt: 0.1,
      proxyKind: "adr",
      price: 168,
      changeRate: 0.12,
      currency: "USD",
      fxToKrw: 1_380,
      impliedKrwPrice: Math.round(168 * 1_380 * 10),
      krxClose: PRICE,
      premiumRate: (168 * 1_380 * 10) / PRICE - 1,
      fetchedAt: Date.now(),
    };

    const horizons = buildMultiHorizonFairValue(snap);
    const tomorrow = horizons.find((h) => h.id === "tomorrow")!.estimate;
    assert.equal(tomorrow.ready, true);
    if (!tomorrow.ready) return;

    assert.ok(
      tomorrow.close.price > PRICE,
      `내일 종가 center ${tomorrow.close.price} ≤ 현재가 ${PRICE}`
    );
    assert.ok(
      tomorrow.open.price > PRICE,
      `내일 시가 ${tomorrow.open.price} ≤ 현재가 ${PRICE}`
    );

    const series = buildFairValueDailySeries({
      code: snap.meta.code,
      horizons,
      ranges: snap.predictions!.ranges,
      basePrice: PRICE,
      now: new Date("2026-07-11T20:00:00+09:00"),
      pathFactors: [
        { id: "overnight", label: "ADR 야간 +2.0% 반영", bps: 200 },
        { id: "listing-adr", label: "상장·ADR 호재", bps: 39 },
      ],
      realizedVol: 0.02,
    });
    const d0 = series.find((p) => p.sessionOffset === 0)!;
    const d1 = series.find((p) => p.sessionOffset === 1)!;
    assert.ok(
      d1.price > d0.price,
      `day0→day1 상방 필요: ${d0.price} → ${d1.price}`
    );
  });

  it("정규장 종가 이후 야간·다음날 장 전에도 오늘(KST) 예측점이 있다", () => {
    const now = new Date("2026-08-20T03:19:00+09:00");
    const snap = minimalSnap(
      quote({
        marketState: "CLOSED",
        price: 100_000,
        prevClose: 99_000,
      })
    );
    snap.predictions!.ranges = [
      {
        horizonDays: 1,
        horizonLabel: "1일",
        low: 98_000,
        high: 102_000,
        center: 100_800,
        confidence: 0.95,
      },
      {
        horizonDays: 5,
        horizonLabel: "1주",
        low: 95_000,
        high: 105_000,
        center: 101_000,
        confidence: 0.95,
      },
      {
        horizonDays: 22,
        horizonLabel: "1개월",
        low: 90_000,
        high: 112_000,
        center: 102_000,
        confidence: 0.95,
      },
    ];
    const horizons = buildMultiHorizonFairValue(snap);
    const todayH = horizons.find((h) => h.id === "today")!.estimate;
    assert.equal(todayH.ready, true, "오늘 시계가 pending 이면 안 됨");

    const series = buildFairValueDailySeries({
      code: snap.meta.code,
      horizons,
      ranges: snap.predictions!.ranges,
      basePrice: snap.quote.price,
      now,
    });
    const d0 = series.find((p) => p.sessionOffset === 0);
    const d1 = series.find((p) => p.sessionOffset === 1);
    assert.ok(d0, "offset 0 오늘 점 없음");
    assert.equal(d0!.isoDate, "2026-08-20");
    assert.equal(d0!.horizonLabel, "오늘");
    assert.equal(d1!.isoDate, "2026-08-21");
    assert.equal(d1!.horizonLabel, "내일");
    assert.ok(d0!.price > 0);
  });
});
