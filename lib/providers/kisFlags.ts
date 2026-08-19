/**
 * KIS REST/WS 사용 여부 판정 (순수 함수 — 테스트·kis.ts·kisApproval 공유).
 *
 * 기본 OFF. 페이지 로드/폴링만으로 토큰·REST 0회.
 * ON 조건 (모두 필요):
 *   - KIS_ENABLED=1|true|yes|on  (명시적 옵트인)
 *   - KIS_APP_KEY / KIS_APP_SECRET 둘 다 있음
 *   - KIS_DISABLED 가 truthy 가 아님
 *
 * 키만 있고 KIS_ENABLED 미설정 → OFF (문자/알림톡 방지).
 */

function truthyFlag(raw: string | undefined): boolean {
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function isKisApiEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  if (truthyFlag(env.KIS_DISABLED)) return false;
  if (!truthyFlag(env.KIS_ENABLED)) return false;
  const key = env.KIS_APP_KEY?.trim();
  const secret = env.KIS_APP_SECRET?.trim();
  return !!(key && secret);
}
