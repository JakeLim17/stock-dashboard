/** Vercel CDN·브라우저 캐시용 Cache-Control 헬퍼 */

export function cacheControl(
  maxAgeSec: number,
  sMaxAgeSec: number,
  staleWhileRevalidateSec: number
): string {
  return `public, max-age=${maxAgeSec}, s-maxage=${sMaxAgeSec}, stale-while-revalidate=${staleWhileRevalidateSec}`;
}

/** 강제 갱신·에러 — 캐시 금지 */
export const NO_STORE = "no-store";

/** lite 스냅샷 — 시세만, 정규장 폴링 15s·서버 lite TTL 12s와 맞춤 */
export const SNAPSHOT_LITE_CACHE = cacheControl(10, 15, 60);

/** core/full 스냅샷 — 인증 응답이라 브라우저·CDN 공유 캐시 금지 */
export const SNAPSHOT_CORE_CACHE = "private, no-store";

/** full 스냅샷 — 분석·뉴스. 인증 응답이라 공유 캐시 금지 */
export const SNAPSHOT_FULL_CACHE = "private, no-store";

/** 분봉 스파크라인 — 시각 보조, 장중·마감 모두 길게 */
export const SPARKLINE_CACHE = cacheControl(120, 300, 900);
