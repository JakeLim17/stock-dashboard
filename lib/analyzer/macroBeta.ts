import "server-only";
import type { HistoricalPoint } from "../providers/yahoo";

// 매크로 베타 회귀 (단순 OLS).
//   R_s_t = α + β · R_m_t + ε_t
//   β = Cov(R_s, R_m) / Var(R_m)
//   R² = 1 - SS_res / SS_tot
// 한·미 휴장일이 다르므로 단순 tail join 시 인덱스가 어긋난다 → YYYY-MM-DD 키로 inner join.
// 표본 수(useDays) 60일을 기본값으로 한다 (RiskMetrics·증권사 리포트 관행).

export interface MacroBetaResult {
  beta: number;
  r2: number;
  residStd: number; // 잔차 표준편차 (드리프트 신뢰도 가중에 사용)
  samples: number;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function alignedReturns(
  stockHist: HistoricalPoint[],
  marketHist: HistoricalPoint[]
): { s: number[]; m: number[] } {
  const mMap = new Map<string, number>();
  for (const p of marketHist) {
    if (Number.isFinite(p.close) && p.close > 0) {
      mMap.set(dayKey(p.date), p.close);
    }
  }
  const aligned: { date: number; s: number; m: number }[] = [];
  for (const p of stockHist) {
    if (!Number.isFinite(p.close) || p.close <= 0) continue;
    const m = mMap.get(dayKey(p.date));
    if (m == null) continue;
    aligned.push({ date: p.date, s: p.close, m });
  }
  aligned.sort((a, b) => a.date - b.date);

  const sRet: number[] = [];
  const mRet: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const ps = aligned[i - 1].s;
    const cs = aligned[i].s;
    const pm = aligned[i - 1].m;
    const cm = aligned[i].m;
    if (ps > 0 && pm > 0) {
      sRet.push((cs - ps) / ps);
      mRet.push((cm - pm) / pm);
    }
  }
  return { s: sRet, m: mRet };
}

// 단순 OLS 회귀 — 표본 수가 minSamples 미만이면 null 반환(데이터 부족 폴백).
export function estimateBeta(
  stockHist: HistoricalPoint[] | null | undefined,
  macroHist: HistoricalPoint[] | null | undefined,
  useDays = 60,
  minSamples = 30
): MacroBetaResult | null {
  if (!stockHist || !macroHist) return null;
  if (stockHist.length < 5 || macroHist.length < 5) return null;

  const aligned = alignedReturns(stockHist, macroHist);
  const n = Math.min(aligned.s.length, aligned.m.length);
  if (n < minSamples) return null;

  // tail useDays 만 사용 (최근 매크로 환경 반영).
  const sRet = aligned.s.slice(-useDays);
  const mRet = aligned.m.slice(-useDays);
  const samples = sRet.length;
  if (samples < minSamples) return null;

  const meanS = sRet.reduce((a, b) => a + b, 0) / samples;
  const meanM = mRet.reduce((a, b) => a + b, 0) / samples;

  let cov = 0;
  let varM = 0;
  let varS = 0;
  for (let i = 0; i < samples; i++) {
    const dS = sRet[i] - meanS;
    const dM = mRet[i] - meanM;
    cov += dS * dM;
    varM += dM * dM;
    varS += dS * dS;
  }
  cov /= samples - 1;
  varM /= samples - 1;
  varS /= samples - 1;
  if (varM <= 0 || varS <= 0) return null;

  const beta = cov / varM;
  const corr = cov / Math.sqrt(varM * varS);
  const r2 = Math.max(0, Math.min(1, corr * corr));

  // 잔차표준편차 — 회귀선에서 벗어난 평균 진폭. drift 가중에 사용.
  let ss = 0;
  for (let i = 0; i < samples; i++) {
    const pred = beta * (mRet[i] - meanM) + meanS;
    const resid = sRet[i] - pred;
    ss += resid * resid;
  }
  const residStd = Math.sqrt(ss / Math.max(1, samples - 2));

  return { beta, r2, residStd, samples };
}

// 매크로 시계열의 직전 1일 수익률 — drift 추정용 lag-0 신호.
// 한국 종목 입장에서 미국 시장의 ΔT-1(전일) 변동은 오늘의 lag-0 신호로 작용.
export function lastReturn(hist: HistoricalPoint[] | null | undefined): number {
  if (!hist || hist.length < 2) return 0;
  const last = hist[hist.length - 1];
  const prev = hist[hist.length - 2];
  if (!Number.isFinite(last.close) || !Number.isFinite(prev.close)) return 0;
  if (prev.close <= 0) return 0;
  return (last.close - prev.close) / prev.close;
}
