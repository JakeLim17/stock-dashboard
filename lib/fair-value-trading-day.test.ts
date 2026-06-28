import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatNextTradingSessionLabel,
  getNextTradingSessionDate,
  calendarDaysToNextSession,
} from "./fair-value-trading-day";

describe("getNextTradingSessionDate", () => {
  it("금요일 다음은 월요일 (한국 종목)", () => {
    // 2026-06-19 금요일 KST
    const fri = new Date("2026-06-19T10:00:00+09:00");
    const next = getNextTradingSessionDate("005930.KS", fri);
    const label = formatNextTradingSessionLabel("005930.KS", fri);
    assert.equal(label.shortLabel, "6/22(월)");
    assert.equal(label.isoDate, "2026-06-22");
    assert.equal(next.getTime(), label.target.getTime());
  });

  it("토요일 다음은 월요일", () => {
    const sat = new Date("2026-06-20T12:00:00+09:00");
    const label = formatNextTradingSessionLabel("005930.KS", sat);
    assert.equal(label.shortLabel, "6/22(월)");
  });

  it("평일 다음은 익일", () => {
    const wed = new Date("2026-06-18T15:00:00+09:00");
    const label = formatNextTradingSessionLabel("005930.KS", wed);
    assert.equal(label.shortLabel, "6/19(금)");
  });

  it("금→월 달력 갭은 3일 근처", () => {
    const fri = new Date("2026-06-19T18:00:00+09:00");
    const days = calendarDaysToNextSession("005930.KS", fri);
    assert.ok(days >= 2.5 && days <= 3.5);
  });
});
