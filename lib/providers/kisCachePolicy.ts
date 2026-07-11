/**
 * KIS 메모리 캐시 정책 (server-only 모듈에서 분리).
 * 테스트·kisExtraCache 가 같은 숫자를 공유한다.
 *
 * 왜 세션별 TTL인가:
 * - 단순 25s 고정은 장중엔 느리고, 장후엔 KIS 호출만 낭비.
 * - 장중 짧게 + 장후 길게 + SWR 이면 rate limit 은 지키면서 UI 체감은 살아남.
 *
 * KR lite 시세는 보통 네이버 1순위라 KIS 시세 TTL과 무관.
 * 해외·KR 지수·네이버 실패 폴백만 이 정책의 영향을 받는다.
 */

import {
  isKrRegularSession,
  isUsRegularSession,
} from "../analyzer/tradingSession";

/** 장중 시세 — 클라이언트 정규장 폴링(15s)보다 짧게. rate limit 여유 확보 */
export const QUOTE_TTL_OPEN_MS = 8_000;
/** 프리/애프터/휴장 — 가격 거의 안 바뀜 */
export const QUOTE_TTL_CLOSED_MS = 45_000;
/**
 * fresh 만료 후에도 이 구간은 stale 값을 즉시 반환하고 백그라운드 재조회.
 * UI 응답은 빠르고, in-flight 디듀프로 burst 도 막음.
 */
export const QUOTE_STALE_WHILE_REVALIDATE_MS = 20_000;

export const FLOW_TTL_MS = 5 * 60_000;
export const NULL_TTL_MS = 10_000;

/** 클라이언트 정규장 lite 폴링 (DashboardClient REGULAR_REFRESH_MS 와 맞춤) */
export const REGULAR_POLL_MS = 15_000;
/** lite 스냅샷 서버 TTL — 폴링보다 짧아야 폴링마다 새 시세를 받을 수 있음 */
export const LITE_SNAPSHOT_TTL_MS = 12_000;
export const FULL_SNAPSHOT_TTL_MS = 60_000;

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

export function pickTtl<T>(data: T | null, dataTtl: number): number {
  return data == null ? NULL_TTL_MS : dataTtl;
}
