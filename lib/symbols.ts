import type { SymbolMeta } from "./types";

// 메인 관심 종목 (기본 카드 3개)
export const PRIMARY_SYMBOLS: SymbolMeta[] = [
  { code: "005930.KS", name: "삼성전자", kind: "kr-stock", primary: true },
  { code: "000660.KS", name: "SK하이닉스", kind: "kr-stock", primary: true },
  { code: "009150.KS", name: "삼성전기", kind: "kr-stock", primary: true },
];

// 화면 최대 표시 가능한 관심종목 수
export const MAX_WATCH = 6;

// 관심종목 후보군 (검색해서 추가)
// 한국 시총 상위 + 인기 종목 위주. KOSPI=.KS, KOSDAQ=.KQ
export const WATCHLIST_CANDIDATES: SymbolMeta[] = [
  // 반도체
  ...PRIMARY_SYMBOLS,
  { code: "042700.KS", name: "한미반도체", kind: "kr-stock" },
  // 자동차 / 2차전지
  { code: "005380.KS", name: "현대차", kind: "kr-stock" },
  { code: "000270.KS", name: "기아", kind: "kr-stock" },
  { code: "373220.KS", name: "LG에너지솔루션", kind: "kr-stock" },
  { code: "006400.KS", name: "삼성SDI", kind: "kr-stock" },
  { code: "247540.KQ", name: "에코프로비엠", kind: "kr-stock" },
  { code: "086520.KQ", name: "에코프로", kind: "kr-stock" },
  // 금융
  { code: "105560.KS", name: "KB금융", kind: "kr-stock" },
  { code: "055550.KS", name: "신한지주", kind: "kr-stock" },
  { code: "086790.KS", name: "하나금융지주", kind: "kr-stock" },
  // 화학 / 소재 / 철강
  { code: "051910.KS", name: "LG화학", kind: "kr-stock" },
  { code: "011170.KS", name: "롯데케미칼", kind: "kr-stock" },
  { code: "005490.KS", name: "POSCO홀딩스", kind: "kr-stock" },
  // 바이오 / 제약
  { code: "207940.KS", name: "삼성바이오로직스", kind: "kr-stock" },
  { code: "068270.KS", name: "셀트리온", kind: "kr-stock" },
  { code: "196170.KQ", name: "알테오젠", kind: "kr-stock" },
  // 인터넷 / 게임 / 엔터
  { code: "035420.KS", name: "NAVER", kind: "kr-stock" },
  { code: "035720.KS", name: "카카오", kind: "kr-stock" },
  { code: "036570.KS", name: "엔씨소프트", kind: "kr-stock" },
  { code: "251270.KS", name: "넷마블", kind: "kr-stock" },
  { code: "293490.KQ", name: "카카오게임즈", kind: "kr-stock" },
  { code: "352820.KS", name: "하이브", kind: "kr-stock" },
  { code: "041510.KQ", name: "에스엠", kind: "kr-stock" },
  // 방산 / 항공우주
  { code: "012450.KS", name: "한화에어로스페이스", kind: "kr-stock" },
  { code: "047810.KS", name: "한국항공우주", kind: "kr-stock" },
  { code: "064350.KS", name: "현대로템", kind: "kr-stock" },
  // 조선 / 해운
  { code: "329180.KS", name: "HD현대중공업", kind: "kr-stock" },
  { code: "010140.KS", name: "삼성중공업", kind: "kr-stock" },
  { code: "042660.KS", name: "한화오션", kind: "kr-stock" },
  { code: "011200.KS", name: "HMM", kind: "kr-stock" },
  // 유틸 / 종합
  { code: "015760.KS", name: "한국전력", kind: "kr-stock" },
  { code: "028260.KS", name: "삼성물산", kind: "kr-stock" },
  { code: "003490.KS", name: "대한항공", kind: "kr-stock" },
];

// 시장 지표 패널
export const MARKET_INDICATORS: SymbolMeta[] = [
  { code: "NQ=F", name: "나스닥 선물", kind: "future" },
  { code: "^SOX", name: "필라델피아 반도체", kind: "index" },
  { code: "NVDA", name: "엔비디아", kind: "us-stock" },
  { code: "KRW=X", name: "달러/원", kind: "fx" },
  { code: "^VIX", name: "VIX 변동성", kind: "index" },
];

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
