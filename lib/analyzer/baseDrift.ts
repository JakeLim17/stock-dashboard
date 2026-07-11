/**
 * 예측 베이스 레이어 — 정직한 통계 drift.
 * ChronoPulse(수급·뉴스·미장 등)는 가산 알파로만 얹는다.
 *
 *   center = price · exp(baseHorizon + chronoAlphaHorizon)
 *   band   = center · exp(± σ √t)  (predictor 쪽)
 */

const BASE_DAILY_CAP = 0.008;

function clamp(d: number, cap = BASE_DAILY_CAP): number {
  return Math.max(-cap, Math.min(cap, d));
}

/** 최근 N일 평균 로그수익률 */
export function meanLogReturn(returns: number[], days = 5): number | null {
  if (!returns.length) return null;
  const slice = returns.slice(-days);
  if (slice.length < 2) return null;
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / slice.length;
}

/**
 * 일간 베이스 drift.
 * - 단기 모멘텀을 0 쪽으로 50% 수축 (과신 방지)
 * - 당일 급변 시 약한 평균회귀
 */
export function computeBaseDriftDaily(
  returns: number[],
  todayChangeRate?: number | null
): number {
  const mu = meanLogReturn(returns, 5);
  let daily = mu != null ? mu * 0.5 : 0;

  if (
    todayChangeRate != null &&
    Number.isFinite(todayChangeRate) &&
    Math.abs(todayChangeRate) >= 0.025
  ) {
    daily += -todayChangeRate * 0.15;
  }

  return clamp(daily);
}

/** 베이스는 √t 누적 + 완만한 희석 — flat 방지하되 폭주는 막음 */
export function baseDriftPersist(horizonDays: number): number {
  if (horizonDays <= 1) return 1;
  if (horizonDays <= 3) return 0.85;
  if (horizonDays <= 5) return 0.7;
  if (horizonDays <= 10) return 0.55;
  return 0.45;
}

export function baseDriftForHorizon(
  baseDaily: number,
  horizonDays: number
): number {
  return clamp(
    baseDaily * Math.sqrt(Math.max(1, horizonDays)) * baseDriftPersist(horizonDays),
    0.06
  );
}

export function formatBaseBps(bps: number): string {
  const pct = bps / 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
