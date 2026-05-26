import type { SymbolMeta } from "./types";

// 메인 관심 종목 (카드 3개)
export const PRIMARY_SYMBOLS: SymbolMeta[] = [
  { code: "005930.KS", name: "삼성전자", kind: "kr-stock", primary: true },
  { code: "000660.KS", name: "SK하이닉스", kind: "kr-stock", primary: true },
  { code: "009150.KS", name: "삼성전기", kind: "kr-stock", primary: true },
];

// 관심종목 선택 UI에서 고를 수 있는 후보군 (최대 8개 권장)
export const WATCHLIST_CANDIDATES: SymbolMeta[] = [
  ...PRIMARY_SYMBOLS,
  { code: "373220.KS", name: "LG에너지솔루션", kind: "kr-stock" },
  { code: "005380.KS", name: "현대차", kind: "kr-stock" },
  { code: "035420.KS", name: "NAVER", kind: "kr-stock" },
  { code: "251270.KS", name: "넷마블", kind: "kr-stock" },
  { code: "042700.KS", name: "한미반도체", kind: "kr-stock" },
  { code: "012450.KS", name: "한화에어로스페이스", kind: "kr-stock" },
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
    .slice(0, 8);
  return uniq.length > 0 ? uniq : PRIMARY_SYMBOLS;
}
