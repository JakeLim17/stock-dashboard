import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeNetStreak,
  streakBuyDays,
  streakSellDays,
} from "./flowStreak";

describe("flowStreak", () => {
  it("연속 순매수", () => {
    assert.equal(computeNetStreak([1e10, 2e10, 3e10, -1e10]), 3);
    assert.equal(streakBuyDays(3), 3);
    assert.equal(streakSellDays(3), 0);
  });

  it("연속 순매도", () => {
    assert.equal(computeNetStreak([-1e10, -2e10, 1e10]), -2);
    assert.equal(streakSellDays(-2), 2);
  });

  it("당일 0·빈 배열", () => {
    assert.equal(computeNetStreak([0, 1e10]), 0);
    assert.equal(computeNetStreak([]), 0);
  });
});
