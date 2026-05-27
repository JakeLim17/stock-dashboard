// 도메인 전반에서 공유되는 타입

export type SignalStatus = "BUY" | "ADD" | "HOLD" | "WATCH" | "SELL";

export type SymbolKind = "kr-stock" | "us-stock" | "index" | "future" | "fx";

export interface SymbolMeta {
  // 내부 표준 코드 (예: 005930.KS)
  code: string;
  // 사용자 표시명
  name: string;
  kind: SymbolKind;
  // 핵심 관심 종목 여부 (메인 카드 노출)
  primary?: boolean;
}

// 시간외 거래 세션
//  - pre        : 미국 프리마켓 (Yahoo)
//  - post       : 미국 애프터마켓 (Yahoo)
//  - kr-after   : 한국 정규장 종료 후 시간외 단일가 / 앱장 (네이버)
//  - kr-before  : 한국 장전 시간외 단일가 (네이버)
export type ExtendedSession = "pre" | "post" | "kr-after" | "kr-before";

export interface ExtendedHoursQuote {
  session: ExtendedSession;
  // 시간외 체결가
  price: number;
  // 비교 기준값(정규장 종가) 대비 변화
  changeAbs: number;
  changeRate: number; // 0.0123 = +1.23%
  // 마지막 체결 시각 (epoch ms)
  time?: number | null;
  // 현재 세션이 거래중인지(OPEN), 마감(CLOSE) 여부
  active?: boolean;
}

export interface Quote {
  code: string;
  name: string;
  price: number;
  prevClose: number;
  changeAbs: number;
  changeRate: number; // 0.0123 = +1.23%
  volume: number | null;
  high?: number | null;
  low?: number | null;
  marketCap?: number | null;
  currency?: string;
  fetchedAt: number; // epoch ms
  // Yahoo 시장 상태. REGULAR | PRE | POST | POSTPOST | CLOSED | PREPRE 등
  marketState?: string;
  // 가격이 마지막으로 갱신된 시각 (epoch sec → ms 변환). null이면 모름.
  priceTime?: number | null;
  // 정규장 외 거래 정보 (있을 때만 채움)
  extendedHours?: ExtendedHoursQuote | null;
}

export interface FlowData {
  // 외국인 / 기관 순매수 (원). KIS provider가 채움. 없으면 null.
  foreignNet: number | null;
  institutionNet: number | null;
  // 5일 누적 외인/기관 순매수
  foreignNet5d?: number | null;
  institutionNet5d?: number | null;
  // 데이터 출처 — UI에 mock 표시용
  source?: "kis" | "mock";
}

export interface TechIndicators {
  sma5?: number | null;
  sma20?: number | null;
  sma60?: number | null;
  rsi14?: number | null;
  // 단기 추세: "uptrend" | "sideways" | "downtrend"
  trend?: "uptrend" | "sideways" | "downtrend" | null;
  // 과열도 0~100
  heat?: number | null;
}

export interface NewsItem {
  id: string; // hash of link
  title: string;
  link: string;
  source: string;
  publishedAt: number; // epoch ms
  symbol?: string | null; // 연결된 종목
  sentiment?: "positive" | "negative" | "neutral" | null;
  keywords?: string[];
}

export interface AnalysisResult {
  signal: SignalStatus;
  heatScore: number; // 0~100 (높을수록 과열)
  buyScore: number; // 0~100 (높을수록 매수우위)
  headline: string; // "현재는 추격매수 위험" 같은 한 줄
  reasons: string[]; // 1~3줄 근거
}

export interface StockSnapshot {
  meta: SymbolMeta;
  quote: Quote;
  flow: FlowData;
  tech: TechIndicators;
  analysis: AnalysisResult;
}

export interface MarketIndicator {
  code: string;
  name: string;
  value: number;
  changeRate: number;
  status: "up" | "down" | "flat" | "warn";
  hint?: string;
}

export interface DashboardSnapshot {
  generatedAt: number;
  primaries: StockSnapshot[]; // 관심 종목 카드
  indicators: MarketIndicator[]; // 시장 신호 패널
  marketMood: {
    label: "강세" | "중립" | "약세";
    semiHeat: number; // 반도체 과열도 0~100
    riskKeywords: string[];
  };
  news: NewsItem[];
  errors: Record<string, string>; // provider 별 에러 메시지
}
