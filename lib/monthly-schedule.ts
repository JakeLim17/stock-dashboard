import "server-only";

import type { EventItem } from "./types";
import type { ScheduleEntry } from "./monthly-schedule-types";
import { getMacroEventsCached } from "./providers/eventCalendar";
import { getEventsForSymbolCached } from "./providers/eventCalendar";
import { PRIMARY_SYMBOLS, WATCHLIST_CANDIDATES } from "./symbols";

/** 월별 일정에 실적·배당을 자동 수집할 종목 (PRIMARY + SK·LG 계열) */
const SCHEDULE_SYMBOL_CODES = [
  ...PRIMARY_SYMBOLS.map((m) => m.code),
  "402340.KS", // SK스퀘어
  "096770.KS", // SK이노베이션
  "017670.KS", // SK텔레콤
  "361610.KQ", // SK아이이테크놀로지
  "066570.KS", // LG전자
  "051910.KS", // LG화학
  "034220.KS", // LG디스플레이
  "373220.KS", // LG에너지솔루션
] as const;

const SCHEDULE_SYMBOLS = SCHEDULE_SYMBOL_CODES.map((code) => {
  const meta = WATCHLIST_CANDIDATES.find((m) => m.code === code);
  if (!meta) throw new Error(`schedule symbol missing: ${code}`);
  return meta;
});

export type { ScheduleEntry, ScheduleKind } from "./monthly-schedule-types";

function kstMidnight(year: number, month1: number, day: number): number {
  return Date.UTC(year, month1 - 1, day) - 9 * 3600 * 1000;
}

function monthRange(year: number, month1: number): { start: number; end: number } {
  const start = kstMidnight(year, month1, 1);
  const nextMonth = month1 === 12 ? 1 : month1 + 1;
  const nextYear = month1 === 12 ? year + 1 : year;
  const end = kstMidnight(nextYear, nextMonth, 1) - 1;
  return { start, end };
}

function overlapsMonth(
  entryStart: number,
  entryEnd: number,
  rangeStart: number,
  rangeEnd: number
): boolean {
  return entryStart <= rangeEnd && entryEnd >= rangeStart;
}

function eventToSchedule(e: EventItem, idSuffix: string): ScheduleEntry {
  const country =
    e.kind === "bok_rate" || e.kind === "holiday" || e.kind === "kr_trade"
      ? "kr"
      : e.kind === "fomc" ||
          e.kind === "us_cpi" ||
          e.kind === "us_ppi" ||
          e.kind === "us_nfp"
        ? "us"
        : e.symbolCode?.endsWith(".KS") || e.symbolCode?.endsWith(".KQ")
          ? "kr"
          : undefined;

  return {
    id: `${e.kind}-${e.date}-${idSuffix}`,
    startDate: e.date,
    label: e.label,
    kind: e.kind,
    country,
    symbolCode: e.symbolCode,
    importance: e.importance,
    isHoliday: e.kind === "holiday",
    detail: e.detail,
  };
}

