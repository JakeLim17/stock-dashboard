import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isKospi200NightWindow,
  kospi200FrontMonth,
  kospi200FuturesShortCode,
  kospi200NightRateVsRegularClose,
  lastCompletedFuturesSessionYmd,
  secondThursday,
} from "./kospi200Futures";

describe("kospi200Futures", () => {
  it("2026-09 두 번째 목요일은 10일", () => {
    const d = secondThursday(2026, 9);
    assert.equal(d.getUTCDate(), 10);
  });

  it("2026-08-20 02:00 KST → 근월 A01609", () => {
    // 02:00 KST = 전일 17:00 UTC
    const now = new Date(Date.UTC(2026, 7, 19, 17, 0));
    const f = kospi200FrontMonth(now);
    assert.equal(f.code, "A01609");
    assert.equal(kospi200FuturesShortCode(2026, 9), "A01609");
  });

  it("만기일 15:20 이후 다음 분기", () => {
    const before = new Date(Date.UTC(2026, 8, 10, 6, 0)); // 15:00 KST
    const after = new Date(Date.UTC(2026, 8, 10, 6, 30)); // 15:30 KST
    assert.equal(kospi200FrontMonth(before).code, "A01609");
    assert.equal(kospi200FrontMonth(after).code, "A01612");
  });

  it("야간 창 18:00~08:45", () => {
    const night = new Date(Date.UTC(2026, 7, 19, 17, 8)); // 02:08 KST
    const day = new Date(Date.UTC(2026, 7, 20, 1, 0)); // 10:00 KST
    assert.equal(isKospi200NightWindow(night), true);
    assert.equal(isKospi200NightWindow(day), false);
  });

  it("야간 등락은 정규 종가 대비 (전일대비 금지)", () => {
    assert.equal(kospi200NightRateVsRegularClose(1016.25, 1016.25), 0);
    const r = kospi200NightRateVsRegularClose(1025, 1016.25);
    assert.ok(r != null && r > 0 && r < 0.01);
  });

  it("손물 실측과 같이 야간 1036 / 주간 1016 → 약 +2%", () => {
    const r = kospi200NightRateVsRegularClose(1036.35, 1016.25);
    assert.ok(r != null);
    assert.ok(Math.abs(r! - 0.01978) < 0.0002);
  });

  it("02:00 KST 목요일의 정규 세션일은 수요일", () => {
    const now = new Date(Date.UTC(2026, 7, 19, 17, 0)); // 2026-08-20 02:00 KST
    assert.equal(lastCompletedFuturesSessionYmd(now), "20260819");
  });
});
