// 미장(나스닥 IXIC) lag drift 헬퍼 — predictor 의 1일 drift 파이프라인에 합산.
//
// 원리: 종목 일별 수익률을 ^IXIC 에 회귀한 β(60일 OLS, macroBeta.ts)와
// 가장 최근 IXIC 수익률(lag-0 신호)을 곱해 기대 drift 를 만든다.
//   - 한국 종목: 간밤 미국장 마감 변동(ΔT-1)이 오늘 한국장의 lag-0 신호.
//   - 미국 종목: look-ahead 방지를 위해 predictor 쪽에서 시계열을 한 칸
//     앞으로 슬라이스한 lastReturn 이 들어온다.
// R² 가중(min(1, r2+0.2))으로 설명력 낮은 회귀의 영향을 줄이고,
// 상한 ±0.8% — sectorLeading·macroFactors 와 합산 후 전체 cap(±2~3%)이
// 다시 적용되므로 단일 신호의 과대 반영을 방지한다.
//
// server-only 를 두지 않는다 — 순수 함수라 단위 테스트에서 직접 검증.

const US_MARKET_DRIFT_CAP = 0.008;

export function usMarketDrift(
  beta: number | null | undefined,
  r2: number | null | undefined,
  marketLastReturn: number | null | undefined
): number {
  if (
    beta == null ||
    r2 == null ||
    marketLastReturn == null ||
    !Number.isFinite(beta) ||
    !Number.isFinite(r2) ||
    !Number.isFinite(marketLastReturn)
  ) {
    return 0;
  }
  const weight = Math.min(1, Math.max(0, r2) + 0.2);
  const raw = beta * marketLastReturn * weight;
  return Math.max(-US_MARKET_DRIFT_CAP, Math.min(US_MARKET_DRIFT_CAP, raw));
}
