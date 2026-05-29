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

// 단기 / 장기 각각의 점수·신호·헤드라인·근거를 분리한 갈래.
// shortTerm: RSI/이평/등락률/수급/시장 컨텍스트 — 며칠~2~3주 시계.
// longTerm : 컨센서스/추정 PER/PBR/애널 분포 — 분기~연간 시계.
export interface SignalDetail {
  signal: SignalStatus;
  headline: string;
  reasons: string[]; // 최대 3줄
  score: number; // 0~100. 단기는 (buy - heat) 환산, 장기는 base 50 + 룰 가감산
}

export interface AnalysisResult {
  // 새 구조 — 단기/장기 분리
  shortTerm: SignalDetail;
  longTerm: SignalDetail;
  // 백워드 호환 — 기존 컴포넌트/DB는 아래 필드를 그대로 읽고 있어 단기 값을 미러링.
  // 단, headline은 단·장기 조합 통합 메시지를 우선 노출하기 위해 shortTerm.headline을 그대로 쓴다.
  signal: SignalStatus; // = shortTerm.signal
  heatScore: number; // 0~100 (높을수록 과열) — 단기 룰 기반
  buyScore: number; // 0~100 (높을수록 매수우위) — 단기 룰 기반
  headline: string; // = shortTerm.headline (단·장기 조합 메시지가 들어 있음)
  reasons: string[]; // = shortTerm.reasons
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

// 컨센서스 / 밸류에이션 / 리서치 노트 — 펀더멘털 보조 데이터.
// 매 5~15초 시세 갱신과 별개로 6시간 TTL 캐시에서 끌어 쓴다.
export interface AnalystConsensus {
  // 컨센서스 목표가. 한국 종목은 네이버에서, 해외는 Yahoo에서 받는다.
  targetMean: number | null;
  targetMedian: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  // 애널리스트 의견 분포
  analystCount: number | null;
  // Yahoo 척도: strong_buy < buy < hold < sell < strong_sell
  recommendationKey:
    | "strong_buy"
    | "buy"
    | "hold"
    | "sell"
    | "strong_sell"
    | null;
  // Yahoo recommendationMean (1~5 scale, 낮을수록 매수). 네이버 척도(1~5, 높을수록 매수)와 다르므로
  // 단일 진실의 소스로 Yahoo 척도만 사용한다.
  recommendationMean: number | null;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  // (targetMean - currentPrice) / currentPrice. 0.05 = +5% 여력.
  upsidePercent: number | null;
  source: "yahoo" | "naver" | "merged";
  asOf: number; // epoch ms
}

export interface Valuation {
  per: number | null; // trailing
  forwardPer: number | null; // 한국: 네이버 cnsPer, 해외: price/forwardEps
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  dividendYield: number | null; // 0.0013 = 0.13%
  week52High: number | null;
  week52Low: number | null;
  source: "yahoo" | "naver" | "merged";
  asOf: number;
}

export interface ResearchNote {
  brokerage: string;
  title: string;
  date: string; // 'YYYY-MM-DD'
  id?: string;
}

export interface StockSnapshot {
  meta: SymbolMeta;
  quote: Quote;
  flow: FlowData;
  tech: TechIndicators;
  analysis: AnalysisResult;
  overseasNight?: OverseasNightIndicator | null;
  predictions?: Predictions | null;
  // 펀더멘털 보조 (캐시)
  consensus?: AnalystConsensus | null;
  consensusValuation?: Valuation | null;
  researches?: ResearchNote[] | null;
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
