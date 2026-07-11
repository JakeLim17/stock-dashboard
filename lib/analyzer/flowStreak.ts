/**
 * 외인·기관 순매수/순매도 연속일 계산.
 * dailyNets[0] = 가장 최근 거래일 (KIS/네이버 응답 순서와 동일).
 * 양수 = 연속 순매수 일수, 음수 = 연속 순매도 일수, 0 = 없음/중립.
 */
export function computeNetStreak(
  dailyNets: Array<number | null | undefined>
): number {
  if (!dailyNets.length) return 0;
  const first = dailyNets[0];
  if (first == null || !Number.isFinite(first) || first === 0) return 0;
  const sign = Math.sign(first);
  let streak = 0;
  for (const n of dailyNets) {
    if (n == null || !Number.isFinite(n) || Math.sign(n) !== sign) break;
    streak += 1;
  }
  return sign * streak;
}

export function streakBuyDays(streak: number | null | undefined): number {
  return streak != null && streak > 0 ? streak : 0;
}

export function streakSellDays(streak: number | null | undefined): number {
  return streak != null && streak < 0 ? Math.abs(streak) : 0;
}
