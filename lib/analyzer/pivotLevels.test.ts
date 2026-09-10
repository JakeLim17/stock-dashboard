import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classicPivotLevels,
  nearestPivotBand,
  resolveSupportResistance,
} from "./pivotLevels";

describe("pivotLevels", () => {
  it("전일 H/L/C 피봇 — R1/S1 공식", () => {
    const p = classicPivotLevels(110, 100, 106);
    assert.ok(p);
    assert.equal(p!.pivot, 105.33333333333333);
    assert.ok(Math.abs(p!.r1 - (2 * p!.pivot - 100)) < 1e-9);
    assert.ok(Math.abs(p!.s1 - (2 * p!.pivot - 110)) < 1e-9);
    assert.ok(p!.r1 > p!.pivot && p!.pivot > p!.s1);
  });

  it("현재가 아래가 지지, 위가 저항", () => {
    const levels = classicPivotLevels(110, 100, 106)!;
    const band = nearestPivotBand(106, levels);
    assert.ok(band.support < 106);
    assert.ok(band.resistance > 106);
  });

  it("피봇이 있으면 20일 고저보다 우선", () => {
    const r = resolveSupportResistance({
      price: 106,
      lastHigh: 110,
      lastLow: 100,
      lastClose: 106,
      range20Low: 80,
      range20High: 140,
    });
    assert.ok(r);
    assert.equal(r!.source, "pivot");
    assert.ok(r!.support > 80, "20일 저점보다 가까워야 함");
    assert.ok(r!.resistance < 140, "20일 고점보다 가까워야 함");
  });

  it("피봇 없으면 20일 폴백", () => {
    const r = resolveSupportResistance({
      price: 100,
      range20Low: 90,
      range20High: 120,
    });
    assert.ok(r);
    assert.equal(r!.source, "20d");
    assert.equal(r!.support, 90);
    assert.equal(r!.resistance, 120);
  });
});
