// 이벤트 기반 리스크 키워드 사전.
// 시장 변수(VIX/환율/나스닥)와 별개로 "트럼프 주둥이·관세·제재·지정학" 같은
// 헤드라인 이벤트를 감지해 외부 리스크 점수로 환산하기 위해 사용한다.
//
// 룰은 단순 export 배열로 두어 주인님이 키워드를 자유롭게 추가/수정할 수 있게 한다.
// 가중치(weight) 기준 — 1: 잡음, 2: 작음, 3: 중간, 4: 큼, 5: 매우 큼.

export type RiskCategory =
  | "관세"
  | "제재"
  | "지정학"
  | "정책"
  | "경기"
  | "실적"
  | "기술이슈";

export interface RiskKeyword {
  pattern: RegExp; // 헤드라인 매칭
  weight: number; // 1~5 (높을수록 큰 영향)
  category: RiskCategory;
  label: string; // UI 표시용 한글 라벨
}

export const RISK_KEYWORDS: RiskKeyword[] = [
  // ── 관세·무역 ─────────────────────────────────────────────
  { pattern: /트럼프.*(관세|무역|중국|반도체)/i, weight: 5, category: "관세", label: "트럼프 무역압박" },
  { pattern: /관세|tariff/i, weight: 4, category: "관세", label: "관세" },
  { pattern: /무역(분쟁|전쟁|보복)/i, weight: 4, category: "관세", label: "무역분쟁" },

  // ── 제재·수출규제 ────────────────────────────────────────
  { pattern: /(수출|반도체).*(제재|규제|통제|금지)/i, weight: 5, category: "제재", label: "수출제재" },
  { pattern: /(EUV|HBM|첨단공정).*(제한|금지|규제)/i, weight: 5, category: "제재", label: "첨단공정 규제" },
  { pattern: /엔비디아.*(중국|수출.*(금지|차단))/i, weight: 4, category: "제재", label: "NVDA 중국 수출규제" },
  { pattern: /(사우디|중동).*(원유|감산|증산)/i, weight: 3, category: "제재", label: "원유 정책" },

  // ── 지정학·전쟁 ──────────────────────────────────────────
  { pattern: /(중동|이스라엘|우크라이나).*(전쟁|확전)/i, weight: 4, category: "지정학", label: "중동/우크라" },
  { pattern: /(대만|북한|러시아|이란).*(긴장|충돌|위기)/i, weight: 4, category: "지정학", label: "지역 긴장" },
  { pattern: /(전쟁|군사|미사일|핵실험|침공)/i, weight: 4, category: "지정학", label: "지정학 충돌" },

  // ── 정책·금리 ────────────────────────────────────────────
  { pattern: /(연준|FOMC|Fed).*(금리.*(인상|동결|인하))/i, weight: 3, category: "정책", label: "연준 금리" },
  { pattern: /(금리).*(급등|인상.*우려)/i, weight: 3, category: "정책", label: "금리 인상" },

  // ── 경기 ─────────────────────────────────────────────────
  { pattern: /(경기.*(침체|둔화|위축)|recession)/i, weight: 3, category: "경기", label: "경기침체" },
  { pattern: /(인플레이션|물가.*급등)/i, weight: 2, category: "경기", label: "인플레" },

  // ── 실적·기술 이슈 ──────────────────────────────────────
  { pattern: /(어닝쇼크|실적쇼크|미스)/i, weight: 4, category: "실적", label: "실적쇼크" },
  { pattern: /(리콜|결함|화재|소송)/i, weight: 3, category: "기술이슈", label: "품질이슈" },
];

// 헤드라인 1개를 받아 매칭된 키워드를 전부 반환한다.
// 동일 라벨이 여러 번 잡히지 않도록 라벨 기준으로 dedupe.
export function matchRiskKeywords(headline: string): RiskKeyword[] {
  const hits: RiskKeyword[] = [];
  const seen = new Set<string>();
  for (const kw of RISK_KEYWORDS) {
    if (kw.pattern.test(headline) && !seen.has(kw.label)) {
      hits.push(kw);
      seen.add(kw.label);
    }
  }
  return hits;
}
