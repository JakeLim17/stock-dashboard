import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  baseDriftForHorizon,
  computeBaseDriftDaily,
} from "./baseDrift";

describe("baseDrift", () => {
  it("강한 상승 모멘텀이면 양수(수축 적용)", () => {
    const returns = [0.01, 0.012, 0.008, 0.015, 0.01];
    const d = computeBaseDriftDaily(returns);
    assert.ok(d > 0 && d < 0.01);
  });

  it("당일 급락이면 평균회귀로 베이스가 올라간다", () => {
    const flat = [0, 0, 0, 0, 0];
    const withCrash = computeBaseDriftDaily(flat, -0.04);
    assert.ok(withCrash > 0);
  });

  it("월간 베이스는 일간보다 절대값이 크다(√t)", () => {
    const daily = 0.004;
    const month = baseDriftForHorizon(daily, 22);
    assert.ok(Math.abs(month) > Math.abs(daily));
  });
});
