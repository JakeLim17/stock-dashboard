// 장중 1분봉 OHLCV로부터 사팔사팔(intraday volatility) 지표를 계산한다.
//
// 지표
//   - parkinsonVol      : Parkinson estimator. σ_P = sqrt((1/(4·ln2)) · Σ ln(H/L)² / n)
//                         일별 close-to-close σ보다 장중 진폭을 더 잘 잡는다.
//   - reversalRate      : 1분봉 단순 수익률 부호 뒤집힘 / 총 봉 수. 0.5 ≈ "사팔사팔" 절정.
//   - buyPressureRatio  : 양봉 (volume × |return|) 합 / 전체 (volume × |return|) 합.
//                         체결 강도 proxy — 0.5 중립, > 0.5 매수 우세, < 0.5 매도 우세.
//   - barCount          : 사용된 1분봉 수 (필터링 후)
//
// 모든 값은 finite. 계산 불가능하면 0/0.5 반환 (호출 측에서 분기하기 쉽게).

import type { IntradayBar } from "../providers/naverIntraday";

export interface IntradayMetrics {
  parkinsonVol: number;       // 1분 단위 표준편차 추정치 (소수)
  // ⚠️ 정확히는 "장 시작부터 현재까지(session-to-date) 누적 Parkinson σ" 다.
  //   parkinsonVol × √(받은 분봉 수) 라 받은 분봉이 늘어날수록 값이 단조 증가한다.
  //   - 09:30 (60분 봉)  → σ_1m · √60
  //   - 14:30 (300분 봉) → σ_1m · √300
  //   즉, 같은 종목·같은 변동성이라도 10시 vs 15시에 값이 약 2.24배 차이.
  //   풀세션(정규장 ≈ 390분) 정규화가 아니므로 volatilityScore.ts 의 임계값
  //   (0.05/0.03/0.02)은 "장 종료에 가까울수록 hit 하기 쉬움" → 장 초반에는
  //   사팔사팔이 underestimate, 장 후반에는 overestimate 되는 경향이 있다.
  //   호환성 위해 시멘틱은 유지(snapshot.ts 등 외부 참조 다수). 향후 일관성
  //   정정 시: ① 이름을 parkinsonSessionToDate 로 rename + ② volatilityScore 임계값
  //   을 풀세션 정규화 기준으로 재조정 — 한 PR 로 같이 처리해야 회귀 방지.
  parkinsonDaily: number;
  reversalRate: number;       // 0~1
  buyPressureRatio: number;   // 0~1
  // 1분봉 absolute return 평균 — UI에 ±x% 형태로도 노출 가능
  meanAbsReturn: number;
  barCount: number;
}

const EMPTY: IntradayMetrics = {
  parkinsonVol: 0,
  parkinsonDaily: 0,
  reversalRate: 0,
  buyPressureRatio: 0.5,
  meanAbsReturn: 0,
  barCount: 0,
};

export function computeIntradayMetrics(bars: IntradayBar[]): IntradayMetrics {
  if (!bars || bars.length < 5) return EMPTY;

  // Parkinson — H/L 비율의 로그 제곱 평균에 (1/(4·ln2)) 가중.
  // 분봉의 high/low가 0이거나 비정상이면 스킵.
  const ln2x4 = 4 * Math.LN2;
  let pSum = 0;
  let pN = 0;
  for (const b of bars) {
    if (!Number.isFinite(b.high) || !Number.isFinite(b.low)) continue;
    if (b.high <= 0 || b.low <= 0 || b.high < b.low) continue;
    const ratio = b.high / b.low;
    if (ratio <= 1) continue;
    const lnHL = Math.log(ratio);
    pSum += (lnHL * lnHL) / ln2x4;
    pN += 1;
  }
  const parkinsonVar = pN > 0 ? pSum / pN : 0;
  const parkinsonVol = parkinsonVar > 0 ? Math.sqrt(parkinsonVar) : 0;
  // ⚠️ "1일 환산"이라기보단 "장 시작 → 현재까지 누적 σ" (session-to-date).
  //   √(받은 분봉 수) 라서 시간이 갈수록 단조 증가한다 (정규화 없음).
  //   필드명 호환성을 위해 parkinsonDaily 유지 — 상세는 IntradayMetrics 인터페이스 주석 참조.
  //   풀세션 정규화 (× √(390 / pN)) 로 바꾸면 호출부 임계값(volatilityScore.ts:216~)도
  //   같이 조정해야 회귀가 안 남는다.
  const parkinsonDaily = parkinsonVol * Math.sqrt(Math.max(pN, 1));

  // 1분 close-to-close 단순 수익률
  const returns: number[] = [];
  const absReturns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const cur = bars[i].close;
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
      const r = (cur - prev) / prev;
      if (Number.isFinite(r)) {
        returns.push(r);
        absReturns.push(Math.abs(r));
      }
    }
  }

  // 부호 뒤집힘 빈도 (0이 연속이면 카운트하지 않음)
  let reversals = 0;
  let comparable = 0;
  for (let i = 1; i < returns.length; i++) {
    const a = returns[i - 1];
    const b = returns[i];
    if (a === 0 || b === 0) continue;
    comparable += 1;
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) reversals += 1;
  }
  const reversalRate = comparable > 0 ? reversals / comparable : 0;

  // 체결 강도 proxy — volume × |return| 을 양/음 분리 합산해 비율 산출.
  let buyP = 0;
  let totalP = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const cur = bars[i].close;
    if (prev <= 0 || !Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    const r = (cur - prev) / prev;
    const v = Math.max(0, Number.isFinite(bars[i].volume) ? bars[i].volume : 0);
    const w = v * Math.abs(r);
    if (w === 0) continue;
    totalP += w;
    if (r > 0) buyP += w;
  }
  const buyPressureRatio = totalP > 0 ? buyP / totalP : 0.5;

  const meanAbsReturn =
    absReturns.length > 0
      ? absReturns.reduce((a, b) => a + b, 0) / absReturns.length
      : 0;

  return {
    parkinsonVol,
    parkinsonDaily,
    reversalRate,
    buyPressureRatio,
    meanAbsReturn,
    barCount: bars.length,
  };
}
