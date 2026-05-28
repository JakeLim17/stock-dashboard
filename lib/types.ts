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

export interface OverseasNightIndicator {
  // 국내 종목 코드 (예: 005930.KS)
  baseCode: string;
  // 해외 대체 티커 (예: SMSN.IL)
  proxyCode: string;
  name: string;
  exchange: string;
  sharesPerReceipt: number;
  price: number;
  changeRate: number;
  currency?: string;
  fxToKrw?: number | null;
  usdKrw?: number | null;
  eurUsd?: number | null;
  impliedKrwPrice?: number | null;
  krxClose?: number | null;
  premiumRate?: number | null;
  marketState?: string;
  priceTime?: number | null;
  fetchedAt: number;
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
  // 시간외 누적 거래량/대금. 데이터 소스가 주는 경우에만 채움.
  volume?: number | null;
  tradingValue?: number | null;
  high?: number | null;
  low?: number | null;
  // 한국 시간외 표시 때 비교 기준으로 쓰는 정규장 종가
  regularClose?: number | null;
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
  valuation?: ValuationMetrics | null;
  fetchedAt: number; // epoch ms
  // Yahoo 시장 상태. REGULAR | PRE | POST | POSTPOST | CLOSED | PREPRE 등
  marketState?: string;
  // 가격이 마지막으로 갱신된 시각 (epoch sec → ms 변환). null이면 모름.
  priceTime?: number | null;
  // 정규장 외 거래 정보 (있을 때만 채움)
  extendedHours?: ExtendedHoursQuote | null;
}

export interface ValuationMetrics {
  per?: number | null;
  forwardPer?: number | null;
  pbr?: number | null;
  eps?: number | null;
  forwardEps?: number | null;
  bps?: number | null;
  dividendYield?: number | null;
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

// 예측 (통계 기반, 투자조언 아님)
export interface PriceRange {
  horizonLabel: string; // "1일", "1주" 등
  horizonDays: number;
  center: number; // 중심 예상 가격
  low: number; // -1σ
  high: number; // +1σ
  confidence: number; // 0.68 (1σ) | 0.95 (2σ)
}

export interface PriceTargets {
  entry: number; // 매수 진입 기준가
  stopLoss: number; // 손절가
  takeProfit1: number; // 1차 목표
  takeProfit2: number; // 2차 목표
  support: number; // 최근 20일 저점 기준 지지
  resistance: number; // 최근 20일 고점 기준 저항
  riskReward: number; // (목표1 - 진입) / (진입 - 손절)
}

export interface ScenarioRow {
  label: string; // "나스닥 +1%"
  expected: number; // 예상 변화율 (0.008 = +0.8%)
  beta: number; // 회귀 계수
  baselineLabel: string; // "NQ=F 60일 베타"
}

export interface Predictions {
  // 최근 90일 데이터 기반 1σ 가격 범위
  ranges: PriceRange[];
  // ATR 기반 진입/손절/목표
  targets: PriceTargets | null;
  // 시장 베타 시나리오 (나스닥, 환율)
  scenarios: ScenarioRow[];
  valuation?: {
    per?: number | null;
    forwardPer?: number | null;
    pbr?: number | null;
    riskScore: number;
    label: "낮음" | "보통" | "주의" | "높음";
    reasons: string[];
  } | null;
  // 해외 GDR/DR 등 개별 야간 참고 지표. 토글이 켜졌을 때만 채움.
  nightSignal?: {
    label: string;
    expectedRate: number;
    source: string;
    price: number;
    currency?: string;
    sharesPerReceipt?: number;
    fxToKrw?: number | null;
    usdKrw?: number | null;
    eurUsd?: number | null;
    impliedKrwPrice?: number | null;
    krxClose?: number | null;
    premiumRate?: number | null;
    marketState?: string;
    time?: number | null;
    fetchedAt?: number;
  } | null;
  // 신호 강도 (양방향 0~100)
  strength: {
    buy: number;
    sell: number;
  };
}

export interface StockSnapshot {
  meta: SymbolMeta;
  quote: Quote;
  flow: FlowData;
  tech: TechIndicators;
  analysis: AnalysisResult;
  overseasNight?: OverseasNightIndicator | null;
  predictions?: Predictions | null;
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
