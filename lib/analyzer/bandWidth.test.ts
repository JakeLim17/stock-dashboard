import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyBandWidthCap,
  capHorizonSigma,
  isBandWidthExcessive,
  resolveBandHalfWidthCap,
} from "./bandWidth";

describe("bandWidth", () => {
  it("1개월 절대 반폭 캡 ≈ ±32%", () => {
    assert.equal(resolveBandHalfWidthCap(22), 0.32);
    assert.equal(resolveBandHalfWidthCap(1), 0.1);
  });

  it("horizonSigma 캡 — 폭주 σ√t 차단", () => {
    // 일간 σ 8.8% × √22 × 2.571 ≈ 1.06 → exp 밴드 0.35×~2.8×
    const raw = 1.06;
    const capped = capHorizonSigma(raw, 22);
    assert.ok(capped < raw);
    assert.ok(capped <= Math.log(1.32) + 1e-9);
  });

  it("현재가 대비 0.3×~2.8× 밴드는 과도로 판정·캡 후 해소", () => {
    const price = 2_180_000;
    const center = price * 0.949; // −5.1% center
    const low = 709_036;
    const high = 6_032_281;
    assert.ok(
      isBandWidthExcessive(price, low, high, 22),
      "캡 전 과도 폭"
    );
    const { low: cLow, high: cHigh, capped } = applyBandWidthCap({
      center,
      low,
      high,
      horizonDays: 22,
    });
    assert.ok(capped);
    assert.ok(cLow / center >= 1 - 0.32 - 1e-6);
    assert.ok(cHigh / center <= 1 + 0.32 + 1e-6);
    // 현재가 대비도 대략 ±35% 이내 (center drift 감안)
    assert.ok(cLow / price > 0.55, `low/price=${cLow / price}`);
    assert.ok(cHigh / price < 1.45, `high/price=${cHigh / price}`);
  });

  it("실현 range가 좁으면 캡이 더 조여짐", () => {
    // 거의 횡보 종가
    const closes = Array.from({ length: 60 }, (_, i) => 100 + (i % 3) * 0.2);
    const tight = resolveBandHalfWidthCap(22, closes);
    const loose = resolveBandHalfWidthCap(22);
    assert.ok(tight <= loose);
    assert.ok(tight >= loose * 0.55 - 1e-9);
  });
});
