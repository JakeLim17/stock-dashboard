/**
 * 000660 / SKHY 밴드·ADR 칩 수치 스냅샷 (커밋 금지용 로컬 검증).
 * 실행: npx tsx scripts/verify-000660-bands.ts
 */
import {
  computeOvernightPassThrough,
  resolveOvernightProxyRate,
} from "../lib/analyzer/overnightPassThrough";
import {
  applyBandWidthCap,
  capHorizonSigma,
  isBandWidthExcessive,
} from "../lib/analyzer/bandWidth";
import {
  chronoPulseDriftForHorizon,
  computeChronoPulse,
} from "../lib/analyzer/chronoPulse";

const PRICE = 2_180_000;

// SKHY 상장일 실측 (Yahoo chart 2026-07-10)
const sessionRate = 168.01 / 170 - 1; // ≈ −1.17%
const resolved = resolveOvernightProxyRate({
  sessionRate,
  listingReferencePrice: 149,
  lastPrice: 168.01,
  sessionOpen: 170,
  recentCloses: [168.01],
});
const overnight = computeOvernightPassThrough(resolved, "adr");

console.log("=== ADR 야간 ===");
console.log("sessionRate%", (sessionRate * 100).toFixed(2));
console.log("resolvedRate%", (resolved * 100).toFixed(2));
console.log("chip", overnight?.label, "bps", overnight?.bps);

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
const d22 = chronoPulseDriftForHorizon(pulse.driftDaily, 22, {
  structuralDaily: pulse.structuralDaily,
  lag0Daily: pulse.lag0Daily,
});
// predictor soft floor 모사
const d22Floor = Math.max(d22, -0.02);
const center1 = PRICE * Math.exp(d1);
const center22 = PRICE * Math.exp(d22Floor);

console.log("\n=== center ===");
console.log(
  "1일",
  Math.round(center1),
  ((center1 / PRICE - 1) * 100).toFixed(1) + "%"
);
console.log(
  "1개월(floor)",
  Math.round(center22),
  ((center22 / PRICE - 1) * 100).toFixed(1) + "%"
);
console.log(
  "chips",
  pulse.factors
    .slice(0, 6)
    .map((f) => `${f.label} ${f.bps}`)
    .join(" | ")
);

// 밴드 폭주 재현 → 캡
const rawSigma = 1.06;
const cappedSigma = capHorizonSigma(rawSigma, 22);
const lowRaw = center22 * Math.exp(-rawSigma);
const highRaw = center22 * Math.exp(rawSigma);
const { low, high } = applyBandWidthCap({
  center: center22,
  low: center22 * Math.exp(-cappedSigma),
  high: center22 * Math.exp(cappedSigma),
  horizonDays: 22,
});

console.log("\n=== 1개월 밴드 ===");
console.log("raw", Math.round(lowRaw), "~", Math.round(highRaw));
console.log("capped", Math.round(low), "~", Math.round(high));
console.log(
  "excessive before?",
  isBandWidthExcessive(PRICE, lowRaw, highRaw, 22)
);
console.log(
  "excessive after?",
  isBandWidthExcessive(PRICE, low, high, 22)
);
