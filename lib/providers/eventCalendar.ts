import "server-only";
import YahooFinance from "yahoo-finance2";
import type { EventItem, SymbolMeta } from "../types";
import { isKrStock } from "./naver";

// 이벤트 캘린더 — 실적·배당·FOMC·KOSPI 옵션 만기·KRX 휴장일을 통합해 EventItem[] 으로 반환.
//
// 데이터 소스:
//   - earnings / dividend  : yahoo-finance2 quoteSummary.calendarEvents
//   - fomc                 : 2026·2027 일부 hardcoded (Fed 공식 발표)
//   - kospi_expiry         : 매월 두 번째 목요일 (계산)
//   - holiday              : 2026 KRX 휴장일 hardcoded
//
// 캐시: 종목별 24h TTL (실적·배당은 자주 안 바뀜).
// Vercel 함수 인스턴스마다 메모리 분리 — cold start 시 다시 채워지면 OK.

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const EVENT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
  data: EventItem[];
  expiresAt: number;
}

declare global {
  // 핫 리로드/모듈 재평가 시 캐시 유실 방지
  // eslint-disable-next-line no-var
  var __eventCalendarCache: Map<string, CacheEntry> | undefined;
}

function cache(): Map<string, CacheEntry> {
  if (!global.__eventCalendarCache) {
    global.__eventCalendarCache = new Map();
  }
  return global.__eventCalendarCache;
}

// ── KST 자정 epoch ms 유틸 ─────────────────────────────────────────────────
// 모든 EventItem.date 는 KST(UTC+9) 자정 기준으로 정규화한다.
// 표시는 D-N 계산에 사용되므로 시(時)는 의미 없음.
function kstMidnight(year: number, month1: number, day: number): number {
  // month1 = 1~12, KST = UTC+9 → UTC 기준 전날 15:00 이 KST 자정
  return Date.UTC(year, month1 - 1, day) - 9 * 3600 * 1000;
}

// Date → KST 자정 epoch ms (Date 객체 자체는 UTC 기반)
function toKstMidnight(d: Date): number {
  // KST로 본 연/월/일을 뽑아 UTC 자정으로 재구성
  const kstMs = d.getTime() + 9 * 3600 * 1000;
  const kst = new Date(kstMs);
  return kstMidnight(
    kst.getUTCFullYear(),
    kst.getUTCMonth() + 1,
    kst.getUTCDate()
  );
}

// ── 야후 calendarEvents (실적·배당) ────────────────────────────────────────
// 미국 종목은 거의 다 채워지고, 한국 종목은 일부만 채워진다.
// 실패 시 빈 배열 반환 (snapshot 전체를 막지 않음).
async function fetchYahooEvents(meta: SymbolMeta): Promise<EventItem[]> {
  type CalRaw = {
    earnings?: {
      earningsDate?: Array<Date | string | number>;
      isEarningsDateEstimate?: boolean;
    };
    exDividendDate?: Date | string | number;
    dividendDate?: Date | string | number;
  };

  try {
    const r = (await yahooFinance.quoteSummary(meta.code, {
      modules: ["calendarEvents"],
    })) as unknown as { calendarEvents?: CalRaw } | null;
    const cal = r?.calendarEvents;
    if (!cal) return [];

    const items: EventItem[] = [];

    // 실적 발표일 — earningsDate 배열의 가장 가까운 미래 일자.
    // 야후는 보통 range로 [from, to] 두 일자를 주는데 첫 값을 D-day로 사용.
    const earningsRaw = cal.earnings?.earningsDate;
    if (Array.isArray(earningsRaw) && earningsRaw.length > 0) {
      const first = toEpoch(earningsRaw[0]);
      if (first != null) {
        const date = toKstMidnight(new Date(first));
        const estimate = cal.earnings?.isEarningsDateEstimate === true;
        items.push({
          kind: "earnings",
          symbolCode: meta.code,
          label: `${meta.name} 실적 발표${estimate ? " (예정)" : ""}`,
          date,
          importance: "high",
          detail: estimate
            ? "야후 추정 — 실제 발표일과 다를 수 있음"
            : undefined,
        });
      }
    }

    // 배당 — exDividendDate (배당락일). 한국 종목은 야후가 종종 비워둠.
    const exDiv = toEpoch(cal.exDividendDate);
    if (exDiv != null) {
      items.push({
        kind: "dividend",
        symbolCode: meta.code,
        label: `${meta.name} 배당락`,
        date: toKstMidnight(new Date(exDiv)),
        importance: "medium",
        detail: "이 날 이후 매수하면 다음 배당 제외",
      });
    }

    return items;
  } catch {
    return [];
  }
}

