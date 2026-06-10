// 호재 키워드 사전 — RISK_KEYWORDS 와 완전 대칭 구조.
// 수주·실적·목표가 상향·신제품·시장 점유율·정책 호재·M&A 등.
//
// 가중치(weight) 기준 — 1: 잡음/소형, 2: 작음, 3: 중간, 4: 큼, 5: 매우 큼.
// 호재는 risk보다 weight를 더 보수적으로(평균 ~2~3) 잡는다.
//   - 헤드라인 펌프(부풀림) 위험이 크고
//   - 한국 뉴스 헤드라인이 "역대 최대" 같은 상투어를 남용해 점수 폭증 우려.
// verdict shift에는 안전장치 부족으로 적용하지 않고 (UI 노출 + reasons에만),
// 추후 더 안정적인 정밀도가 확인되면 weight를 조정한다.

export type OpportunityCategory =
  | "수주/계약"
  | "실적호조"
  | "목표가 상향"
  | "신제품/기술"
  | "시장점유율"
  | "정책호재"
  | "M&A";

export interface OpportunityKeyword {
  pattern: RegExp;
  weight: number;
  category: OpportunityCategory;
  label: string;
}

export const POSITIVE_KEYWORDS: OpportunityKeyword[] = [
  // ── 수주·계약 ─────────────────────────────────────────────
  {
    pattern: /(\d+조|\d+억)\s*(원)?\s*(규모)?\s*(수주|공급계약|계약)/i,
    weight: 5,
    category: "수주/계약",
    label: "대형 수주",
  },
  {
    pattern: /(독점공급|독점\s*공급|독점\s*계약)/i,
    weight: 4,
    category: "수주/계약",
    label: "독점공급",
  },
  {
    pattern: /(장기\s*계약|장기공급|장기수주)/i,
    weight: 3,
    category: "수주/계약",
    label: "장기계약",
  },
  {
    pattern: /(MOU\s*체결|업무협약\s*체결|전략적\s*제휴)/i,
    weight: 2,
    category: "수주/계약",
    label: "MOU/제휴",
  },
  {
    pattern: /(수주|공급계약)/i,
    weight: 3,
    category: "수주/계약",
    label: "수주",
  },

  // ── 실적 호조 ────────────────────────────────────────────
  {
    pattern: /(어닝\s*서프라이즈|실적\s*서프라이즈|어닝서프라이즈)/i,
    weight: 5,
    category: "실적호조",
    label: "어닝서프라이즈",
  },
  {
    pattern: /(사상\s*최대|역대\s*최대|사상\s*최고|역대\s*최고|사상\s*첫)/i,
    weight: 4,
    category: "실적호조",
    label: "사상 최대",
  },
  {
    pattern: /(흑자\s*전환|흑자전환)/i,
    weight: 4,
    category: "실적호조",
    label: "흑자전환",
  },
  {
    pattern: /(영업이익).*?(\+?\d+(?:\.\d+)?%|증가|급증)/i,
    weight: 3,
    category: "실적호조",
    label: "영업이익 증가",
  },
  {
    pattern: /(매출).*?(증가|급증|호조|사상)/i,
    weight: 2,
    category: "실적호조",
    label: "매출 호조",
  },
  {
    pattern: /(beat|earnings beat|record (high|quarter|profit))/i,
    weight: 4,
    category: "실적호조",
    label: "실적 beat",
  },

  // ── 목표가 상향·투자의견 상향 ────────────────────────────
  {
    pattern: /(목표가|목표주가).*?(상향|올려|상향\s*조정)/i,
    weight: 4,
    category: "목표가 상향",
    label: "목표가 상향",
  },
  {
    pattern: /(투자의견|투자\s*의견).*?(상향|매수|Buy로)/i,
    weight: 4,
    category: "목표가 상향",
    label: "투자의견 상향",
  },
  {
    pattern: /(매수.*상향|Buy.*upgrade|upgrade.*Buy)/i,
    weight: 3,
    category: "목표가 상향",
    label: "매수 상향",
  },

  // ── 신제품·기술·양산 ────────────────────────────────────
  {
    pattern: /(세계\s*최초|최초\s*공급|세계최초)/i,
    weight: 4,
    category: "신제품/기술",
    label: "세계 최초",
  },
  {
    pattern: /(양산\s*돌입|양산\s*개시|본격\s*양산)/i,
    weight: 3,
    category: "신제품/기술",
    label: "양산",
  },
  {
    pattern: /(신제품|신모델).*?(출시|공개|발표)/i,
    weight: 2,
    category: "신제품/기술",
    label: "신제품 출시",
  },
  {
    pattern: /(독자\s*개발|독자기술|자체\s*개발).*?(성공|완료)/i,
    weight: 3,
    category: "신제품/기술",
    label: "독자 개발",
  },
  {
    pattern: /(특허\s*등록|특허\s*획득|핵심\s*특허)/i,
    weight: 2,
    category: "신제품/기술",
    label: "특허",
  },

  // ── 시장 점유율·1위 ─────────────────────────────────────
  {
    pattern: /(글로벌\s*1위|세계\s*1위|시장\s*점유율\s*1위|1위\s*등극)/i,
    weight: 4,
    category: "시장점유율",
    label: "글로벌 1위",
  },
  {
    pattern: /(점유율\s*확대|점유율.*?\+\d+%)/i,
    weight: 2,
    category: "시장점유율",
    label: "점유율 확대",
  },
  {
    pattern: /(독보적|독주|독점적\s*지위)/i,
    weight: 3,
    category: "시장점유율",
    label: "독보적",
  },

  // ── 거시·정책 호재 ──────────────────────────────────────
  {
    pattern: /(정책\s*지원|정부\s*지원|국책\s*과제\s*선정)/i,
    weight: 3,
    category: "정책호재",
    label: "정책 지원",
  },
  {
    pattern: /(보조금|세제\s*혜택|세금\s*감면|인센티브)/i,
    weight: 3,
    category: "정책호재",
    label: "보조금/세제",
  },
  {
    pattern: /(규제\s*완화|규제\s*개선|허가|승인)/i,
    weight: 2,
    category: "정책호재",
    label: "규제 완화",
  },

  // ── M&A·투자 유치 ──────────────────────────────────────
  {
    pattern: /(인수합병|M&A.*?성공|피인수|인수\s*완료)/i,
    weight: 4,
    category: "M&A",
    label: "M&A",
  },
  {
    pattern: /(\d+(?:천|백)?억\s*원?\s*투자\s*유치|투자\s*유치|시리즈\s*[A-E]\s*투자)/i,
    weight: 3,
    category: "M&A",
    label: "투자 유치",
  },
  {
    pattern: /(전략적\s*파트너십|파트너십\s*체결)/i,
    weight: 2,
    category: "M&A",
    label: "파트너십",
  },

  // ── 한국어 약·중간 호재 보강 (Round 4) ────────────────────
  // 단독으로 호재 분류가 가능하도록 weight 2~3 범위. 너무 일반적인 단어("성공",
  // "확대")는 weight 1 로 차등. classifySentiment 임계값(1.5)과 맞물려 약 신호도 잡힘.
  { pattern: /(신고가\s*경신|신고가)/i, weight: 4, category: "실적호조", label: "신고가" },
  { pattern: /(흑자|흑자\s*기록)/i, weight: 3, category: "실적호조", label: "흑자" },
  { pattern: /(컨센서스\s*상회|컨센\s*상회)/i, weight: 4, category: "실적호조", label: "컨센 상회" },
  { pattern: /(가이던스\s*상향|가이던스\s*올림)/i, weight: 4, category: "실적호조", label: "가이던스 상향" },
  { pattern: /(자사주\s*매입|자사주\s*소각|자사주\s*소각|buyback)/i, weight: 3, category: "정책호재", label: "자사주" },
  { pattern: /(배당\s*인상|배당\s*확대|배당금\s*증액)/i, weight: 3, category: "정책호재", label: "배당 인상" },
  { pattern: /(주가\s*급등|급등|폭등)/i, weight: 3, category: "실적호조", label: "급등" },
  { pattern: /(반등|회복세|회복)/i, weight: 2, category: "실적호조", label: "반등" },
  { pattern: /(강세|호조|호황)/i, weight: 2, category: "실적호조", label: "강세" },
  { pattern: /(수혜주?|수혜\s*기대)/i, weight: 2, category: "정책호재", label: "수혜" },
  { pattern: /(매수\s*추천|비중\s*확대)/i, weight: 4, category: "목표가 상향", label: "매수 추천" },
  { pattern: /(분기\s*최대|분기\s*역대)/i, weight: 3, category: "실적호조", label: "분기 최대" },
  { pattern: /(시장\s*진출|해외\s*진출|글로벌\s*진출)/i, weight: 2, category: "신제품/기술", label: "진출" },
  { pattern: /(증가|성장)/i, weight: 1, category: "실적호조", label: "증가" },
  { pattern: /(확대)/i, weight: 1, category: "실적호조", label: "확대" },
  { pattern: /(성공)/i, weight: 1, category: "실적호조", label: "성공" },

  // ── 영어 호재 (Round 4) — word boundary 사용 ──────────────
  // 단어 경계(\b)로 substring 오탐 방지. 예: "miss" 가 "mission" 안에 매칭되는 일은 없음.
  // 한국어 substring 매칭과 달리 영어는 형태소 변형이 많아 \b 필수.
  { pattern: /\b(surge|surges|surged|surging)\b/i, weight: 3, category: "실적호조", label: "surge" },
  { pattern: /\b(jump|jumps|jumped|jumping)\b/i, weight: 3, category: "실적호조", label: "jump" },
  { pattern: /\b(soar|soars|soared|soaring)\b/i, weight: 4, category: "실적호조", label: "soar" },
  { pattern: /\b(rally|rallies|rallied)\b/i, weight: 3, category: "실적호조", label: "rally" },
  { pattern: /\bbeat(s|ing)?\b/i, weight: 4, category: "실적호조", label: "beat" },
  { pattern: /\b(exceed|exceeds|exceeded)\b/i, weight: 3, category: "실적호조", label: "exceed" },
  { pattern: /\b(record|all-time)\s+(high|profit|quarter|revenue|earnings)\b/i, weight: 4, category: "실적호조", label: "record high" },
  { pattern: /\b(top-line|topline)\s+(growth|beat)\b/i, weight: 3, category: "실적호조", label: "top-line beat" },
  { pattern: /\b(raised|raises|raise)\s+(guidance|outlook|target)\b/i, weight: 4, category: "실적호조", label: "guidance raise" },
  { pattern: /\b(upgrade|upgraded|upgrades)\b/i, weight: 4, category: "목표가 상향", label: "upgrade" },
  { pattern: /\b(outperform|outperforms|outperformed|outperforming)\b/i, weight: 3, category: "목표가 상향", label: "outperform" },
  { pattern: /\b(buy\s+rating|strong\s+buy)\b/i, weight: 4, category: "목표가 상향", label: "buy rating" },
  { pattern: /\b(bullish)\b/i, weight: 3, category: "목표가 상향", label: "bullish" },
  { pattern: /\b(breakthrough)\b/i, weight: 3, category: "신제품/기술", label: "breakthrough" },
  { pattern: /\b(partnership|partnerships)\b/i, weight: 2, category: "M&A", label: "partnership" },
  { pattern: /\b(acquire|acquires|acquired|acquisition)\b/i, weight: 3, category: "M&A", label: "acquisition" },
  { pattern: /\b(expansion|expanding|expand)\b/i, weight: 2, category: "신제품/기술", label: "expansion" },
  { pattern: /\b(contract\s+win|wins\s+contract|awarded)\b/i, weight: 4, category: "수주/계약", label: "contract win" },
  { pattern: /\b(profit|profits|profitable)\b/i, weight: 2, category: "실적호조", label: "profit" },
  { pattern: /\b(growth|growing|grew)\b/i, weight: 2, category: "실적호조", label: "growth" },
  { pattern: /\b(gain|gains|gained|gaining)\b/i, weight: 2, category: "실적호조", label: "gain" },
  { pattern: /\b(rise|rises|rose|rising)\b/i, weight: 1, category: "실적호조", label: "rise" },
  { pattern: /\b(stock\s+split|dividend\s+(hike|increase|raise|boost))\b/i, weight: 3, category: "정책호재", label: "dividend hike" },
];

// 헤드라인 1개에서 매칭된 키워드 전부 반환. 같은 라벨 dedupe.
export function matchOpportunityKeywords(
  headline: string
): OpportunityKeyword[] {
  const hits: OpportunityKeyword[] = [];
  const seen = new Set<string>();
  for (const kw of POSITIVE_KEYWORDS) {
    if (kw.pattern.test(headline) && !seen.has(kw.label)) {
      hits.push(kw);
      seen.add(kw.label);
    }
  }
  return hits;
}
