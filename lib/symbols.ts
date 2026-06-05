import type { OverseasNightIndicator, SymbolMeta } from "./types";

// 메인 관심 종목 (기본 카드 3개)
export const PRIMARY_SYMBOLS: SymbolMeta[] = [
  { code: "005930.KS", name: "삼성전자", kind: "kr-stock", primary: true, sector: "반도체" },
  { code: "000660.KS", name: "SK하이닉스", kind: "kr-stock", primary: true, sector: "반도체" },
  { code: "009150.KS", name: "삼성전기", kind: "kr-stock", primary: true, sector: "반도체" },
];

// 화면 최대 표시 가능한 관심종목 수
export const MAX_WATCH = 6;

// 관심종목 후보군 (검색해서 추가, 추천 스크리닝 대상)
// 한국 시총 상위 + 인기 종목 위주. KOSPI=.KS, KOSDAQ=.KQ
// sector 는 추천 패널의 섹터 탭과 시장 컨텍스트 보너스 계산에 사용된다.
// PRIMARY_SYMBOLS (삼전·하닉·삼성전기)는 반도체로 분류.
export const WATCHLIST_CANDIDATES: SymbolMeta[] = [
  // 반도체 (PRIMARY 포함)
  { code: "005930.KS", name: "삼성전자", kind: "kr-stock", primary: true, sector: "반도체", isSectorLeader: true, sectorLeaderLabel: "반도체 대장" },
  { code: "000660.KS", name: "SK하이닉스", kind: "kr-stock", primary: true, sector: "반도체" },
  { code: "009150.KS", name: "삼성전기", kind: "kr-stock", primary: true, sector: "반도체", isSectorLeader: true, sectorLeaderLabel: "MLCC 대장" },
  { code: "042700.KS", name: "한미반도체", kind: "kr-stock", sector: "반도체" },
  // IT가전
  { code: "066570.KS", name: "LG전자", kind: "kr-stock", sector: "IT가전", isSectorLeader: true, sectorLeaderLabel: "가전 대장" },
  // 자동차
  { code: "005380.KS", name: "현대차", kind: "kr-stock", sector: "자동차", isSectorLeader: true, sectorLeaderLabel: "완성차 대장" },
  { code: "000270.KS", name: "기아", kind: "kr-stock", sector: "자동차" },
  { code: "012330.KS", name: "현대모비스", kind: "kr-stock", sector: "자동차" },
  // 2차전지
  { code: "373220.KS", name: "LG에너지솔루션", kind: "kr-stock", sector: "배터리", isSectorLeader: true, sectorLeaderLabel: "배터리 대장" },
  { code: "006400.KS", name: "삼성SDI", kind: "kr-stock", sector: "배터리" },
  { code: "247540.KQ", name: "에코프로비엠", kind: "kr-stock", sector: "배터리" },
  { code: "086520.KQ", name: "에코프로", kind: "kr-stock", sector: "배터리" },
  // 정유·화학 (SK이노는 정유+배터리 복합. 화학으로 단순화)
  { code: "096770.KS", name: "SK이노베이션", kind: "kr-stock", sector: "화학" },
  { code: "051910.KS", name: "LG화학", kind: "kr-stock", sector: "화학" },
  { code: "011170.KS", name: "롯데케미칼", kind: "kr-stock", sector: "화학" },
  // 철강·비철금속
  { code: "005490.KS", name: "POSCO홀딩스", kind: "kr-stock", sector: "철강소재" },
  { code: "010130.KS", name: "고려아연", kind: "kr-stock", sector: "철강소재" },
  // 금융 / 보험 / 인터넷은행
  { code: "105560.KS", name: "KB금융", kind: "kr-stock", sector: "금융" },
  { code: "055550.KS", name: "신한지주", kind: "kr-stock", sector: "금융" },
  { code: "086790.KS", name: "하나금융지주", kind: "kr-stock", sector: "금융" },
  { code: "032830.KS", name: "삼성생명", kind: "kr-stock", sector: "금융" },
  { code: "323410.KS", name: "카카오뱅크", kind: "kr-stock", sector: "금융" },
  // 바이오 / 제약
  { code: "207940.KS", name: "삼성바이오로직스", kind: "kr-stock", sector: "바이오" },
  { code: "068270.KS", name: "셀트리온", kind: "kr-stock", sector: "바이오" },
  { code: "196170.KQ", name: "알테오젠", kind: "kr-stock", sector: "바이오" },
  // 인터넷
  { code: "035420.KS", name: "네이버", kind: "kr-stock", sector: "인터넷", isSectorLeader: true, sectorLeaderLabel: "인터넷 대장" },
  { code: "035720.KS", name: "카카오", kind: "kr-stock", sector: "인터넷" },
  // 게임
  { code: "036570.KS", name: "엔씨소프트", kind: "kr-stock", sector: "게임" },
  { code: "251270.KS", name: "넷마블", kind: "kr-stock", sector: "게임" },
  { code: "293490.KQ", name: "카카오게임즈", kind: "kr-stock", sector: "게임" },
  { code: "259960.KS", name: "크래프톤", kind: "kr-stock", sector: "게임" },
  // 엔터
  { code: "352820.KS", name: "하이브", kind: "kr-stock", sector: "엔터" },
  { code: "041510.KQ", name: "에스엠", kind: "kr-stock", sector: "엔터" },
  // 방산 / 항공우주
  { code: "012450.KS", name: "한화에어로스페이스", kind: "kr-stock", sector: "방산", isSectorLeader: true, sectorLeaderLabel: "방산 대장" },
  { code: "047810.KS", name: "한국항공우주", kind: "kr-stock", sector: "방산", isSectorLeader: true, sectorLeaderLabel: "항우 대장" },
  { code: "064350.KS", name: "현대로템", kind: "kr-stock", sector: "방산" },
  // 조선 / 해운 (HMM은 해운이지만 동일 그룹)
  { code: "329180.KS", name: "HD현대중공업", kind: "kr-stock", sector: "조선" },
  { code: "010140.KS", name: "삼성중공업", kind: "kr-stock", sector: "조선" },
  { code: "042660.KS", name: "한화오션", kind: "kr-stock", sector: "조선" },
  { code: "011200.KS", name: "HMM", kind: "kr-stock", sector: "조선" },
  // 원전 / 전력기기 / 유틸리티
  { code: "034020.KS", name: "두산에너빌리티", kind: "kr-stock", sector: "원전전력", isSectorLeader: true, sectorLeaderLabel: "원전 대장" },
  { code: "267260.KS", name: "HD현대일렉트릭", kind: "kr-stock", sector: "원전전력" },
  { code: "015760.KS", name: "한국전력", kind: "kr-stock", sector: "원전전력" },
  // 통신
  { code: "017670.KS", name: "SK텔레콤", kind: "kr-stock", sector: "통신" },
  // 유통 / 종합상사
  { code: "028260.KS", name: "삼성물산", kind: "kr-stock", sector: "유통종합" },
  // 항공
  { code: "003490.KS", name: "대한항공", kind: "kr-stock", sector: "항공", isSectorLeader: true, sectorLeaderLabel: "항공 대장" },
];

