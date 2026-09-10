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
  computeNightFuturesPassThrough,
  computeGapGuide,
  computeBtcPassThrough,
  NIGHT_FUTURES_BPS_CAP,
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

  it("야간 선물 합성 — NQ/ES 동반 상승은 캡 안 소폭 반영", () => {
    const f = computeNightFuturesPassThrough({
      nq: 0.012,
      es: 0.008,
      ym: 0.006,
      fx: 0,
    });
    assert.ok(f);
    assert.match(f!.label, /^야간 선물 \+/);
    assert.ok(f!.bps > 0 && f!.bps <= NIGHT_FUTURES_BPS_CAP);
  });

  it("야간 선물 소폭은 무시", () => {
    assert.equal(
      computeNightFuturesPassThrough({ nq: 0.001, es: 0.001 }),
      null
    );
  });

  it("코스피200 선물이 있으면 칩 문구·NQ보다 우선", () => {
    const k200 = computeNightFuturesPassThrough({
      k200: 0.02,
      nq: -0.01,
      es: -0.008,
      ym: -0.006,
      fx: 0,
    });
    const usOnly = computeNightFuturesPassThrough({
      nq: -0.04,
      es: -0.03,
      ym: -0.02,
      fx: 0,
    });
    assert.ok(k200 && usOnly);
    assert.match(k200!.label, /^야간 코스피200 선물 \+/);
    assert.ok(k200!.bps > 0, "k200 +2% 가 약한 미국 약세를 이김");
    assert.ok(usOnly!.bps < 0);
    assert.ok(k200!.bps <= NIGHT_FUTURES_BPS_CAP);
  });

  it("야간 코스피200 +2% 는 갭에 가깝게 반영 (캡 안)", () => {
    const f = computeNightFuturesPassThrough({
      k200: 0.0198,
      nq: -0.001,
      es: 0,
      ym: 0,
      fx: -0.017,
    });
    assert.ok(f);
    assert.match(f!.label, /^야간 코스피200 선물 \+/);
    assert.ok(f!.bps > 120 && f!.bps <= NIGHT_FUTURES_BPS_CAP);
  });

  it("갭 가이드 — k200 +2% 면 시초 예상이 비슷한 크기", () => {
    const g = computeGapGuide({ k200: 0.02 });
    assert.ok(g);
    assert.ok(g!.stockGap > 0.015 && g!.stockGap < 0.025);
    assert.match(g!.label, /시초 예상 \+/);
    assert.match(g!.label, /야간선물/);
  });

  it("BTC 강세는 k200 없을 때 합성에 반영", () => {
    const withBtc = computeNightFuturesPassThrough({
      nq: 0.004,
      es: 0.003,
      btc: 0.03,
      fx: 0,
    });
    const noBtc = computeNightFuturesPassThrough({
      nq: 0.004,
      es: 0.003,
      fx: 0,
    });
    assert.ok(withBtc && noBtc);
    assert.ok(withBtc!.bps > noBtc!.bps);
  });

  it("코인 연동 종목 BTC 칩", () => {
    const c = computeBtcPassThrough(0.04);
    assert.ok(c);
    assert.equal(c!.bps, 160); // 4% × 40%
    assert.match(c!.label, /비트코인 \+/);
  });
});
