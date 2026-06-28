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

/** lite 스냅샷 — 시세만, 폴링 30s와 맞춤 */
export const SNAPSHOT_LITE_CACHE = cacheControl(25, 45, 120);

/** full 스냅샷 — 분석·뉴스, 10분마다 1회 full */
export const SNAPSHOT_FULL_CACHE = cacheControl(300, 600, 1800);

/** 분봉 스파크라인 — 시각 보조, 장중·마감 모두 길게 */
export const SPARKLINE_CACHE = cacheControl(120, 300, 900);