// 시장 지표 패널
export const MARKET_INDICATORS: SymbolMeta[] = [
  { code: "NQ=F", name: "나스닥 선물", kind: "future" },
  { code: "^SOX", name: "필라델피아 반도체", kind: "index" },
  { code: "NVDA", name: "엔비디아", kind: "us-stock", isSectorLeader: true, sectorLeaderLabel: "AI 반도체 대장" },
  { code: "KRW=X", name: "달러/원", kind: "fx" },
  { code: "^VIX", name: "VIX 변동성", kind: "index" },
];

// ─── 테마 그룹 ────────────────────────────────────────────────────────────
// 섹터(sector)는 분야 1차 분류, 테마(theme)는 시장 narrative 단위 묶음.
// 예: "AI 반도체" 테마에는 반도체 + NVDA(미국)을 묶고, "배터리" 테마에는
// 화학 섹터인 LG화학도 같이 묶는 식.
//
// codes는 WATCHLIST_CANDIDATES 또는 MARKET_INDICATORS에 실제 존재하는 것만 적는다.
// resolveThemes() 가 누락된 코드는 자동으로 제외하고 반환한다.
export type ThemeTag =
  | "ai_semi"
  | "battery"
  | "defense"
  | "auto"
  | "internet_game"
  | "shipping_aviation"
  | "nuclear_power"
  | "biotech"
  | "shipbuilding"
  | "finance";