// 야후·매크로 캘린더에 없는 해석·커스텀 일정 (매월 수동 보강)
const CURATED_SCHEDULE: ScheduleEntry[] = [
  // ── 2026년 7월 (스크린샷 기준) ─────────────────────────────────────────
  {
    id: "curated-2026-07-kosdaq30",
    startDate: kstMidnight(2026, 7, 1),
    endDate: kstMidnight(2026, 7, 3),
    label: "코스닥 30주년 기념 행사",
    kind: "custom",
    country: "kr",
    importance: "low",
    detail: "코스닥 시장 30주년 관련 행사·세미나",
  },
  {
    id: "curated-2026-07-us-independence",
    startDate: kstMidnight(2026, 7, 3),
    label: "미국 독립기념일",
    kind: "holiday",
    country: "us",
    importance: "medium",
    isHoliday: true,
    detail: "미국 증시 휴장 — NFP는 7/2(목) 발표",
  },
  {
    id: "curated-2026-07-samsung-pre-earnings",
    startDate: kstMidnight(2026, 7, 7),
    label: "삼성전자 2분기 잠정 실적",
    kind: "earnings",
    country: "kr",
    symbolCode: "005930.KS",
    importance: "high",
    detail: "잠정 실적 공시 예정 — 반도체 업황 체크포인트",
  },
  {
    id: "curated-2026-07-nato",
    startDate: kstMidnight(2026, 7, 7),
    endDate: kstMidnight(2026, 7, 8),
    label: "NATO 정상회의",
    kind: "conference",
    country: "global",
    importance: "medium",
    detail: "지정학·방산 섹터 변동성 참고",
  },
  {
    id: "curated-2026-07-sk-adr",
    startDate: kstMidnight(2026, 7, 10),
    label: "SK하이닉스 미국 ADR 상장",
    kind: "ipo",
    country: "kr",
    symbolCode: "000660.KS",
    importance: "high",
    detail: "미국 예탁증권(ADR) 상장 일정 — 일정 변동 가능",
  },
  {
    id: "curated-2026-07-sk-square-adr",
    startDate: kstMidnight(2026, 7, 6),
    endDate: kstMidnight(2026, 7, 10),
    label: "SK스퀘어 — 하이닉스 ADR 상장 수혜",
    kind: "custom",
    country: "kr",
    symbolCode: "402340.KS",
    importance: "medium",
    detail: "SK 지주·하이닉스 지분가치 재평가 구간 (7/10 ADR 상장 전후)",
  },
  {
    id: "curated-2026-07-lg-display",
    startDate: kstMidnight(2026, 7, 8),
    label: "LG디스플레이 — OLED 수요 체크",
    kind: "custom",
    country: "kr",
    symbolCode: "034220.KS",
    importance: "low",
    detail: "IT 패널 수요·가격 동향 모니터링",
  },
  {
    id: "curated-2026-07-lg-chem",
    startDate: kstMidnight(2026, 7, 15),
    label: "LG화학 2분기 실적",
    kind: "earnings",
    country: "kr",
    symbolCode: "051910.KS",
    importance: "high",
    detail: "배터리 소재·석유화학 — 실적 일정 변동 가능",
  },
  {
    id: "curated-2026-07-lg-electronics",
    startDate: kstMidnight(2026, 7, 21),
    label: "LG전자 2분기 실적",
    kind: "earnings",
    country: "kr",
    symbolCode: "066570.KS",
    importance: "high",
    detail: "가전·VS사업 — 삼성전자 실적 흐름과 연동 체크",
  },
  {
    id: "curated-2026-07-sk-innovation",
    startDate: kstMidnight(2026, 7, 24),
    label: "SK이노베이션 2분기 실적",
    kind: "earnings",
    country: "kr",
    symbolCode: "096770.KS",
    importance: "medium",
    detail: "정유·배터리 — SK 계열 실적 시즌",
  },
  {
    id: "curated-2026-07-constitution",
    startDate: kstMidnight(2026, 7, 17),
    label: "제헌절",
    kind: "holiday",
    country: "kr",
    importance: "low",
    isHoliday: true,
    detail: "공휴일 아님 — 일부 캘린더·증권사 안내에만 표기",
  },
  {
    id: "curated-2026-07-samsung-final-earnings",
    startDate: kstMidnight(2026, 7, 23),
    label: "삼성전자 2분기 확정 실적",
    kind: "earnings",
    country: "kr",
    symbolCode: "005930.KS",
    importance: "high",
    detail: "확정 실적·컨퍼런스콜 — 잠정 대비 서프라이즈 체크",
  },
  {
    id: "curated-2026-07-sk-earnings",
    startDate: kstMidnight(2026, 7, 29),
    label: "SK하이닉스 실적 발표",
    kind: "earnings",
    country: "kr",
    symbolCode: "000660.KS",
    importance: "high",
  },
  {
    id: "curated-2026-07-pension-rebal",
    startDate: kstMidnight(2026, 7, 25),
    endDate: kstMidnight(2026, 7, 31),
    label: "연기금 리밸런싱 예정",
    kind: "custom",
    country: "kr",
    importance: "medium",
    detail: "분기 말 전후 대형주·지수 수급 변동 참고 (공식 일정 없음)",
  },
  // ── 2026년 8월 (다음 달 미리보기용 샘플) ───────────────────────────────
  {
    id: "curated-2026-08-bok",
    startDate: kstMidnight(2026, 8, 27),
    label: "한국은행 금통위 (기준금리)",
    kind: "bok_rate",
    country: "kr",
    importance: "high",
    detail: "8월 통화정책방향 결정",
  },
];

function dedupeByLabelDate(entries: ScheduleEntry[]): ScheduleEntry[] {
  const seen = new Set<string>();
  const out: ScheduleEntry[] = [];
  for (const e of entries) {
    const key = `${e.startDate}-${e.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** year + month(1~12) 기준 월별 일정 — 매크로·종목·커스텀 병합 */
export async function getMonthlySchedule(
  year: number,
  month1: number
): Promise<ScheduleEntry[]> {
  const { start, end } = monthRange(year, month1);

  const macro = getMacroEventsCached().map((e, i) =>
    eventToSchedule(e, `macro-${i}`)
  );

  const symbolEvents = (
    await Promise.all(
      SCHEDULE_SYMBOLS.map((meta) => getEventsForSymbolCached(meta))
    )
  ).flatMap((events, symIdx) =>
    events.map((e, i) => eventToSchedule(e, `sym-${symIdx}-${i}`))
  );

  const curated = CURATED_SCHEDULE.filter((e) => {
    const entryEnd = e.endDate ?? e.startDate;
    return overlapsMonth(e.startDate, entryEnd, start, end);
  });

  const merged = [...macro, ...symbolEvents, ...curated].filter((e) => {
    const entryEnd = e.endDate ?? e.startDate;
    return overlapsMonth(e.startDate, entryEnd, start, end);
  });

  return dedupeByLabelDate(merged).sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate - b.startDate;
    return importanceRank(a.importance) - importanceRank(b.importance);
  });
}

function importanceRank(level: "high" | "medium" | "low"): number {
  if (level === "high") return 0;
  if (level === "medium") return 1;
  return 2;
}
