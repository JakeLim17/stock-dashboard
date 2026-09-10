/**
 * 고전 피봇 지지·저항 — 야선지지·코스피랩이 쓰는 전일 H/L/C 기준.
 * 20일 고저보다 현재가에 가까워 단기 예측에 맞다.
 */

export interface PivotLevels {
  pivot: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
}

export type SupportSource = "pivot" | "20d";

export interface NearSupportResistance {
  support: number;
  resistance: number;
  source: SupportSource;
  pivot: PivotLevels | null;
}

export function classicPivotLevels(
  high: number,
  low: number,
  close: number
): PivotLevels | null {
  if (!(high > 0) || !(low > 0) || !(close > 0)) return null;
  if (high < low) return null;
  const pivot = (high + low + close) / 3;
  const range = high - low;
  if (!(pivot > 0) || !Number.isFinite(range)) return null;
  return {
    pivot,
    r1: 2 * pivot - low,
    s1: 2 * pivot - high,
    r2: pivot + range,
    s2: pivot - range,
  };
}

/** 현재가 바로 아래 = 지지, 바로 위 = 저항 */
export function nearestPivotBand(
  price: number,
  levels: PivotLevels
): { support: number; resistance: number } {
  const ordered = [levels.s2, levels.s1, levels.pivot, levels.r1, levels.r2]
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  const below = ordered.filter((v) => v < price * 0.999);
  const above = ordered.filter((v) => v > price * 1.001);
  return {
    support: below.length > 0 ? below[below.length - 1]! : levels.s2,
    resistance: above.length > 0 ? above[0]! : levels.r2,
  };
}

export function resolveSupportResistance(input: {
  price: number;
  lastHigh?: number | null;
  lastLow?: number | null;
  lastClose?: number | null;
  range20Low?: number | null;
  range20High?: number | null;
}): NearSupportResistance | null {
  const { price } = input;
  if (!(price > 0)) return null;

  const pivot = classicPivotLevels(
    input.lastHigh ?? 0,
    input.lastLow ?? 0,
    input.lastClose ?? 0
  );
  if (pivot) {
    const band = nearestPivotBand(price, pivot);
    if (band.support > 0 && band.resistance > band.support) {
      return {
        support: band.support,
        resistance: band.resistance,
        source: "pivot",
        pivot,
      };
    }
  }

  const lo = input.range20Low;
  const hi = input.range20High;
  if (lo != null && hi != null && lo > 0 && hi > lo) {
    return {
      support: lo,
      resistance: hi,
      source: "20d",
      pivot: null,
    };
  }
  return null;
}