export interface ThemeDefinition {
  id: ThemeTag;
  label: string;
  emoji: string;
  // 짧은 설명 — 헤더 hover/툴팁용
  description?: string;
  codes: string[];
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "ai_semi",
    label: "AI 반도체",
    emoji: "🧠",
    description: "AI 학습·추론용 메모리·로직 반도체",
    codes: ["005930.KS", "000660.KS", "042700.KS", "NVDA"],
  },
  {
    id: "battery",
    label: "배터리",
    emoji: "🔋",
    description: "2차전지 셀·소재",
    codes: [
      "373220.KS",
      "006400.KS",
      "247540.KQ",
      "086520.KQ",
      "051910.KS",
    ],
  },
  {
    id: "defense",
    label: "방산",
    emoji: "🛡️",
    description: "방산·항공우주·지정학 수혜",
    codes: ["012450.KS", "047810.KS", "064350.KS"],
  },
  {
    id: "auto",
    label: "완성차",
    emoji: "🚗",
    description: "현대·기아·부품",
    codes: ["005380.KS", "000270.KS", "012330.KS"],
  },
  {
    id: "internet_game",
    label: "인터넷·게임",
    emoji: "💻",
    description: "플랫폼·콘텐츠 — 나스닥 연동 강함",
    codes: [
      "035420.KS",
      "035720.KS",
      "036570.KS",
      "251270.KS",
      "259960.KS",
      "293490.KQ",
    ],
  },
  {
    id: "shipping_aviation",
    label: "항공·해운",
    emoji: "✈️",
    description: "운임·환율 민감",
    codes: ["003490.KS", "011200.KS"],
  },
  {
    id: "nuclear_power",
    label: "원전·전력",
    emoji: "⚛️",
    description: "원전·송배전·전력기기",
    codes: ["034020.KS", "267260.KS", "015760.KS"],
  },
  {
    id: "biotech",
    label: "바이오",
    emoji: "💊",
    description: "바이오·제약·CDMO",
    codes: ["207940.KS", "068270.KS", "196170.KQ"],
  },
  {
    id: "shipbuilding",
    label: "조선",
    emoji: "⚓",
    description: "선가 사이클 + 친환경 선박",
    codes: ["329180.KS", "010140.KS", "042660.KS"],
  },
  {
    id: "finance",
    label: "금융",
    emoji: "🏦",
    description: "은행·보험·인터넷은행",
    codes: [
      "105560.KS",
      "055550.KS",
      "086790.KS",
      "032830.KS",
      "323410.KS",
    ],
  },
];

// 테마 정의 + 코드 카탈로그(WATCHLIST + MARKET_INDICATORS)를 매칭해
// 실제 존재하는 종목만 남긴 형태로 반환. 매칭 안 된 테마(전체 codes 0개)는 제외.
export interface ResolvedTheme extends ThemeDefinition {
  members: SymbolMeta[];
}

export function resolveThemes(): ResolvedTheme[] {
  const catalog = new Map<string, SymbolMeta>();
  for (const m of WATCHLIST_CANDIDATES) catalog.set(m.code, m);
  for (const m of MARKET_INDICATORS) {
    if (!catalog.has(m.code)) catalog.set(m.code, m);
  }
  const out: ResolvedTheme[] = [];
  for (const t of THEMES) {
    const members = t.codes
      .map((c) => catalog.get(c))
      .filter((v): v is SymbolMeta => !!v);
    if (members.length > 0) out.push({ ...t, members });
  }
  return out;
}

type OverseasNightProxy = Pick<
  OverseasNightIndicator,
  "baseCode" | "proxyCode" | "name" | "exchange" | "sharesPerReceipt"
>;

// 해외장에서 거래되는 국내 개별주 대체 지표.
// 삼성전기처럼 확인 가능한 GDR/DR 티커가 없는 종목은 매핑하지 않는다.
export const OVERSEAS_NIGHT_PROXIES: OverseasNightProxy[] = [
  {
    baseCode: "005930.KS",
    proxyCode: "SMSN.IL",
    name: "삼성전자 GDR",
    exchange: "London IOB",
    sharesPerReceipt: 25,
  },
  {
    baseCode: "000660.KS",
    proxyCode: "HY9H.F",
    name: "SK하이닉스 GDR",
    exchange: "Frankfurt",
    sharesPerReceipt: 1,
  },
];

export function getOverseasNightProxy(
  code: string
): OverseasNightProxy | null {
  return OVERSEAS_NIGHT_PROXIES.find((p) => p.baseCode === code) ?? null;
}

// 한국 종목 코드를 6자리 숫자로 변환 (KIS API 호환). 예: 005930.KS -> 005930
export function toKisCode(code: string): string | null {
  const m = code.match(/^(\d{6})\.K[SQ]$/);
  return m ? m[1] : null;
}

// 화면용 키 (URL safe)
export function toSlug(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "_");
}

export function resolveWatchSymbols(codes: string[]): SymbolMeta[] {
  const map = new Map(WATCHLIST_CANDIDATES.map((s) => [s.code, s]));
  const uniq = Array.from(new Set(codes))
    .map((c) => map.get(c))
    .filter((v): v is SymbolMeta => !!v)
    .slice(0, MAX_WATCH);
  return uniq.length > 0 ? uniq : PRIMARY_SYMBOLS;
}