function toEpoch(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) {
    return v > 1e12 ? v : v * 1000;
  }
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// ── 종목별 캐시 entrypoint ────────────────────────────────────────────────
export async function getEventsForSymbolCached(
  meta: SymbolMeta
): Promise<EventItem[]> {
  const now = Date.now();
  const c = cache();
  const hit = c.get(meta.code);
  if (hit && hit.expiresAt > now) return hit.data;

  const events = await fetchYahooEvents(meta).catch(() => [] as EventItem[]);
  // 미래 + 어제까지 7일 이내(배당락 직전 안내 등)만 유지. 너무 먼 미래(>180일)도 잘라낸다.
  const filtered = filterUpcoming(events, 180);
  c.set(meta.code, { data: filtered, expiresAt: now + EVENT_TTL_MS });
  return filtered;
}

// 어제 ~ N일 후 범위만 남기고, 날짜 오름차순 정렬.
function filterUpcoming(items: EventItem[], days: number): EventItem[] {
  const now = Date.now();
  const lower = now - 1 * 86_400_000; // 어제까지는 유지 (당일 D-0 표시)
  const upper = now + days * 86_400_000;
  return items
    .filter((e) => e.date >= lower && e.date <= upper)
    .sort((a, b) => a.date - b.date);
}

// ── 매크로 이벤트 ───────────────────────────────────────────────────────────
// FOMC 정책결정 발표일(2일차) — 2026·2027 일부.
// 출처: federalreserve.gov 2024-08-09 발표 (tentative 2025·2026 schedule)
// 시각은 한국 시각 새벽 ~ 오전이라 KST 날짜로 +1일 보정.
//   미 동부 14:00 (정책성명) ≈ KST 새벽 03:00~04:00 → 회의 2일차 다음 날 새벽이 한국 사용자에게는
//   "이 날 새벽에 발표" 로 인식되지만, 시장 영향이 가장 큰 것은 한국 정규장 당일.
//   사용자 직관에 맞춰 발표일을 그대로 사용 (회의 2일차 미국 날짜).
const FOMC_DATES_2026: Array<[number, number, number]> = [
  // [YYYY, M, D] - 미국 시각 회의 2일차 = 정책성명 발표일
  [2026, 1, 28],
  [2026, 3, 18],
  [2026, 4, 29],
  [2026, 6, 17],
  [2026, 7, 29],
  [2026, 9, 16],
  [2026, 10, 28],
  [2026, 12, 9],
];

// 2027년 1월까지 (연말~연초 사용자 노출용)
const FOMC_DATES_2027: Array<[number, number, number]> = [[2027, 1, 27]];

// ── 한국은행 금융통화위원회 (BOK) 2026 기준금리 결정 일정 ─────────────────────
// 출처: bok.or.kr 통화정책방향 결정회의 일정.
// 시간대: 한국 오전 (10:00~11:00). 발표 직후 KOSPI·USDKRW 변동성 확대.
const BOK_DATES_2026: Array<[number, number, number]> = [
  [2026, 1, 22],
  [2026, 2, 26],
  [2026, 4, 9],
  [2026, 5, 28],
  [2026, 7, 9],
  [2026, 8, 27],
  [2026, 10, 15],
  [2026, 11, 26],
];

// ── 미국 CPI (소비자물가지수) 발표 일정 ────────────────────────────────────
// 출처: bls.gov "Consumer Price Index" — 매월 둘째 또는 셋째 화·수요일 (월별).
// 시간대: 미 동부 08:30 = KST 21:30 → 한국 야간 시장·환율 즉시 반응.
// 2026 일정 (BLS scheduled releases, dates may shift ±1 day if revised).
const US_CPI_DATES_2026: Array<[number, number, number]> = [
  [2026, 1, 14],
  [2026, 2, 11],
  [2026, 3, 11],
  [2026, 4, 14],
  [2026, 5, 12],
  [2026, 6, 10],
  [2026, 7, 14],
  [2026, 8, 12],
  [2026, 9, 10],
  [2026, 10, 14],
  [2026, 11, 12],
  [2026, 12, 10],
];

// ── 미국 PPI (생산자물가지수) 발표 일정 ────────────────────────────────────
// 보통 CPI 다음 날 또는 같은 주 후반. 2026 일정 (BLS).
const US_PPI_DATES_2026: Array<[number, number, number]> = [
  [2026, 1, 15],
  [2026, 2, 12],
  [2026, 3, 12],
  [2026, 4, 15],
  [2026, 5, 13],
  [2026, 6, 11],
  [2026, 7, 15],
  [2026, 8, 13],
  [2026, 9, 11],
  [2026, 10, 15],
  [2026, 11, 13],
  [2026, 12, 11],
];

