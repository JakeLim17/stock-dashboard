/**
 * 예측 베이스 레이어 — 정직한 통계 drift.
 * ChronoPulse(수급·뉴스·미장 등)는 가산 알파로만 얹는다.
 *
 *   center = price · exp(baseHorizon + chronoAlphaHorizon)
 *   band   = center · exp(± σ √t)  (predictor 쪽)
 *
 * 알파가 작아도 horizon 에 따라 center 가 움직이도록
 * 단기·중기 모멘텀을 눈에 띄게(단, 랜덤워크 노이즈 수준은 아님) 유지한다.
 */

const BASE_DAILY_CAP = 0.015;

function clamp(d: number, cap = BASE_DAILY_CAP): number {
  return Math.max(-cap, Math.min(cap, d));
}

/** 최근 N일 평균 로그수익률 — 표본 1개도 허용(상장 직후) */
export function meanLogReturn(returns: number[], days = 5): number | null {
  if (!returns.length) return null;
  const slice = returns.slice(-days);
  if (slice.length < 1) return null;
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / slice.length;
}

/**
 * 일간 베이스 drift.
 * - 5일 모멘텀(수축 완화) + 20일 모멘텀 보조
 * - 단기≈0 이고 중기에 방향이 있으면 중기 비중 확대 (flat 방지)
 * - 당일 급변 시 약한 평균회귀
 */
export function computeBaseDriftDaily(
  returns: number[],
  todayChangeRate?: number | null
): number {
  const mu5 = meanLogReturn(returns, 5);
  const mu20 = meanLogReturn(returns, 20);

  let daily = 0;
  if (mu5 != null && mu20 != null) {
    // 단기가 거의 횡보인데 중기에 방향이 있으면 중기를 더 씀 → 점선이 안 죽게
    if (Math.abs(mu5) < 0.001 && Math.abs(mu20) >= 0.0015) {
      daily = mu20 * 0.72;
    } else {
      daily = mu5 * 0.85 + mu20 * 0.35;
    }
  } else if (mu5 != null) {
    daily = mu5 * 0.9;
  } else if (mu20 != null) {
    daily = mu20 * 0.65;
  }

  if (
    todayChangeRate != null &&
    Number.isFinite(todayChangeRate) &&
    Math.abs(todayChangeRate) >= 0.02
  ) {
    daily += -todayChangeRate * 0.14;
  }

  return clamp(daily);
}

/**
 * 베이스 √t 누적 지속률.
 * 장기에도 center 가 분명히 움직이도록 persist 상향.
 */
export function baseDriftPersist(horizonDays: number): number {
  if (horizonDays <= 1) return 1;
  if (horizonDays <= 3) return 0.98;
  if (horizonDays <= 5) return 0.94;
  if (horizonDays <= 10) return 0.88;
  return 0.85;
}

export function baseDriftForHorizon(
  baseDaily: number,
  horizonDays: number
): number {
  return clamp(
    baseDaily * Math.sqrt(Math.max(1, horizonDays)) * baseDriftPersist(horizonDays),
    0.12
  );
}

export function formatBaseBps(bps: number): string {
  const pct = bps / 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
