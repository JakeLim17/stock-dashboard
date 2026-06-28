import "server-only";

import type { EventItem } from "./types";
import type { ScheduleEntry } from "./monthly-schedule-types";
import {
  getMacroEventsInRange,
  getEventsForSymbolInRange,
} from "./providers/eventCalendar";
import { dedupeEventItems, dedupeScheduleEntries } from "./schedule-dedup";
import { PRIMARY_SYMBOLS, WATCHLIST_CANDIDATES } from "./symbols";
import {
  GROUP_CATALYST_PEERS,
  spilloverLeaderEvents,
} from "./symbol-groups";

/** 월별 일정에 실적·배당을 자동 수집할 종목 (PRIMARY + SK·LG 계열) */
const SCHEDULE_SYMBOL_CODES = [
  ...PRIMARY_SYMBOLS.map((m) => m.code),
  "034730.KS", // SK (지주)
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
  // ── 2026년 6월 ─────────────────────────────────────────
  // 6/1 수출입 — eventCalendar KR_TRADE_DATES 와 중복이라 생략
  {
    id: "curated-2026-06-q2-earnings-preview",
    startDate: kstMidnight(2026, 6, 15),
    endDate: kstMidnight(2026, 6, 30),
    label: "2분기 실적 시즌 본격화",
    kind: "custom",
    country: "kr",
    importance: "high",
    detail: "삼성·SK·LG 잠정 실적 전망·컨센서스 상향 구간",
  },
  {
    id: "curated-2026-06-samsung-electro-mlcc",
    startDate: kstMidnight(2026, 6, 18),
    label: "삼성전기 MLCC·AI 서버 부품 수요",
    kind: "custom",
    country: "kr",
    symbolCode: "009150.KS",
    importance: "medium",
    detail: "고부가 MLCC 공급 부족 — 대형주 변동성 속 저평가 구간",
  },
  {
    id: "curated-2026-06-sk-adr-buildup",
    startDate: kstMidnight(2026, 6, 20),
    endDate: kstMidnight(2026, 7, 9),
    label: "SK하이닉스 ADR 상장 기대감",
    kind: "custom",
    country: "kr",
    symbolCode: "000660.KS",
    importance: "high",
    detail: "7/10 ADR 상장 전 기대 피크·단기 차익 구간 (7/6~9 주의)",
  },
  {
    id: "curated-2026-06-sk-square-benefit",
    startDate: kstMidnight(2026, 6, 22),
    endDate: kstMidnight(2026, 7, 10),
    label: "SK스퀘어 — 하이닉스 ADR 수혜",
    kind: "custom",
    country: "kr",
    symbolCode: "402340.KS",
    importance: "medium",
    detail: "지주사 지분가치 재평가 — 하이닉스 본주 부담 시 대안",
  },
  {
    id: "curated-2026-06-sk-holdings-benefit",
    startDate: kstMidnight(2026, 6, 22),
    endDate: kstMidnight(2026, 7, 10),
    label: "SK — 하이닉스 ADR·계열 호재",
    kind: "custom",
    country: "kr",
    symbolCode: "034730.KS",
    importance: "medium",
    detail: "SK 지주 — 하이닉스 지분가치·ADR 상장 기대 연동",
  },
  {
    id: "curated-2026-06-samsung-buyback",
    startDate: kstMidnight(2026, 6, 10),
    endDate: kstMidnight(2026, 6, 25),
    label: "삼성전자 자사주 매입·2Q 기대",
    kind: "custom",
    country: "kr",
    symbolCode: "005930.KS",
    importance: "high",
    detail: "대규모 자사주 + 2분기 서프라이즈 기대 — 실적 전 매수 구간",
  },
  {
    id: "curated-2026-06-pension-rebal",
    startDate: kstMidnight(2026, 6, 25),
    endDate: kstMidnight(2026, 6, 30),
    label: "2분기 말 연기금 리밸런싱",
    kind: "custom",
    country: "kr",
    importance: "medium",
    detail: "분기 말 전후 대형주·지수 수급 변동 참고",
  },
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
    id: "curated-2026-07-sk-holdings-adr",
    startDate: kstMidnight(2026, 7, 6),
    endDate: kstMidnight(2026, 7, 10),
    label: "SK — 하이닉스 ADR 상장 수혜",
    kind: "custom",
    country: "kr",
    symbolCode: "034730.KS",
    importance: "medium",
    detail: "SK 지주 — 하이닉스 지분가치·ADR 랠리 연동",
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
  // 8월 금통위 — eventCalendar BOK_DATES_2026 와 중복이라 생략
];

