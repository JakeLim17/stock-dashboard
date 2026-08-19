/**
 * KIS 메모리 캐시·클라이언트 폴링 정책 (server-only 모듈에서 분리).
 * 테스트·kisExtraCache·DashboardClient·snapshot 이 같은 숫자를 공유한다.
 *
 * Vercel 함수 호출 절감 원칙 (2026-07):
 * - 폴링 간격 ≥ 서버 TTL (짧으면 매 폴링마다 cold miss → 람다 깨움)
 * - 장중 lite 90s, 장후/시간외 3분, 휴장 5분, full 예측 15분
 * - KR lite 시세는 보통 네이버 1순위라 KIS 시세 TTL과 무관.
 *   해외·KR 지수·네이버 실패 폴백만 시세 TTL 정책의 영향을 받는다.
 *
 * KIS 호출 절감 (2026-07-13):
 * - 수급(flow)은 장중 1시간·장후/휴장 24시간 (당일 1회에 가깝게).
 * - 호가(asking)도 장중 10분·장후 24시간 — full 스냅샷 fanout 흡수.
 * - Vercel cold start 대비 수급은 KV(kisExtraCache)에도 동일 TTL로 저장.
 */

import {
  isKrRegularSession,
  isUsRegularSession,
} from "../analyzer/tradingSession";

// ─── 클라이언트 lite 폴링 (DashboardClient 기본값과 동기) ─────────
/** 정규장 — 45s도 Hobby Active CPU 에 부담. 90s로 절감 (시세 체감은 카드 갱신으로 충분). */
export const REGULAR_POLL_MS = 90_000;
/** 프리/애프터/한국 시간외 — 2~5분 권장, 3분 */
export const EXTENDED_POLL_MS = 180_000;
/** 해외 야간 — 3분 */
export const OVERSEAS_NIGHT_POLL_MS = 180_000;
/** 완전 휴장 — 5분 (요청 범위 상단). 더 드물게 하려면 env로 늘리기 */
export const OFF_HOURS_POLL_MS = 300_000;
/** full 분석·예측 최소 간격 — 15분이면 충분 */
export const FULL_SNAPSHOT_MIN_MS = 900_000;

// ─── 시세(KIS) 메모리 TTL ───────────────────────────────────────
/** 장중 시세 — 정규장 폴링(90s)보다 짧게. rate limit 여유 */
export const QUOTE_TTL_OPEN_MS = 20_000;
/** 프리/애프터/휴장 — 가격 거의 안 바뀜 (해외 시세 fanout 절감) */
export const QUOTE_TTL_CLOSED_MS = 300_000;
/**
 * fresh 만료 후에도 이 구간은 stale 값을 즉시 반환하고 백그라운드 재조회.
 * UI 응답은 빠르고, in-flight 디듀프로 burst 도 막음.
 */
export const QUOTE_STALE_WHILE_REVALIDATE_MS = 45_000;

/** 수급 — 장중 (외인·기관은 분 단위로 크게 안 바뀜) */
export const FLOW_TTL_OPEN_MS = 60 * 60_000;
/** 수급 — 장후/휴장 (당일 1회에 가깝게) */
export const FLOW_TTL_CLOSED_MS = 24 * 60 * 60_000;
/**
 * @deprecated flowTtlMs() 사용. 하위 호환·테스트용 = 장중 TTL.
 */
export const FLOW_TTL_MS = FLOW_TTL_OPEN_MS;

/** 호가 — 장중 예측 알파용 (12s는 접속마다 full fanout 유발) */
export const ASKING_TTL_OPEN_MS = 10 * 60_000;
/** 호가 — 장후/휴장 */
export const ASKING_TTL_CLOSED_MS = 24 * 60 * 60_000;

export const NULL_TTL_MS = 10_000;

// ─── 스냅샷 서버 메모리 TTL (≥ 폴링과 맞추거나 더 길게 ─────────
/** lite — 정규장 폴링과 동일. 더 짧으면 폴링마다 람다 재실행 */
export const LITE_SNAPSHOT_TTL_MS = REGULAR_POLL_MS;
/** core — 진입 시 1회 위주, 중복 탭·Strict Mode 흡수 */
export const CORE_SNAPSHOT_TTL_MS = 120_000;
/** full — 클라이언트 15분 주기와 맞춤 (인스턴스 내 중복 흡수) */
export const FULL_SNAPSHOT_TTL_MS = FULL_SNAPSHOT_MIN_MS;

export type QuoteMarket = "kr" | "us";

export function isQuoteRegularSession(
  market: QuoteMarket,
  now = new Date()
): boolean {
  return market === "us" ? isUsRegularSession(now) : isKrRegularSession(now);
}

export function quoteTtlMs(market: QuoteMarket, now = new Date()): number {
  return isQuoteRegularSession(market, now)
    ? QUOTE_TTL_OPEN_MS
    : QUOTE_TTL_CLOSED_MS;
}

/** 수급 TTL — KR 정규장만 짧게, 그 외 24h */
export function flowTtlMs(now = new Date()): number {
  return isKrRegularSession(now) ? FLOW_TTL_OPEN_MS : FLOW_TTL_CLOSED_MS;
}

/** 호가 TTL — KR 정규장 10분, 그 외 24h */
export function askingTtlMs(now = new Date()): number {
  return isKrRegularSession(now) ? ASKING_TTL_OPEN_MS : ASKING_TTL_CLOSED_MS;
}

export function pickTtl<T>(data: T | null, dataTtl: number): number {
  return data == null ? NULL_TTL_MS : dataTtl;
}