// ── 미국 NFP (비농업 고용지표 + 실업률) 발표 일정 ──────────────────────────
// 매월 첫째 금요일 (BLS Employment Situation Report). 미 동부 08:30 = KST 21:30.
// 2026 첫째 금요일 (1/2 = 새해 직후라 1/9로 이동되는 경우 있음, BLS 공식 schedule).
const US_NFP_DATES_2026: Array<[number, number, number]> = [
  [2026, 1, 9],
  [2026, 2, 6],
  [2026, 3, 6],
  [2026, 4, 3],
  [2026, 5, 1],
  [2026, 6, 5],
  [2026, 7, 2],   // 7/3 독립기념일 직전이라 7/2 발표
  [2026, 8, 7],
  [2026, 9, 4],
  [2026, 10, 2],
  [2026, 11, 6],
  [2026, 12, 4],
];

// ── 한국 수출입 통계 (관세청) 매월 초 발표 ────────────────────────────────
// 매월 1일 (휴장 시 직전 영업일) 09:00 KST 발표. 무역수지·반도체 수출 등이 KOSPI 즉시 영향.
// 2026 — 1일이 토·일·휴장이면 직전 영업일로.
const KR_TRADE_DATES_2026: Array<[number, number, number]> = [
  [2026, 1, 2],   // 1/1 신정 → 1/2
  [2026, 2, 2],   // 2/1 일요일 → 2/2
  [2026, 3, 2],   // 3/1 일요일 → 3/2
  [2026, 4, 1],
  [2026, 5, 1],
  [2026, 6, 1],
  [2026, 7, 1],
  [2026, 8, 3],   // 8/1 토요일 → 8/3
  [2026, 9, 1],
  [2026, 10, 1],
  [2026, 11, 2],  // 11/1 일요일 → 11/2
  [2026, 12, 1],
];

// ── KRX 2026 휴장일 (정규장 휴장) ──────────────────────────────────────────
// 출처: krx.co.kr 휴장일 공시 + 한국 공휴일 정상 추정.
// 휴장일 = 공휴일 + 대체공휴일 + 12월 31일 연말 휴장.
// 추후 갱신은 별도 commit으로 (12월에 다음 해 일정 추가).
const KRX_HOLIDAYS_2026: Array<{
  date: [number, number, number];
  label: string;
}> = [
  { date: [2026, 1, 1], label: "신정" },
  { date: [2026, 2, 16], label: "설 연휴" },
  { date: [2026, 2, 17], label: "설날" },
  { date: [2026, 2, 18], label: "설 연휴" },
  { date: [2026, 3, 2], label: "삼일절 대체" },
  { date: [2026, 5, 5], label: "어린이날" },
  { date: [2026, 5, 25], label: "부처님오신날 대체" },
  { date: [2026, 8, 17], label: "광복절 대체" },
  { date: [2026, 9, 24], label: "추석 연휴" },
  { date: [2026, 9, 25], label: "추석" },
  { date: [2026, 10, 5], label: "추석 대체" },
  { date: [2026, 10, 9], label: "한글날" },
  { date: [2026, 12, 25], label: "성탄절" },
  { date: [2026, 12, 31], label: "연말 휴장" },
];

// KOSPI200 옵션·선물 만기일 = 매월 두 번째 목요일.
// 만기일 ±1~2일은 주가 변동성 확대 (롤오버·청산) → 사용자에게 알려줄 가치 있음.
// 휴장일과 겹치면 직전 거래일로 이동하지만, 단순화를 위해 두 번째 목요일을 그대로 사용한다.
// 휴장과 충돌하는 경우는 KRX 공식 일정과 일치하지 않을 수 있음 — UI 라벨에 "예정"으로 표기.
function kospiSecondThursday(year: number, month1: number): number {
  // month1 = 1~12. UTC 기준으로 1일의 요일을 본 뒤 첫 목요일을 찾고 +7
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  const dow = first.getUTCDay(); // 0=일, 4=목
  const offsetToFirstThu = (4 - dow + 7) % 7;
  const firstThuDay = 1 + offsetToFirstThu;
  const secondThuDay = firstThuDay + 7;
  return kstMidnight(year, month1, secondThuDay);
}

