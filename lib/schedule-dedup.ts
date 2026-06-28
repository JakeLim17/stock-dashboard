import type { EventItem } from "./types";
import type { ScheduleEntry } from "./monthly-schedule-types";

const MACRO_KINDS = new Set([
  "fomc",
  "bok_rate",
  "us_cpi",
  "us_ppi",
  "us_nfp",
  "kr_trade",
  "kospi_expiry",
  "holiday",
]);

/** 라벨 정규화 — "(예정)", 공백·대소문자 차이 무시 */
export function normalizeScheduleLabel(label: string): string {
  return label
    .replace(/\s*\(예정\)\s*/gi, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function dayBucket(epochMs: number): number {
  return Math.floor(epochMs / 86_400_000);
}

function eventScore(e: EventItem): number {
  let score = 0;
  if (e.detail) score += 10 + Math.min(e.detail.length, 80);
  if (e.importance === "high") score += 5;
  if (e.importance === "medium") score += 2;
  if (!/\(예정\)/i.test(e.label)) score += 3;
  return score;
}

function scheduleScore(e: ScheduleEntry): number {
  let score = 0;
  if (e.detail) score += 10 + Math.min(e.detail.length, 80);
  if (e.importance === "high") score += 5;
  if (e.importance === "medium") score += 2;
  if (e.id.startsWith("curated-")) score += 4;
  return score;
}

/**
 * EventItem 중복 키 — 매크로는 kind+날짜, 종목은 kind+symbol+날짜버킷(±1일 허용은 병합 시 처리)
 */
export function eventDedupeKey(e: EventItem): string {
  const sym = e.symbolCode ?? "";
  if (MACRO_KINDS.has(e.kind) && !sym) {
    return `macro|${e.kind}|${dayBucket(e.date)}`;
  }
  return `sym|${e.kind}|${sym}|${dayBucket(e.date)}`;
}

/** ScheduleEntry 중복 키 */
export function scheduleDedupeKey(e: ScheduleEntry): string {
  const sym = e.symbolCode ?? "";
  if (MACRO_KINDS.has(e.kind) && !sym) {
    return `macro|${e.kind}|${dayBucket(e.startDate)}`;
  }
  return `sym|${e.kind}|${sym}|${dayBucket(e.startDate)}`;
}

function pickBetterEvent(a: EventItem, b: EventItem): EventItem {
  const sa = eventScore(a);
  const sb = eventScore(b);
  if (sa !== sb) return sa > sb ? a : b;
  return a.label.length >= b.label.length ? a : b;
}

function pickBetterSchedule(a: ScheduleEntry, b: ScheduleEntry): ScheduleEntry {
  const sa = scheduleScore(a);
  const sb = scheduleScore(b);
  if (sa !== sb) return sa > sb ? a : b;
  return a.label.length >= b.label.length ? a : b;
}

/** 실적·배당 — 같은 종목·±2일 이내면 하나로 병합 */
function mergeNearDuplicateEvents(items: EventItem[]): EventItem[] {
  const earningsLike = items.filter(
    (e) => e.kind === "earnings" || e.kind === "dividend"
  );
  const rest = items.filter(
    (e) => e.kind !== "earnings" && e.kind !== "dividend"
  );

  const bySymbol = new Map<string, EventItem[]>();
  for (const e of earningsLike) {
    const sym = e.symbolCode ?? "_";
    const list = bySymbol.get(sym) ?? [];
    list.push(e);
    bySymbol.set(sym, list);
  }

  const merged: EventItem[] = [];
  for (const group of bySymbol.values()) {
    group.sort((a, b) => a.date - b.date);
    let current: EventItem | null = null;
    for (const e of group) {
      if (!current) {
        current = e;
        continue;
      }
      const daysApart = Math.abs(dayBucket(e.date) - dayBucket(current.date));
      if (daysApart <= 2) {
        current = pickBetterEvent(current, e);
      } else {
        merged.push(current);
        current = e;
      }
    }
    if (current) merged.push(current);
  }

  return [...rest, ...merged];
}

/** 라벨 유사 + 같은 날짜 — 매크로 커스텀 vs 하드코딩 병합 */
function mergeLabelSimilarEvents(items: EventItem[]): EventItem[] {
  const map = new Map<string, EventItem>();
  for (const e of items) {
    const normLabel = normalizeScheduleLabel(e.label);
    const altKey = `${e.kind}|${dayBucket(e.date)}|${normLabel.slice(0, 12)}`;
    const primaryKey = eventDedupeKey(e);
    const existing =
      map.get(primaryKey) ?? map.get(altKey);
    if (!existing) {
      map.set(primaryKey, e);
      if (MACRO_KINDS.has(e.kind)) map.set(altKey, e);
      continue;
    }
    const picked = pickBetterEvent(existing, e);
    map.set(primaryKey, picked);
    if (MACRO_KINDS.has(e.kind)) map.set(altKey, picked);
  }
  return [...new Set(map.values())];
}

/** EventItem[] 중복 제거 — snapshot·EventCalendar 공용 */
export function dedupeEventItems(items: EventItem[]): EventItem[] {
  const pass1 = mergeLabelSimilarEvents(items);
  const pass2 = mergeNearDuplicateEvents(pass1);
  const map = new Map<string, EventItem>();
  for (const e of pass2) {
    const key = eventDedupeKey(e);
    const hit = map.get(key);
    map.set(key, hit ? pickBetterEvent(hit, e) : e);
  }
  return [...map.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date - b.date;
    const imp = (x: EventItem) =>
      x.importance === "high" ? 0 : x.importance === "medium" ? 1 : 2;
    return imp(a) - imp(b);
  });
}

/** ScheduleEntry[] 중복 제거 — 월별 일정 API 공용 */
export function dedupeScheduleEntries(entries: ScheduleEntry[]): ScheduleEntry[] {
  const map = new Map<string, ScheduleEntry>();
  for (const e of entries) {
    const key = scheduleDedupeKey(e);
    const hit = map.get(key);
    map.set(key, hit ? pickBetterSchedule(hit, e) : e);
  }

  // 실적 — 같은 종목 ±2일 병합
  const list = [...map.values()];
  const earningsLike = list.filter(
    (e) => e.kind === "earnings" || e.kind === "dividend" || e.kind === "ipo"
  );
  const rest = list.filter(
    (e) => e.kind !== "earnings" && e.kind !== "dividend" && e.kind !== "ipo"
  );

  const bySymbol = new Map<string, ScheduleEntry[]>();
  for (const e of earningsLike) {
    const sym = e.symbolCode ?? "_";
    const arr = bySymbol.get(sym) ?? [];
    arr.push(e);
    bySymbol.set(sym, arr);
  }

  const merged: ScheduleEntry[] = [];
  for (const group of bySymbol.values()) {
    group.sort((a, b) => a.startDate - b.startDate);
    let current: ScheduleEntry | null = null;
    for (const e of group) {
      if (!current) {
        current = e;
        continue;
      }
      const daysApart = Math.abs(
        dayBucket(e.startDate) - dayBucket(current.startDate)
      );
      if (daysApart <= 2 && e.kind === current.kind) {
        current = pickBetterSchedule(current, e);
      } else {
        merged.push(current);
        current = e;
      }
    }
    if (current) merged.push(current);
  }

  return [...rest, ...merged].sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate - b.startDate;
    const imp = (x: ScheduleEntry) =>
      x.importance === "high" ? 0 : x.importance === "medium" ? 1 : 2;
    return imp(a) - imp(b);
  });
}
