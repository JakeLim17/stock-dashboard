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

// 한국거래소 시장경보 — 네이버 PC 종목 페이지 마크업에서 추출.
//   caution (투자주의)  : 단기 급등 — 1일 주의
//   warning (투자경고)  : 추가 상승 시 매매거래 정지 가능
//   risk    (투자위험)  : 더 오르면 즉시 1일 거래정지
//   halt    (거래정지)  : 이미 거래 정지된 상태
//   admin   (관리종목)  : 상장폐지 위험 단계
export type MarketAlertLevel = "caution" | "warning" | "risk" | "halt" | "admin";

export interface MarketAlert {
  level: MarketAlertLevel;
  label: string;        // 한글 라벨 ("투자경고" 등)
  source: "naver";
  asOf: number;         // epoch ms (캐시 갱신 시각)
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
  // 한국거래소 시장경보 (한국 종목만). 없으면 null.
  marketAlert?: MarketAlert | null;
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

// 단·장기 조합으로 도출되는 "지금 무엇을 할까?" 통합 액션.
// 사용자 피드백: 두 시그널이 분리되어 있으면 결정에 시간이 걸려 메인 결론이 필요.
export type ActionRecommendation =
  | "NEW_ENTRY" // 신규 진입
  | "SCALE_IN" // 분할 매수
  | "HOLD_WAIT" // 눌림목 대기 (보유 중이면 유지, 신규는 대기)
  | "HOLD" // 보유 유지
  | "SHORT_TRADE" // 짧게 매매 (단기 모멘텀만 활용)
  | "TRIM" // 점진적 비중 축소
  | "REDUCE" // 비중 축소
  | "AVOID"; // 관망 (신규 비추, 보유 中이면 검토)

// 메인 결론 배지/헤드라인에 쓰는 통합 데이터.
export interface ActionVerdict {
  action: ActionRecommendation;
  label: string; // 한국어 라벨 (예: "분할 매수")
  headline: string; // 한 줄 헤드라인 — 왜 이 액션인지
  tone: "buy" | "add" | "hold" | "watch" | "sell"; // 배지 색 (Badge variant)
  detail: string; // 작은 부연 (예: "단기 SELL · 장기 BUY")
  // 외부 리스크(트럼프·관세·지정학 등)로 인해 한 단계 보수적으로 시프트되었는지
  riskShifted?: boolean;
}

// 외부 이벤트 리스크 평가 결과를 types에 일급 노출.
// lib/news/riskScore.ts 의 정의를 그대로 re-export 한다 — 컴포넌트가 types만 import 해도
// shape을 알 수 있게.
export type NewsRiskLevel = "low" | "medium" | "high";

export interface NewsRiskDriver {
  label: string;
  category: string;
  headline: string;
  date: number;
  weight: number;
  contribution: number;
}

export interface NewsRiskAssessment {
  level: NewsRiskLevel;
  score: number;
  drivers: NewsRiskDriver[];
  matchCount: number;
}

export interface AnalysisResult {
  // 새 구조 — 단기/장기 분리
  shortTerm: SignalDetail;
  longTerm: SignalDetail;
  // 외부 이벤트 리스크 (트럼프·관세·지정학·정책 등). low/medium/high.
  externalRisk: NewsRiskAssessment;
  // 통합 액션 (메인 결론) — 단·장기 조합 매트릭스에서 도출 + 외부 리스크 시프트 적용
  verdict: ActionVerdict;
  // 백워드 호환 — 기존 컴포넌트/DB는 아래 필드를 그대로 읽고 있어 단기 값을 미러링.
  // 단, headline은 verdict.headline(통합 메시지)을 노출한다.
  signal: SignalStatus; // = shortTerm.signal
  heatScore: number; // 0~100 (높을수록 과열) — 단기 룰 기반
  buyScore: number; // 0~100 (높을수록 매수우위) — 단기 룰 기반
  headline: string; // = verdict.headline (단·장기 조합 통합 메시지)
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
