/**
 * KRX 코스피200 선물 근월물 코드·야간 창 (Eurex 종료 후 KRX 18:00~06:00).
 * Yahoo 심볼 없음 — 시세는 KIS inquire-price (A01609 형식).
 */

/** 시장 패널용 합성 코드 — Yahoo 티커 아님 */
export const K200_NIGHT_CODE = "K200.NIGHT";

import { kstParts } from "./tradingSession";

const PRODUCT = "A01"; // 2026년 이후 선물 종류코드 A + 코스피200(01)

/** 분기월 3·6·9·12, 만기 = 해당 월 두 번째 목요일 */
export function secondThursday(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dow = first.getUTCDay(); // 0 Sun
  const firstThu = 1 + ((4 - dow + 7) % 7);
  return new Date(Date.UTC(year, month - 1, firstThu + 7));
}

export function nextQuarterMonth(month: number): { yearDelta: number; month: number } {
  if (month <= 3) return { yearDelta: 0, month: 3 };
  if (month <= 6) return { yearDelta: 0, month: 6 };
  if (month <= 9) return { yearDelta: 0, month: 9 };
  if (month <= 12) return { yearDelta: 0, month: 12 };
  return { yearDelta: 1, month: 3 };
}

export function kospi200FuturesShortCode(year: number, month: number): string {
  const y = year % 10;
  const mm = String(month).padStart(2, "0");
  return `${PRODUCT}${y}${mm}`;
}

export interface Kospi200FrontMonth {
  year: number;
  month: number;
  code: string;
  expiryYmd: string;
}

/**
 * 근월물. 만기일 15:20 KST 이후(정규 최종 후)에는 다음 분기로 롤.
 */
export function kospi200FrontMonth(now = new Date()): Kospi200FrontMonth {
  const p = kstParts(now);
  let year = p.year;
  let q = nextQuarterMonth(p.month);
  year += q.yearDelta;
  let month = q.month;
  const expiry = secondThursday(year, month);
  const expiryYmd = `${expiry.getUTCFullYear()}${String(expiry.getUTCMonth() + 1).padStart(2, "0")}${String(expiry.getUTCDate()).padStart(2, "0")}`;
  const kstMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const rollAfter = Date.UTC(
    expiry.getUTCFullYear(),
    expiry.getUTCMonth(),
    expiry.getUTCDate(),
    15,
    20
  );
  if (kstMs >= rollAfter) {
    if (month === 12) {
      year += 1;
      month = 3;
    } else {
      month += 3;
    }
  }
  const exp2 = secondThursday(year, month);
  return {
    year,
    month,
    code: kospi200FuturesShortCode(year, month),
    expiryYmd: `${exp2.getUTCFullYear()}${String(exp2.getUTCMonth() + 1).padStart(2, "0")}${String(exp2.getUTCDate()).padStart(2, "0")}`,
  };
}

/** 야간 세션 + 시초 전: 18:00~익일 08:45 (정규 선물 08:45 개장) */
export function isKospi200NightWindow(now = new Date()): boolean {
  const { minutesOfDay } = kstParts(now);
  return minutesOfDay >= 18 * 60 || minutesOfDay < 8 * 60 + 45;
}

/** 야간 갭을 예측에 넣는 창 — 18:00~익일 09:00 (정규 개장 직전까지) */
export function isKospi200PredictionWindow(now = new Date()): boolean {
  const { minutesOfDay } = kstParts(now);
  return minutesOfDay >= 18 * 60 || minutesOfDay < 9 * 60;
}

/** 시초 갭 가이드 활성 — 정규 15:30 마감 후 ~ 다음날 09:00 */
export function isGapGuideActive(now = new Date()): boolean {
  const { minutesOfDay } = kstParts(now);
  return minutesOfDay >= 15 * 60 + 30 || minutesOfDay < 9 * 60;
}

/** 마지막으로 끝난 정규 세션 일자 (YYYYMMDD, KST). 15:45 이전은 직전 평일. */
export function lastCompletedFuturesSessionYmd(now = new Date()): string {
  const p = kstParts(now);
  let t = Date.UTC(p.year, p.month - 1, p.day);
  const afterClose = p.minutesOfDay >= 15 * 60 + 45;
  if (!(afterClose && p.weekday >= 1 && p.weekday <= 5)) {
    t -= 86_400_000;
  }
  for (let i = 0; i < 10; i++) {
    const dt = new Date(t);
    const wd = dt.getUTCDay();
    if (wd >= 1 && wd <= 5) {
      const y = dt.getUTCFullYear();
      const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const da = String(dt.getUTCDate()).padStart(2, "0");
      return `${y}${mo}${da}`;
    }
    t -= 86_400_000;
  }
  return `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
}

/** 정규 종가(15:45) 대비 현재가 — 전일대비(당일 급락 포함)가 아님 */
export function kospi200NightRateVsRegularClose(
  last: number,
  regularClose: number
): number | null {
  if (!(last > 0) || !(regularClose > 0)) return null;
  const r = last / regularClose - 1;
  if (!Number.isFinite(r)) return null;
  return r;
}