function scheduleToEventItem(e: ScheduleEntry): EventItem {
  const kind: EventItem["kind"] =
    e.kind === "custom" || e.kind === "conference" || e.kind === "ipo"
      ? "earnings"
      : e.kind;
  return {
    kind,
    symbolCode: e.symbolCode,
    label: e.label,
    date: e.startDate,
    importance: e.importance,
    detail:
      e.kind === "ipo"
        ? [e.detail, "ipo"].filter(Boolean).join(" · ")
        : e.detail,
  };
}

/** 종목 전용 커스텀 — 글로벌 일정은 macro 경로로만. SK 계열은 하이닉스 리더 일정 전이 */
export function getCuratedUpcomingForSymbol(
  symbolCode: string,
  daysAhead = 60
): EventItem[] {
  const merged = getCuratedEventsMerged(daysAhead);
  const own = merged.filter((e) => e.symbolCode === symbolCode);
  const leaderCode = GROUP_CATALYST_PEERS[symbolCode]?.leaderCode;
  if (!leaderCode || leaderCode === symbolCode) return own;
  const leaderEvents = merged.filter((e) => e.symbolCode === leaderCode);
  return [...own, ...spilloverLeaderEvents(symbolCode, leaderEvents)];
}

/** 매크로+커스텀 전체 (종목 무관) — EventCalendar·macroEvents 보강용 */
export function getCuratedMacroUpcoming(daysAhead = 60): EventItem[] {
  return getCuratedEventsMerged(daysAhead).filter((e) => !e.symbolCode);
}

declare global {
  // eslint-disable-next-line no-var
  var __monthlyScheduleCache:
    | Map<string, { data: ScheduleEntry[]; expiresAt: number }>
    | undefined;
}

const MONTHLY_SCHEDULE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — Vercel 함수 재호출 절감

function monthlyCache(): Map<
  string,
  { data: ScheduleEntry[]; expiresAt: number }
> {
  if (!global.__monthlyScheduleCache) {
    global.__monthlyScheduleCache = new Map();
  }
  return global.__monthlyScheduleCache;
}

/** year + month(1~12) 기준 월별 일정 — 매크로·종목·커스텀 병합 */
export async function getMonthlySchedule(
  year: number,
  month1: number
): Promise<ScheduleEntry[]> {
  const cacheKey = `${year}-${month1}`;
  const hit = monthlyCache().get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const { start, end } = monthRange(year, month1);

  const macro = getMacroEventsInRange(start, end).map((e, i) =>
    eventToSchedule(e, `macro-${i}`)
  );

  const symbolEvents = (
    await Promise.all(
      SCHEDULE_SYMBOLS.map((meta) =>
        getEventsForSymbolInRange(meta, start, end)
      )
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

  const result = dedupeScheduleEntries(merged);

  monthlyCache().set(cacheKey, {
    data: result,
    expiresAt: Date.now() + MONTHLY_SCHEDULE_TTL_MS,
  });
  return result;
}

/** 다가올 N일 — 월별 일정과 동일 소스·중복 제거 (API mode=upcoming) */
export async function getUpcomingSchedule(
  daysAhead = 60
): Promise<ScheduleEntry[]> {
  const now = Date.now();
  const start = now - 86_400_000;
  const end = now + daysAhead * 86_400_000;

  const kst = new Date(now + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const months: Array<{ year: number; month: number }> = [{ year: y, month: m }];
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  months.push({ year: nextY, month: nextM });

  const chunks = await Promise.all(
    months.map(({ year, month }) => getMonthlySchedule(year, month))
  );

  return dedupeScheduleEntries(
    chunks
      .flat()
      .filter((e) => {
        const entryEnd = e.endDate ?? e.startDate;
        return entryEnd >= start && e.startDate <= end;
      })
  );
}

/** EventItem[] — snapshot·EventCalendar용 (커스텀+매크로 통합) */
export function getCuratedEventsMerged(daysAhead = 60): EventItem[] {
  const now = Date.now();
  const upper = now + daysAhead * 86_400_000;
  return dedupeEventItems(
    CURATED_SCHEDULE.filter((e) => {
      const end = e.endDate ?? e.startDate;
      return end >= now - 86_400_000 && e.startDate <= upper;
    }).map(scheduleToEventItem)
  );
}
