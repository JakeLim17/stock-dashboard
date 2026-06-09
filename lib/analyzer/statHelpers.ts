// 확률 통계 헬퍼 — 예측기에서 σ·분위수 계산에 사용.
//
// 1. EWMA 변동성 (RiskMetrics 표준 λ=0.94)
//    σ²_t = λ · σ²_{t-1} + (1 - λ) · r²_{t-1}
//    최근 데이터에 더 큰 가중치를 줘 단순 stddev보다 최근 변동성을 빠르게 반영.
//    초기 σ²_0 는 처음 30일의 표본 분산으로 워밍업.
//
// 2. t-분포 quantile (자유도 df 기본 5)
//    일간 주식 수익률은 정규분포보다 꼬리가 두꺼움(fat-tail). t(5)는 보수적으로
//    꼬리를 두껍게 반영. 95% 양측 신뢰구간 (p=0.975) ≈ ±2.571σ (정규: ±1.960σ).
//    표 lookup + 가장 가까운 df 행 사용 — 외부 의존성 없는 가벼운 구현.

export function ewmaVolatility(returns: number[], lambda = 0.94): number {
  if (returns.length < 2) return 0;
  // 워밍업이 너무 짧으면 EWMA가 초기치에 과도하게 의존 → 짧은 표본은 단순 stddev 폴백.
  if (returns.length < 30) {
    const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
    const v =
      returns.reduce((acc, x) => acc + (x - mu) ** 2, 0) /
      (returns.length - 1);
    return Math.sqrt(v);
  }

  const warmupSize = 30;
  const warmup = returns.slice(0, warmupSize);
  const mu0 = warmup.reduce((a, b) => a + b, 0) / warmup.length;
  let variance =
    warmup.reduce((acc, x) => acc + (x - mu0) ** 2, 0) / warmup.length;

  for (let i = warmupSize; i < returns.length; i++) {
    const r = returns[i];
    variance = lambda * variance + (1 - lambda) * r * r;
  }
  return Math.sqrt(Math.max(variance, 0));
}

// t-분포 quantile 표(보수적으로 자주 쓰는 confidence + df만 수록).
// 행: df, 열: 누적확률 p (=양측 신뢰구간 (1 - 2(1-p)) 의 한쪽).
// 예) df=5, p=0.975 → 양측 95% 신뢰구간의 ±quantile = 2.571.
const T_TABLE: Record<number, Record<string, number>> = {
  5: { "0.90": 1.476, "0.95": 2.015, "0.975": 2.571, "0.99": 3.365, "0.995": 4.032 },
  10: { "0.90": 1.372, "0.95": 1.812, "0.975": 2.228, "0.99": 2.764, "0.995": 3.169 },
  20: { "0.90": 1.325, "0.95": 1.725, "0.975": 2.086, "0.99": 2.528, "0.995": 2.845 },
  30: { "0.90": 1.310, "0.95": 1.697, "0.975": 2.042, "0.99": 2.457, "0.995": 2.750 },
  // df=∞ ≒ 표준정규
  9999: { "0.90": 1.282, "0.95": 1.645, "0.975": 1.960, "0.99": 2.326, "0.995": 2.576 },
};

function nearestKey(target: number, keys: number[]): number {
  let best = keys[0];
  let bestDist = Math.abs(target - best);
  for (const k of keys) {
    const d = Math.abs(target - k);
    if (d < bestDist) {
      best = k;
      bestDist = d;
    }
  }
  return best;
}

// 양측 신뢰구간의 한쪽 분위수 z 를 반환. (p=0.975 이면 ±2.571 의 2.571)
// df 가 표에 정확히 없으면 가장 가까운 행을 사용 (선형 보간 X — 단순화).
// p 가 표에 정확히 없으면 가장 가까운 열 사용.
export function tDistQuantile(p: number, df = 5): number {
  const dfKeys = Object.keys(T_TABLE).map(Number);
  const nearestDf = nearestKey(df, dfKeys);
  const row = T_TABLE[nearestDf];
  const pKeys = Object.keys(row).map(Number);
  const nearestP = nearestKey(p, pKeys);
  // Number→String 변환은 trailing zero를 제거하므로 표 키와 그대로 매칭됨 (예: 0.95 → "0.95").
  return row[String(nearestP)] ?? row["0.975"];
}
