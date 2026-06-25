import type { SymbolMeta } from "../types";

/** KST(UTC+9) 시·분 — 서버 timezone 무관. */
export function kstParts(now = new Date()): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  minutesOfDay: number;
} {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours();
  const minute = kst.getUTCMinutes();
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
    weekday: kst.getUTCDay(),
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

export function formatKstShortDate(now = new Date()): string {
  const p = kstParts(now);
  return `${p.month}/${p.day}`;
}

export type TradingSessionPhase =
  | "kr-regular"
  | "kr-extended"
  | "kr-overnight"
  | "us-regular"
  | "us-overnight";

export interface OneDayHorizonContext {
  /** UI·ranges[].horizonLabel — "오늘(6/26) 종가" 등 */
  displayLabel: string;
  /** σ·√days 에 쓸 유효 horizon (거래일 잔여 비율 반영) */
  effectiveDays: number;
  /** 당일 거래 세션인지 (extended 포함) */
  isSameTradingDay: boolean;
  phase: TradingSessionPhase;
}

const KR_REGULAR_START = 9 * 60; // 09:00
const KR_REGULAR_END = 15 * 60 + 30; // 15:30
const KR_EXTENDED_START = 8 * 60; // 08:00
const KR_EXTENDED_END = 20 * 60; // 20:00
const KR_REGULAR_MINUTES = KR_REGULAR_END - KR_REGULAR_START; // 390
const US_REGULAR_START = 22 * 60 + 30; // KST 22:30
const US_REGULAR_END = 5 * 60; // KST 05:00 (다음날)

function isKrWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

function isUsStock(meta?: SymbolMeta | null): boolean {
  return meta?.kind === "us-stock";
}

function krPhase(minutesOfDay: number, weekday: number): TradingSessionPhase {
  if (!isKrWeekday(weekday)) return "kr-overnight";
  if (minutesOfDay >= KR_REGULAR_START && minutesOfDay < KR_REGULAR_END) {
    return "kr-regular";
  }
  if (minutesOfDay >= KR_EXTENDED_START && minutesOfDay < KR_EXTENDED_END) {
    return "kr-extended";
  }
  return "kr-overnight";
}

function usPhase(minutesOfDay: number, weekday: number): TradingSessionPhase {
  // 미국 정규장 KST 22:30~익일 05:00 — 자정 넘김 구간
  const inUsRegular =
    minutesOfDay >= US_REGULAR_START ||
    minutesOfDay < US_REGULAR_END ||
    (weekday === 6 && minutesOfDay < US_REGULAR_END) ||
    (weekday === 0 && minutesOfDay >= US_REGULAR_START);
  return inUsRegular ? "us-regular" : "us-overnight";
}

/** 1일 horizon — KST 거래 세션 기준 라벨·σ 스케일. "1일 후(명일)" 혼동 방지. */
export function getOneDayHorizonContext(
  meta?: SymbolMeta | null,
  now = new Date()
): OneDayHorizonContext {
  const p = kstParts(now);
  const dateLabel = formatKstShortDate(now);

  if (isUsStock(meta)) {
    const phase = usPhase(p.minutesOfDay, p.weekday);
    if (phase === "us-regular") {
      const remaining =
        p.minutesOfDay >= US_REGULAR_START
          ? (24 * 60 - p.minutesOfDay + US_REGULAR_END) / (6.5 * 60)
          : (US_REGULAR_END - p.minutesOfDay) / (6.5 * 60);
      return {
        displayLabel: `오늘(${dateLabel}) 종가`,
        effectiveDays: Math.max(0.12, Math.min(1, remaining)),
        isSameTradingDay: true,
        phase,
      };
    }
    return {
      displayLabel: `다음 미국장(${dateLabel})`,
      effectiveDays: 1,
      isSameTradingDay: false,
      phase,
    };
  }

  const phase = krPhase(p.minutesOfDay, p.weekday);

  if (phase === "kr-regular") {
    const remainingMin = KR_REGULAR_END - p.minutesOfDay;
    const frac = remainingMin / KR_REGULAR_MINUTES;
    return {
      displayLabel: `오늘(${dateLabel}) 종가`,
      effectiveDays: Math.max(0.12, Math.min(1, frac)),
      isSameTradingDay: true,
      phase,
    };
  }

  if (phase === "kr-extended") {
    // 장전·장후 시간외 — 여전히 당일 세션 (전일 아님)
    const remainingMin =
      p.minutesOfDay < KR_REGULAR_START
        ? KR_REGULAR_END - KR_REGULAR_START
        : KR_EXTENDED_END - p.minutesOfDay;
    const frac = Math.max(0.2, remainingMin / KR_REGULAR_MINUTES);
    return {
      displayLabel: `당일(${dateLabel}) 종가`,
      effectiveDays: Math.min(1, frac),
      isSameTradingDay: true,
      phase,
    };
  }

  // 야간·새벽·주말 — 다음 한국 거래일
  return {
    displayLabel: `다음 거래일(${dateLabel})`,
    effectiveDays: 1,
    isSameTradingDay: false,
    phase,
  };
}

/** UI용 — horizonDays=1 범위의 표시 라벨 (뒤에 " 후" 붙이지 않음). */
export function formatRangeHorizonLabel(
  horizonDays: number,
  meta?: SymbolMeta | null,
  now = new Date()
): string {
  if (horizonDays === 1) {
    return getOneDayHorizonContext(meta, now).displayLabel;
  }
  if (horizonDays === 3) return "3거래일";
  if (horizonDays === 5) return "1주(5거래일)";
  if (horizonDays === 10) return "2주(10거래일)";
  return `${horizonDays}일`;
}
