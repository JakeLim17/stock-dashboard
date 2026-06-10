import "server-only";
import type { SymbolMeta } from "../types";
import type { ScenarioRow } from "../types";

// 달러/금리 영향 매크로 팩터 — 종목 메타 분류 기반의 시나리오 row 생성.
//
// 분류 휴리스틱:
//   수출주 (KR-export):       반도체·자동차·조선·디스플레이·화학·신재생·식음료(K-Food)
//                            → DXY ↑ 시 부정적 (원화 약세는 단기 호재이나 글로벌 사이클 둔화 우세)
//                            → US10Y ↑ 시 신중 (성장주 상관 강함)
//   내수주 (KR-domestic):     금융·통신·유통·여행레저·건설·식음료(국내)·게임(국내 매출 비중↑)
//                            → DXY 영향 미미, US10Y ↑ 시 금융주만 우호
//   미국 성장주 (US-growth):  글로벌IT·글로벌반도체·글로벌소프트웨어·글로벌AI·글로벌AI인프라
//                            → DXY ↑ 시 약한 부정 (글로벌 위험회피)
//                            → US10Y ↑ 시 강한 부정 (할인율↑)
//   미국 가치주 (US-value):   글로벌소비재·글로벌헬스케어·글로벌핀테크·글로벌에너지
//                            → DXY 중립
//                            → US10Y ↑ 시 신중하나 영향 작음 (캐시플로우 안정)
//
// 출력은 scenarios 배열에 추가할 ScenarioRow[]. 회귀 베타가 없으므로 r2 는 비우고
// label 에 "추정 영향" 명시. 사용자에게 "수출주 → DXY 부담" 이라는 인사이트 직관 제공.

type FactorCategory =
  | "kr-export"
  | "kr-domestic"
  | "us-growth"
  | "us-value"
  | "neutral";

const KR_EXPORT_SECTORS = new Set([
  "반도체",
  "반도체장비",
  "반도체소재",
  "자동차",
  "조선",
  "디스플레이",
  "화학",
  "신재생",
  "철강소재",
  "식음료",
  "IT가전",
  "배터리",
]);

const KR_DOMESTIC_SECTORS = new Set([
  "금융",
  "통신",
  "유통",
  "유통종합",
  "여행레저",
  "건설",
  "원전전력",
  "물류",
  "콘텐츠",
  "엔터",
  "화장품",
  "바이오",
  "방산",
  "항공",
  "의료미용",
  "수소",
  "AI소프트웨어",
  "인터넷",
  "게임",
  "로봇",
  "전선",
]);

const US_GROWTH_SECTORS = new Set([
  "글로벌IT",
  "글로벌반도체",
  "글로벌소프트웨어",
  "글로벌AI",
  "글로벌AI인프라",
  "글로벌암호화폐",
  "글로벌EV",
  "중국ADR",
]);

const US_VALUE_SECTORS = new Set([
  "글로벌소비재",
  "글로벌헬스케어",
  "글로벌핀테크",
  "글로벌에너지",
]);

function classify(meta: SymbolMeta | null | undefined): FactorCategory {
  if (!meta?.sector) return "neutral";
  const s = meta.sector;
  if (US_GROWTH_SECTORS.has(s)) return "us-growth";
  if (US_VALUE_SECTORS.has(s)) return "us-value";
  if (KR_EXPORT_SECTORS.has(s)) return "kr-export";
  if (KR_DOMESTIC_SECTORS.has(s)) return "kr-domestic";
  return "neutral";
}

export interface MacroFactorScenarios {
  category: FactorCategory;
  scenarios: ScenarioRow[];
  // 1일 drift 보정 (DXY/US10Y 의 lag-0 신호 × 카테고리별 민감도). 한도 ±1%.
  drift: number;
  reasons: string[];
}

// 휴리스틱 베타 매트릭스 — 카테고리 × 매크로 변수.
// (값은 시장 통념 기반 보수적 추정. 회귀가 아니므로 R² 비움.)
const HEURISTIC_BETAS: Record<
  FactorCategory,
  { dxy: number; us10y: number }
> = {
  "kr-export": { dxy: -0.4, us10y: -0.25 },
  "kr-domestic": { dxy: -0.05, us10y: -0.05 },
  "us-growth": { dxy: -0.3, us10y: -0.45 },
  "us-value": { dxy: 0, us10y: -0.1 },
  neutral: { dxy: -0.1, us10y: -0.1 },
};

// dxyLastReturn / us10yLastReturn 는 매크로 변수의 가장 최근 수익률(소수, 0.005 = +0.5%).
// 비어있으면 0 으로 가정 (drift=0).
export function computeMacroFactors(
  meta: SymbolMeta | null | undefined,
  dxyLastReturn: number | null | undefined,
  us10yLastReturn: number | null | undefined
): MacroFactorScenarios {
  const category = classify(meta);
  const heur = HEURISTIC_BETAS[category];

  const scenarios: ScenarioRow[] = [];

  // DXY +1% 시나리오
  scenarios.push({
    label: "DXY +1% (달러 강세)",
    expected: heur.dxy * 0.01,
    beta: heur.dxy,
    baselineLabel: `${categoryLabel(category)} · 추정`,
    confidence: "low",
  });

  // US10Y +10bp(=금리 +0.10pt) 의 영향. ^TNX value 가 % 단위라 1% 가 +1pt = 100bp.
  // 시장 관행상 "+10bp" 로 표현. 베타 단위는 "1% 변화당" 이므로 ×0.001 (10bp = 0.1pt = 0.1% 시점 변화)
  scenarios.push({
    label: "미 10년물 +10bp",
    expected: heur.us10y * 0.001,
    beta: heur.us10y,
    baselineLabel: `${categoryLabel(category)} · 추정`,
    confidence: "low",
  });

  // 1일 drift 보정 — 가장 최근 매크로 변동이 종목에 lag-0 으로 유입.
  const dxyR = dxyLastReturn ?? 0;
  const us10yR = us10yLastReturn ?? 0;
  const driftRaw = heur.dxy * dxyR + heur.us10y * us10yR;
  const drift = Math.max(-0.01, Math.min(0.01, driftRaw));

  const reasons: string[] = [];
  if (Math.abs(dxyR) >= 0.002) {
    reasons.push(
      `DXY ${(dxyR * 100).toFixed(2)}% × β ${heur.dxy.toFixed(2)} = ${(heur.dxy * dxyR * 100).toFixed(2)}%`
    );
  }
  if (Math.abs(us10yR) >= 0.005) {
    reasons.push(
      `US10Y ${(us10yR * 100).toFixed(2)}% × β ${heur.us10y.toFixed(2)} = ${(heur.us10y * us10yR * 100).toFixed(2)}%`
    );
  }

  return { category, scenarios, drift, reasons };
}

function categoryLabel(c: FactorCategory): string {
  switch (c) {
    case "kr-export":
      return "한국 수출주";
    case "kr-domestic":
      return "한국 내수주";
    case "us-growth":
      return "미국 성장주";
    case "us-value":
      return "미국 가치주";
    default:
      return "분류 미지정";
  }
}
