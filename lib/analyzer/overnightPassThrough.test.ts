import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OVERNIGHT_BPS_CAP,
  OVERNIGHT_OPEN_BAND_ABS_CAP,
  OVERNIGHT_TRANSFER_RATIO,
  computeOvernightPassThrough,
  estimateOvernightOpenBand,
  formatSharesPerReceiptLabel,
  inferOvernightKind,
  resolveOvernightProxyRate,
} from "./overnightPassThrough";

describe("overnightPassThrough", () => {
  it("SKHY +15% → 원주 할인 전달 + 캡 (1:1 금지)", () => {
    const r = computeOvernightPassThrough(0.15, "adr");
    assert.ok(r);
    assert.equal(r!.transferRatio, OVERNIGHT_TRANSFER_RATIO);
    assert.ok(OVERNIGHT_TRANSFER_RATIO >= 0.3 && OVERNIGHT_TRANSFER_RATIO <= 0.5);
    // 15% × 40% = 600bps → 캡 200bps
    assert.equal(r!.rawBps, 600);
    assert.equal(r!.bps, OVERNIGHT_BPS_CAP);
    assert.equal(r!.label, "ADR 야간 +2.0% 반영");
    assert.ok(Math.abs(r!.bps) < Math.round(0.15 * 10_000), "1:1 전달 금지");
  });

  it("소폭 등락은 할인만 적용 (캡 미달)", () => {
    const r = computeOvernightPassThrough(0.05, "adr");
    assert.ok(r);
    // 5% × 40% = 200bps
    assert.equal(r!.bps, 200);
    assert.equal(r!.label, "ADR 야간 +2.0% 반영");
  });

  it("GDR 약세도 동일 공식", () => {
    const r = computeOvernightPassThrough(-0.04, "gdr");
    assert.ok(r);
    assert.equal(r!.bps, -160); // 4% × 40%
    assert.equal(r!.label, "GDR 야간 -1.6% 반영");
  });

  it("노이즈(0.3% 미만)는 null", () => {
    assert.equal(computeOvernightPassThrough(0.002, "adr"), null);
  });

  it("inferOvernightKind — SKHY/ADR", () => {
    assert.equal(
      inferOvernightKind({ proxyCode: "SKHY", name: "SK하이닉스 ADR" }),
      "adr"
    );
    assert.equal(
      inferOvernightKind({ proxyCode: "HY9H.F", name: "SK하이닉스 GDR" }),
      "gdr"
    );
  });

  it("SKHY 상장일: 시가→종가 −1.2%여도 공모가 대비 +12%면 양수", () => {
    // 실측: open 170 close 168 → session −1.17%, IPO $149 → +12.8%
    const rate = resolveOvernightProxyRate({
      sessionRate: 168 / 170 - 1,
      listingReferencePrice: 149,
      lastPrice: 168,
      sessionOpen: 170,
      recentCloses: [168],
    });
    assert.ok(rate >= 0.1, `expected surge ≥10%, got ${rate}`);
    const chip = computeOvernightPassThrough(rate, "adr");
    assert.ok(chip);
    assert.ok(chip!.bps > 0, `ADR 야간 칩 양수, bps=${chip!.bps}`);
    assert.equal(chip!.bps, OVERNIGHT_BPS_CAP);
  });

  it("급등 없는 일반 세션은 sessionRate 그대로", () => {
    const rate = resolveOvernightProxyRate({
      sessionRate: -0.0125,
      recentCloses: [100, 99, 98.8],
    });
    assert.ok(Math.abs(rate - -0.0125) < 1e-9);
  });

  it("프리마켓 활성이면 extended 우선", () => {
    const rate = resolveOvernightProxyRate({
      sessionRate: -0.01,
      extendedRate: 0.03,
      extendedActive: true,
    });
    assert.equal(rate, 0.03);
  });

  it("시초 예상 밴드 — 전달률×할인·절대 캡·확정 아님 라벨", () => {
    const band = estimateOvernightOpenBand(0.14, "adr", {
      sessionLabel: "월요 시초",
    });
    assert.ok(band);
    // 14% × 0.4 = 5.6% → low 3.08% · high 5.04%
    assert.ok(band!.lowPct > 0.025 && band!.lowPct < 0.04);
    assert.ok(band!.highPct > 0.045 && band!.highPct < 0.06);
    assert.ok(band!.highPct <= OVERNIGHT_OPEN_BAND_ABS_CAP);
    assert.match(band!.label, /월요 시초 예상 \+/);
    assert.match(band!.label, /ADR 반영, 확정 아님/);
  });

  it("시초 밴드 절대 캡 ±10%", () => {
    const band = estimateOvernightOpenBand(0.5, "adr"); // 50%×40%=20% → 캡
    assert.ok(band);
    assert.ok(band!.highPct <= OVERNIGHT_OPEN_BAND_ABS_CAP + 1e-9);
    assert.ok(band!.lowPct <= OVERNIGHT_OPEN_BAND_ABS_CAP + 1e-9);
  });

  it("formatSharesPerReceiptLabel — ADR 0.1", () => {
    assert.equal(
      formatSharesPerReceiptLabel(0.1, "adr"),
      "ADR 10주=원주 1주"
    );
    assert.equal(formatSharesPerReceiptLabel(25, "gdr"), "25주 환산");
  });
});
