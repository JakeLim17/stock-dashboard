/**
 * 예측 밴드(low~high) 반폭 상한 — σ√t·뉴스·이벤트 곱이 폭주해도
 * 현재가 대비 비현실적 레인지(예: 0.3×~2.8×)를 막는다.
 */

/** horizonDays → 절대 반폭 상한 (center 대비, 예: 0.32 = ±32%) */
export const BAND_HALF_WIDTH_ABS_CAPS: Record<number, number> = {
  1: 0.1,
  3: 0.15,
  5: 0.2,
  10: 0.28,
  22: 0.32,
};

const DEFAULT_ABS_CAP = 0.35;
/** 실현 range 배수 — 최근 고저 폭의 합리적 상한 */
const REALIZED_RANGE_MULT = 1.6;
const REALIZED_LOOKBACK = 90;

/**
 * 최근 N봉 고저 기준 반폭 ≈ (max−min)/(2·mid).
 * 표본 부족 시 null.
 */
export function realizedRangeHalfWidth(
  closes: number[],
  lookback = REALIZED_LOOKBACK
): number | null {
  const slice = closes.filter((c) => Number.isFinite(c) && c > 0).slice(-lookback);
  if (slice.length < 5) return null;
  let min = slice[0]!;
  let max = slice[0]!;
  for (const c of slice) {
    if (c < min) min = c;
    if (c > max) max = c;
  }
  const mid = (min + max) / 2;
  if (!(mid > 0)) return null;
  return (max - min) / (2 * mid);
}

/** horizon별 최종 반폭 캡 (절대 상한 ∩ 실현 range 배수) */
export function resolveBandHalfWidthCap(
  horizonDays: number,
  closes?: number[] | null
): number {
  const abs =
    BAND_HALF_WIDTH_ABS_CAPS[horizonDays] ??
    (horizonDays <= 1
      ? 0.1
      : horizonDays <= 5
        ? 0.2
        : horizonDays <= 10
          ? 0.28
          : DEFAULT_ABS_CAP);
  const realized = closes?.length ? realizedRangeHalfWidth(closes) : null;
  if (realized == null || !(realized > 0)) return abs;
  // 실현 폭이 좁으면 절대 캡의 55%까지 조일 수 있음. 넓으면 절대 캡이 천장.
  const soft = Math.max(abs * 0.55, Math.min(abs, realized * REALIZED_RANGE_MULT));
  return soft;
}

/**
 * GBM 밴드용 horizonSigma 상한.
 * low/high = center · exp(±σ) 이므로 σ ≤ ln(1+halfWidth).
 */
export function capHorizonSigma(
  horizonSigma: number,
  horizonDays: number,
  closes?: number[] | null
): number {
  if (!(horizonSigma > 0) || !Number.isFinite(horizonSigma)) return horizonSigma;
  const half = resolveBandHalfWidthCap(horizonDays, closes);
  const maxLn = Math.log(1 + half);
  return Math.min(horizonSigma, maxLn);
}

/** center 기준 low/high 재적용 — 차트·패널 동일 캡 */
export function applyBandWidthCap(input: {
  center: number;
  low: number;
  high: number;
  horizonDays: number;
  closes?: number[] | null;
}): { low: number; high: number; capped: boolean; halfWidthCap: number } {
  const { center, horizonDays, closes } = input;
  const halfWidthCap = resolveBandHalfWidthCap(horizonDays, closes);
  if (!(center > 0)) {
    return {
      low: input.low,
      high: input.high,
      capped: false,
      halfWidthCap,
    };
  }
  const minLow = center * (1 - halfWidthCap);
  const maxHigh = center * (1 + halfWidthCap);
  const low = Math.max(input.low, minLow);
  const high = Math.min(input.high, maxHigh);
  const capped = low > input.low + 1e-9 || high < input.high - 1e-9;
  return { low, high, capped, halfWidthCap };
}

/** 현재가 대비 밴드 폭이 과도한지 (회귀 테스트용) */
export function isBandWidthExcessive(
  price: number,
  low: number,
  high: number,
  horizonDays: number,
  closes?: number[] | null
): boolean {
  if (!(price > 0) || !(low > 0) || !(high > 0)) return false;
  const cap = resolveBandHalfWidthCap(horizonDays, closes);
  // center≈price 가정 — 하한/상한이 캡을 크게 넘으면 과도
  const down = 1 - low / price;
  const up = high / price - 1;
  return down > cap * 1.05 || up > cap * 1.05;
}
