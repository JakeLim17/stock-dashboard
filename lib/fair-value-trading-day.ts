function isKrStockCode(code: string): boolean {
  return /^\d{6}\.K[SQ]$/.test(code);
}

function timezoneFor(code: string): string {
  return isKrStockCode(code) ? "Asia/Seoul" : "America/New_York";
}

/** TZ 기준 요일 (0=일 … 6=토) */
function weekdayInTz(date: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? 0;
}

function addCalendarDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isWeekendInTz(date: Date, tz: string): boolean {
  const wd = weekdayInTz(date, tz);
  return wd === 0 || wd === 6;
}

/** 다음 거래일 (주말 스킵 — 공휴일은 후속 보강) */
export function getNextTradingSessionDate(
  code: string,
  now = new Date()
): Date {
  const tz = timezoneFor(code);
  let cursor = addCalendarDays(now, 1);
  let guard = 0;
  while (isWeekendInTz(cursor, tz) && guard < 14) {
    cursor = addCalendarDays(cursor, 1);
    guard++;
  }
  return cursor;
}

/** now → 다음 거래일까지 달력 일수 (금→월 ≈ 3). 매크로 보정 스케일용. */
export function calendarDaysToNextSession(
  code: string,
  now = new Date()
): number {
  const target = getNextTradingSessionDate(code, now);
  const diffMs = target.getTime() - now.getTime();
  return Math.max(1, diffMs / 86_400_000);
}

/** 다음 거래일 요일 라벨 (월·화·…) — 백테스트·검증용 */
export function weekdayLabelInTz(date: Date, tz: string): string {
  return (
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: tz,
      weekday: "short",
    }).format(date) || "?"
  );
}

/** 카드 표시용 — "6/23(월) 예상" */
export function formatNextTradingSessionLabel(
  code: string,
  now = new Date()
): { target: Date; shortLabel: string; isoDate: string } {
  const tz = timezoneFor(code);
  const target = getNextTradingSessionDate(code, now);
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: tz,
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(target);

  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";

  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);

  return {
    target,
    shortLabel: `${month}/${day}(${wd})`,
    isoDate: iso,
  };
}
