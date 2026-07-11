/**
 * 000660 월요일(1일/내일) 예측 % 실측.
 * 실행: npx tsx scripts/measure-000660-monday.ts
 * 커밋·푸시 금지용 로컬 검증.
 */
import {
  computeOvernightPassThrough,
  estimateOvernightOpenBand,
  resolveOvernightProxyRate,
  OVERNIGHT_TRANSFER_RATIO,
  OVERNIGHT_OPEN_BAND_ABS_CAP,
  OVERNIGHT_OPEN_BAND_LOW_RATIO,
  OVERNIGHT_OPEN_BAND_HIGH_RATIO,
  OVERNIGHT_BPS_CAP,
} from "../lib/analyzer/overnightPassThrough";
import {
  chronoPulseDriftForHorizon,
  computeChronoPulse,
} from "../lib/analyzer/chronoPulse";
import {
  buildFairValueDailySeries,
  buildMultiHorizonFairValue,
} from "../lib/fair-value";
import type { Quote, StockSnapshot } from "../lib/types";

const PRICE = 2_180_000;

// SKHY 상장일 실측 패턴 (시가→종가 소폭 되돌림 + 공모 대비 급등)
const sessionRate = 168.01 / 170 - 1;
const resolved = resolveOvernightProxyRate({
  sessionRate,
  listingReferencePrice: 149,
  lastPrice: 168.01,
  sessionOpen: 170,
  recentCloses: [168.01],
});
const overnight = computeOvernightPassThrough(resolved, "adr");
const openBand = estimateOvernightOpenBand(resolved, "adr", {
  sessionLabel: "월요 시초",
});

console.log("=== 공식 ===");
console.log(
  `전달: ADR% × ${OVERNIGHT_TRANSFER_RATIO} → 칩 캡 ±${OVERNIGHT_BPS_CAP}bps`
);
console.log(
  `시초 밴드: 전달% × [${OVERNIGHT_OPEN_BAND_LOW_RATIO}, ${OVERNIGHT_OPEN_BAND_HIGH_RATIO}] · 절대 캡 ±${OVERNIGHT_OPEN_BAND_ABS_CAP * 100}%`
);
console.log("resolved ADR%", (resolved * 100).toFixed(2));
console.log("chip", overnight?.label, "bps", overnight?.bps);
console.log("openBand", openBand?.label);

const pulse = computeChronoPulse({
  meta: {
    code: "000660.KS",
    name: "SK하이닉스",
    kind: "kr-stock",
    sector: "반도체",
  },
  quote: {
    code: "000660.KS",
    name: "SK하이닉스",
    price: PRICE,
    prevClose: PRICE,
    changeAbs: 0,
    changeRate: 0.01,
    volume: 1,
    currency: "KRW",
    marketCap: null,
    valuation: { per: 90, forwardPer: 40, pbr: 3 },
    fetchedAt: Date.now(),
  },
  flow: {
    foreignNet: -300e8,
    institutionNet: -50e8,
    foreignNet5d: -600e8,
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
      date: Date.UTC(2026, 6, 10),
      importance: "high",
      detail: "ADR",
    },
  ],
  overseasNightRate: resolved,
  overseasNightKind: "adr",
});

const d1 = chronoPulseDriftForHorizon(pulse.driftDaily, 1, {
  structuralDaily: pulse.structuralDaily,
  lag0Daily: pulse.lag0Daily,
});
const d22 = Math.max(
  chronoPulseDriftForHorizon(pulse.driftDaily, 22, {
    structuralDaily: pulse.structuralDaily,
    lag0Daily: pulse.lag0Daily,
  }),
  -0.02
);

// predictor soft floor 모사 (overnight ≥100bps → 1일 minTotal)
const overnightBps = overnight?.bps ?? 0;
let predD1 = d1;
if (overnightBps >= 100) {
  const minTotal = Math.min(0.018, (overnightBps / 10_000) * 0.75);
  if (predD1 < minTotal) predD1 = minTotal;
}
const center1 = PRICE * Math.exp(predD1);
const center22 = PRICE * Math.exp(d22);

console.log("\n=== ChronoPulse / predictor 1일·1개월 ===");
console.log(
  "1일(월요)",
  Math.round(center1),
  ((center1 / PRICE - 1) * 100).toFixed(2) + "%"
);
console.log(
  "1개월",
  Math.round(center22),
  ((center22 / PRICE - 1) * 100).toFixed(2) + "%"
);

