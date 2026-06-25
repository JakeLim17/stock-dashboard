import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOneDayHorizonContext } from "./tradingSession";
import type { SymbolMeta } from "../types";

const krSemi: SymbolMeta = {
  code: "000660.KS",
  name: "SK하이닉스",
  kind: "kr-stock",
  sector: "반도체",
};

function kstDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): Date {
  // KST → UTC
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
}

describe("getOneDayHorizonContext — KST 당일 라벨", () => {
  it("정규장 12:30 — 오늘 종가 (명일 아님)", () => {
    const ctx = getOneDayHorizonContext(
      krSemi,
      kstDate(2026, 6, 26, 12, 30)
    );
    assert.match(ctx.displayLabel, /^오늘\(/);
    assert.equal(ctx.isSameTradingDay, true);
    assert.ok(ctx.effectiveDays < 1);
    assert.ok(ctx.effectiveDays > 0.1);
  });

  it("정규장 09:10 — 오늘 종가, σ 스케일 ≈1", () => {
    const ctx = getOneDayHorizonContext(
      krSemi,
      kstDate(2026, 6, 26, 9, 10)
    );
    assert.match(ctx.displayLabel, /^오늘\(/);
    assert.ok(ctx.effectiveDays > 0.9);
  });

  it("시간외 16:00 — 당일 종가 (전일 아님)", () => {
    const ctx = getOneDayHorizonContext(
      krSemi,
      kstDate(2026, 6, 26, 16, 0)
    );
    assert.match(ctx.displayLabel, /^당일\(/);
    assert.equal(ctx.isSameTradingDay, true);
  });

  it("야간 22:00 — 다음 거래일", () => {
    const ctx = getOneDayHorizonContext(
      krSemi,
      kstDate(2026, 6, 26, 22, 0)
    );
    assert.match(ctx.displayLabel, /^다음 거래일\(/);
    assert.equal(ctx.isSameTradingDay, false);
  });
});

describe("getOneDayHorizonContext — intraday σ 스케일", () => {
  it("장 마감 직전 effectiveDays 최소 0.12", () => {
    const ctx = getOneDayHorizonContext(
      krSemi,
      kstDate(2026, 6, 26, 15, 25)
    );
    assert.ok(ctx.effectiveDays >= 0.12);
    assert.ok(ctx.effectiveDays <= 0.2);
  });
});