function buildMacroEvents(): EventItem[] {
  const items: EventItem[] = [];

  // FOMC
  for (const [y, m, d] of [...FOMC_DATES_2026, ...FOMC_DATES_2027]) {
    items.push({
      kind: "fomc",
      label: `FOMC 정책 발표`,
      date: kstMidnight(y, m, d),
      importance: "high",
      detail: "미 연준 정책금리·점도표 — 한국 정규장 당일 변동성 확대",
    });
  }

  // 한국은행 금통위 (Fix4)
  for (const [y, m, d] of BOK_DATES_2026) {
    items.push({
      kind: "bok_rate",
      label: "한국은행 금통위 (기준금리)",
      date: kstMidnight(y, m, d),
      importance: "high",
      detail: "한은 통화정책방향 — KOSPI·USDKRW 즉시 반응",
    });
  }

  // 미국 CPI
  for (const [y, m, d] of US_CPI_DATES_2026) {
    items.push({
      kind: "us_cpi",
      label: "미국 CPI (소비자물가)",
      date: kstMidnight(y, m, d),
      importance: "high",
      detail: "미 동부 08:30 (KST 21:30) — 인플레 지표, 미국 시장 강한 반응",
    });
  }

  // 미국 PPI
  for (const [y, m, d] of US_PPI_DATES_2026) {
    items.push({
      kind: "us_ppi",
      label: "미국 PPI (생산자물가)",
      date: kstMidnight(y, m, d),
      importance: "medium",
      detail: "미 동부 08:30 (KST 21:30) — CPI 선행지표 성격",
    });
  }

  // 미국 NFP
  for (const [y, m, d] of US_NFP_DATES_2026) {
    items.push({
      kind: "us_nfp",
      label: "미국 고용보고서 (NFP)",
      date: kstMidnight(y, m, d),
      importance: "high",
      detail: "비농업 고용·실업률·시간당 임금 — 미 동부 08:30 (KST 21:30)",
    });
  }

  // 한국 수출입
  for (const [y, m, d] of KR_TRADE_DATES_2026) {
    items.push({
      kind: "kr_trade",
      label: "한국 수출입 통계",
      date: kstMidnight(y, m, d),
      importance: "medium",
      detail: "관세청 09:00 KST — 반도체·자동차 수출 KOSPI 영향",
    });
  }

  // KOSPI200 옵션·선물 만기 — 오늘 이후 12개월치 계산
  const now = new Date();
  const baseYear = now.getUTCFullYear();
  for (let i = 0; i < 14; i++) {
    const y = baseYear + Math.floor((now.getUTCMonth() + i) / 12);
    const m = ((now.getUTCMonth() + i) % 12) + 1;
    const date = kospiSecondThursday(y, m);
    // 분기말(3·6·9·12월)은 선물·옵션 동시만기 → importance high
    const isTriple = m === 3 || m === 6 || m === 9 || m === 12;
    items.push({
      kind: "kospi_expiry",
      label: isTriple
        ? "KOSPI200 선물·옵션 동시만기"
        : "KOSPI200 옵션 만기",
      date,
      importance: isTriple ? "high" : "low",
      detail: isTriple
        ? "분기 동시만기 — 프로그램 매매 청산·롤오버로 변동성 확대"
        : "두 번째 목요일 (휴장 시 직전 영업일로 이동 가능)",
    });
  }

  // KRX 휴장일
  for (const h of KRX_HOLIDAYS_2026) {
    const [y, m, d] = h.date;
    items.push({
      kind: "holiday",
      label: `KRX 휴장 — ${h.label}`,
      date: kstMidnight(y, m, d),
      importance: "low",
      detail: "한국 정규장 휴장 — 미국 시장은 정상",
    });
  }

  return items;
}

// 매크로는 빌드 결과를 한 번만 만들고 메모리에 캐싱. 24h마다 재빌드(자정 경과 시 D-N 갱신).
declare global {
  // eslint-disable-next-line no-var
  var __macroEventsCache: { data: EventItem[]; expiresAt: number } | undefined;
}

export function getMacroEventsCached(): EventItem[] {
  const now = Date.now();
  if (
    global.__macroEventsCache &&
    global.__macroEventsCache.expiresAt > now
  ) {
    return global.__macroEventsCache.data;
  }
  const built = filterUpcoming(buildMacroEvents(), 180);
  global.__macroEventsCache = { data: built, expiresAt: now + EVENT_TTL_MS };
  return built;
}

// 강제 갱신 — 사용자 새로고침(refresh=1)에서 사용 가능
export function invalidateEventCalendarCache(code?: string): void {
  if (code) {
    cache().delete(code);
  } else {
    cache().clear();
    global.__macroEventsCache = undefined;
  }
}

// ── 외부에서 한 번에 호출하는 헬퍼 ────────────────────────────────────────
// snapshot.ts 에서 종목별로 호출 — kr/us 모두 동일하게 야후 호출.
// 한국 종목은 야후가 종종 비워두지만 실패 안전 — 빈 배열 반환.
export async function fetchEventsForSymbol(meta: SymbolMeta): Promise<EventItem[]> {
  const events = await getEventsForSymbolCached(meta);
  // 다음 60일 이내만 카드용으로 반환. 더 먼 미래(컨센서스용)는 캐시에 둠.
  return events.filter(
    (e) => e.date >= Date.now() - 86_400_000 && e.date <= Date.now() + 60 * 86_400_000
  );
}

// 한국 종목 여부는 macro 이벤트 노출 정책에 사용될 수 있음 (예: KOSPI 만기는 한국 종목 카드에만).
// 현재는 모든 카드에서 다 보여주지만 향후 분기 가능하도록 export.
export { isKrStock };