const day1Center = Math.round(center1);
const weekCenter = Math.round(PRICE * Math.exp(d22 * 0.55)); // 완만한 중기
const monthCenter = Math.round(center22);

const q: Quote = {
  code: "000660.KS",
  name: "SK하이닉스",
  price: PRICE,
  prevClose: PRICE,
  changeAbs: 0,
  changeRate: 0,
  volume: null,
  fetchedAt: Date.now(),
  marketState: "CLOSED",
  extendedHours: {
    session: "kr-after",
    price: PRICE,
    changeAbs: 0,
    changeRate: 0,
    active: false,
    regularClose: PRICE,
  },
};

const snap: StockSnapshot = {
  meta: { code: "000660.KS", name: "SK하이닉스", kind: "kr-stock" },
  quote: q,
  tech: {},
  flow: { foreignNet: null, institutionNet: null, individualNet: null },
  analysis: {
    signal: "HOLD",
    headline: "",
    reasons: [],
    buyScore: 40,
    heatScore: 81,
    shortTerm: { signal: "HOLD", headline: "", reasons: [], score: 40 },
    longTerm: { signal: "HOLD", headline: "", reasons: [], score: 50 },
    verdict: {
      action: "HOLD_WAIT",
      label: "HOLD",
      tone: "hold",
      headline: "",
      detail: "",
    },
    externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
    volatility: { score: 40, level: "moderate", drivers: [] },
  },
  predictions: {
    ranges: [
      {
        horizonDays: 1,
        horizonLabel: "1일",
        low: Math.round(day1Center * 0.97),
        high: Math.round(day1Center * 1.03),
        center: day1Center,
        confidence: 0.95,
      },
      {
        horizonDays: 5,
        horizonLabel: "1주",
        low: Math.round(weekCenter * 0.94),
        high: Math.round(weekCenter * 1.06),
        center: weekCenter,
        confidence: 0.95,
      },
      {
        horizonDays: 22,
        horizonLabel: "1개월",
        low: Math.round(monthCenter * 0.9),
        high: Math.round(monthCenter * 1.1),
        center: monthCenter,
        confidence: 0.95,
      },
    ],
    targets: {
      entry: PRICE,
      stopLoss: PRICE * 0.95,
      takeProfit1: PRICE * 1.05,
      takeProfit2: PRICE * 1.08,
      support: PRICE * 0.94,
      resistance: PRICE * 1.1,
      riskReward: 1.5,
    },
    scenarios: [],
    strength: { buy: 40, sell: 30 },
    chronoPulse: pulse,
  },
  overseasNight: {
    baseCode: "000660.KS",
    proxyCode: "SKHY",
    name: "SK하이닉스 ADR",
    exchange: "NASDAQ",
    sharesPerReceipt: 0.1,
    proxyKind: "adr",
    price: 168.01,
    changeRate: resolved,
    currency: "USD",
    fxToKrw: 1_380,
    impliedKrwPrice: Math.round(168.01 * 1_380 * 10),
    krxClose: PRICE,
    fetchedAt: Date.now(),
  },
};

const horizons = buildMultiHorizonFairValue(snap);
const tomorrow = horizons.find((h) => h.id === "tomorrow")!.estimate;
const series = buildFairValueDailySeries({
  code: snap.meta.code,
  horizons,
  ranges: snap.predictions!.ranges,
  basePrice: PRICE,
  now: new Date("2026-07-11T20:00:00+09:00"),
  pathFactors: pulse.factors.slice(0, 6),
  realizedVol: 0.02,
});

console.log("\n=== Fair-value 내일 / 일별 ===");
if (tomorrow.ready) {
  console.log(
    "내일 시가",
    tomorrow.open.price,
    ((tomorrow.open.price / PRICE - 1) * 100).toFixed(2) + "%"
  );
  console.log(
    "내일 종가",
    tomorrow.close.price,
    ((tomorrow.close.price / PRICE - 1) * 100).toFixed(2) + "%"
  );
}
const d0 = series.find((p) => p.sessionOffset === 0);
const d1pt = series.find((p) => p.sessionOffset === 1);
if (d0 && d1pt) {
  console.log(
    "day0→day1",
    d0.price,
    "→",
    d1pt.price,
    ((d1pt.price / d0.price - 1) * 100).toFixed(2) + "%"
  );
}
