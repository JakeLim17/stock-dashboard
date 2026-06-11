// 헤드라인 단위로 risk vs opportunity 의 어느 쪽이 우세한지 판정.
//   - 같은 헤드라인이 양쪽 사전에 모두 매칭될 때 (예: "관세 우려에도 실적 사상 최대")
//     양방향 가산점이 동시에 매겨져 점수가 부풀어 오르는 결함을 방어한다.
//   - 우세 판정: 양쪽 매칭 키워드의 weight 합산을 비교해 차이가 margin (= 1.5)
//     이상이면 우세 쪽만 반영, 동률·근접이면 양쪽 모두 skip (혼란 시그널).
//
// 사용처
//   - assessNewsRisk        : dominantHeadlineSide(headline) !== "risk" 인 헤드라인은 skip
//   - assessOpportunity     : dominantHeadlineSide(headline) !== "opportunity" 인 헤드라인은 skip
//
// negation
//   - matchRiskKeywords 내부에서 "해소/회복/진정" 등 negation 토큰을 만나면 risk 가산이
//     자동으로 0 이 되어 본 함수 결과는 자연히 "opportunity" 또는 null 로 귀결된다.

import { matchRiskKeywords } from "./keywords";
import { matchOpportunityKeywords } from "./positiveKeywords";

export type HeadlineSide = "risk" | "opportunity" | null;

// margin — risk·opportunity weight 합산 차이가 이 값을 초과해야 dominant 결정.
// 1.5 는 weight 1 짜리 키워드 1~2 개 차이에서 흔들리지 않게 하는 보수적 임계.
export const HEADLINE_SIDE_MARGIN = 1.5;

function sumWeight<T extends { weight: number }>(hits: T[]): number {
  let s = 0;
  for (const h of hits) s += h.weight;
  return s;
}

export function dominantHeadlineSide(headline: string): HeadlineSide {
  const negWeight = sumWeight(matchRiskKeywords(headline));
  const posWeight = sumWeight(matchOpportunityKeywords(headline));

  if (negWeight === 0 && posWeight === 0) return null;
  if (posWeight > negWeight + HEADLINE_SIDE_MARGIN) return "opportunity";
  if (negWeight > posWeight + HEADLINE_SIDE_MARGIN) return "risk";
  // 동률·근접 — 신호가 모호해 양쪽 모두 skip 한다.
  return null;
}
