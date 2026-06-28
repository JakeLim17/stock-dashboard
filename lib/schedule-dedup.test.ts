import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupeEventItems, dedupeScheduleEntries } from "./schedule-dedup";
import type { EventItem } from "./types";
import type { ScheduleEntry } from "./monthly-schedule-types";

const DAY = 86_400_000;

describe("dedupeEventItems", () => {
  it("매크로 kind+날짜 중복 제거", () => {
    const items: EventItem[] = [
      {
        kind: "bok_rate",
        label: "한국은행 금통위 (기준금리)",
        date: 1_000_000,
        importance: "high",
        detail: "한은 통화정책방향",
      },
      {
        kind: "bok_rate",
        label: "한국은행 금통위 (기준금리)",
        date: 1_000_000,
        importance: "high",
      },
    ];
    assert.equal(dedupeEventItems(items).length, 1);
  });

  it("같은 종목 실적 ±2일 병합", () => {
    const items: EventItem[] = [
      {
        kind: "earnings",
        symbolCode: "005930.KS",
        label: "삼성전자 실적 발표 (예정)",
        date: 10 * DAY,
        importance: "high",
      },
      {
        kind: "earnings",
        symbolCode: "005930.KS",
        label: "삼성전자 2분기 잠정 실적",
        date: 10 * DAY + DAY,
        importance: "high",
        detail: "잠정 실적 공시",
      },
    ];
    const out = dedupeEventItems(items);
    assert.equal(out.length, 1);
    assert.ok(out[0].detail?.includes("잠정"));
  });
});

describe("dedupeScheduleEntries", () => {
  it("같은 날 FOMC 중복 제거", () => {
    const entries: ScheduleEntry[] = [
      {
        id: "a",
        startDate: 5 * DAY,
        label: "FOMC 정책 발표",
        kind: "fomc",
        importance: "high",
        detail: "미 연준",
      },
      {
        id: "b",
        startDate: 5 * DAY,
        label: "FOMC 정책 발표",
        kind: "fomc",
        importance: "high",
      },
    ];
    assert.equal(dedupeScheduleEntries(entries).length, 1);
  });
});
