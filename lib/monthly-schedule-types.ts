import type { EventKind } from "./types";

/** 월별 주요 일정 — 스크린샷형 리스트용 (날짜 범위·국가·휴장 표시 지원) */
export type ScheduleKind = EventKind | "custom" | "conference" | "ipo";

export interface ScheduleEntry {
  id: string;
  startDate: number;
  endDate?: number;
  label: string;
  kind: ScheduleKind;
  country?: "kr" | "us" | "global";
  symbolCode?: string;
  importance: "high" | "medium" | "low";
  isHoliday?: boolean;
  detail?: string;
}
