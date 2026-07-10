// 뉴스 리스크 → 변동성(σ) 확대 신호.
//
// riskScore.ts 의 NewsRiskAssessment 를 입력으로 받아, 지정학성 카테고리
// (지정학·관세·제재)가 주도하는 리스크일 때 예측 변동성 밴드를 넓히는
// 곱계수(factor)를 산출한다. drift(방향)는 fair-value-macro 의
// "지정학·이벤트/호재 뉴스" 보정이 담당하므로 여기서는 σ 만 다룬다
// (이중 반영 방지).
//
//   factor 상한 1.25 — 이벤트 σ 부풀림(eventVolatility)과 곱해져도
//   과도한 밴드 폭이 되지 않게 보수적으로 잡는다.
//
// 클라이언트/서버 양쪽에서 import 가능 (server-only 없음) — 단위 테스트 용이.

import type { NewsRiskAssessment } from "../types";

/** 변동성 확대로 취급하는 지정학성 카테고리 */
const GEO_CATEGORIES = new Set(["지정학", "관세", "제재"]);

const GEO_FACTOR_CAP = 1.25; // 지정학 주도 리스크 상한
const GENERAL_FACTOR_CAP = 1.12; // 일반(실적·경기 등) 리스크 상한
const MIN_SCORE = 30; // medium 미만이면 확대 없음

export interface NewsVolatilitySignal {
  /** σ 곱계수 (1.0 = 영향 없음) */
  factor: number;
  /** 입력 리스크 점수 (0~100) */
  score: number;
  /** 지정학성 드라이버 주도 여부 */
  geoDriven: boolean;
  /** UI 칩 라벨 — 확대 없으면 null */
  label: string | null;
  /** 가장 기여 큰 드라이버 라벨 (툴팁용) */
  topDriver: string | null;
}

export function computeNewsVolatility(
  risk: NewsRiskAssessment | null | undefined
): NewsVolatilitySignal {
  const none: NewsVolatilitySignal = {
    factor: 1,
    score: risk?.score ?? 0,
    geoDriven: false,
    label: null,
    topDriver: null,
  };
  if (!risk || risk.score < MIN_SCORE || risk.drivers.length === 0) {
    return none;
  }

  const geoDrivers = risk.drivers.filter((d) => GEO_CATEGORIES.has(d.category));
  const geoDriven = geoDrivers.length > 0;
  const topDriver = (geoDriven ? geoDrivers : risk.drivers)[0]?.label ?? null;

  // score 30→+6%, 60→+12%, 100→+20% (지정학) / 절반 수준 (일반), 상한 별도.
  const scale = geoDriven ? 0.2 : 0.1;
  const cap = geoDriven ? GEO_FACTOR_CAP : GENERAL_FACTOR_CAP;
  const factor = Math.min(cap, 1 + (risk.score / 100) * scale);

  const label = geoDriven
    ? "지정학 리스크 ↑ 변동성 확대"
    : "뉴스 리스크 ↑ 변동성 확대";

  return { factor, score: risk.score, geoDriven, label, topDriver };
}
