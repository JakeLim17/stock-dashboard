import "server-only";

// VIX 게이팅 — 매크로 risk-off 환경에서 신뢰도/SL 폭을 자동 조정.
//
// 휴리스틱 (시장 통념과 RiskMetrics 권고를 절충):
//   VIX < 20      → 평상 (배수 1.0)
//   20 ≤ VIX < 25 → 약한 risk-off (confidence ×0.9, SL 폭 ×1.10)
//   25 ≤ VIX < 30 → 중간 risk-off (confidence ×0.8, SL 폭 ×1.20)
//   VIX ≥ 30      → 강한 risk-off (confidence ×0.6, SL 폭 ×1.35)
//
// 근거: Larsen & Doolittle 2011 등 — VIX 25↑ 구간에서 95% VaR 백테스트 위반율이 정상치
// 대비 1.4~1.6배 늘어나는 경향. 단순 곱연산이라 보수적이고 모델 의존성 적음.
// VIX 가 정의되지 않으면(데이터 빈자리) 평상 배수 유지.

export interface VixGate {
  confidenceMult: number; // 모델 신뢰도 곱연산 인자
  stopLossMult: number; // SL 폭 곱연산 인자 (>1 이면 손절 더 멀리)
  rangeSigmaMult: number; // 가격 범위 σ 곱연산 (>1 이면 밴드 확대)
  level: "calm" | "elevated" | "stressed" | "panic";
  vix: number | null;
  reason: string; // 사람이 읽는 사유
}

export function computeVixGate(vix: number | null | undefined): VixGate {
  if (vix == null || !Number.isFinite(vix) || vix <= 0) {
    return {
      confidenceMult: 1,
      stopLossMult: 1,
      rangeSigmaMult: 1,
      level: "calm",
      vix: null,
      reason: "VIX 데이터 없음 — 게이팅 미적용",
    };
  }

  if (vix < 20) {
    return {
      confidenceMult: 1,
      stopLossMult: 1,
      rangeSigmaMult: 1,
      level: "calm",
      vix,
      reason: `VIX ${vix.toFixed(1)} — 평상`,
    };
  }
  if (vix < 25) {
    return {
      confidenceMult: 0.9,
      stopLossMult: 1.1,
      rangeSigmaMult: 1.08,
      level: "elevated",
      vix,
      reason: `VIX ${vix.toFixed(1)} — 변동성 상승 · 신뢰도 ×0.9 / SL ×1.1 / 범위 ×1.08`,
    };
  }
  if (vix < 30) {
    return {
      confidenceMult: 0.8,
      stopLossMult: 1.2,
      rangeSigmaMult: 1.15,
      level: "stressed",
      vix,
      reason: `VIX ${vix.toFixed(1)} — 위험 회피 · 신뢰도 ×0.8 / SL ×1.2 / 범위 ×1.15`,
    };
  }
  return {
    confidenceMult: 0.6,
    stopLossMult: 1.35,
    rangeSigmaMult: 1.25,
    level: "panic",
    vix,
    reason: `VIX ${vix.toFixed(1)} — 패닉 · 신뢰도 ×0.6 / SL ×1.35 / 범위 ×1.25`,
  };
}
