// 도메인 전반에서 공유되는 타입

export type SignalStatus = "BUY" | "ADD" | "HOLD" | "WATCH" | "SELL";

export type SymbolKind = "kr-stock" | "us-stock" | "index" | "future" | "fx";

// 섹터 태그 — 추천/스크리닝 UI의 탭과 시장 컨텍스트 보너스 계산에 사용.
// 분류는 lib/symbols.ts 의 WATCHLIST_CANDIDATES 에서 채운다.
export type SectorTag =
  | "반도체"
  | "IT가전"
  | "자동차"
  | "배터리"
  | "화학"
  | "철강소재"
  | "금융"
  | "바이오"
  | "인터넷"
  | "게임"
  | "엔터"
  | "방산"
  | "조선"
  | "원전전력"
  | "통신"
  | "유통종합"
  | "항공";

export interface SymbolMeta {
  // 내부 표준 코드 (예: 005930.KS)
  code: string;
  // 사용자 표시명
  name: string;
  kind: SymbolKind;
  // 핵심 관심 종목 여부 (메인 카드 노출)
  primary?: boolean;
  // 섹터 태그 — 추천/스크리닝에서 필터·보너스 계산에 사용.
  // PRIMARY_SYMBOLS·MARKET_INDICATORS·해외 프록시처럼 분류가 불필요한 항목은 비워둔다.
  sector?: SectorTag;
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
  // 외국인 / 기관 / 개인 순매수 (원). Naver dealTrendInfos(일 단위) × 종가로 환산.
  // 없으면 null. 개인은 외인·기관의 거울(symmetry) 값이라 분석엔 안 쓰지만 UI 노출용으로 보관.
  foreignNet: number | null;
  institutionNet: number | null;
  individualNet?: number | null;
  // 5일 누적 — 각 거래일 종가 × 해당일 순매수 수량의 합.
  foreignNet5d?: number | null;
  institutionNet5d?: number | null;
  individualNet5d?: number | null;
  // 데이터 출처 — UI에 mock 표시용
  source?: "naver" | "kis" | "mock";
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
  // (목표1 - 진입) / (진입 - 손절). entry === stopLoss 면 분모 0이라 null.
  riskReward: number | null;
}

export interface ScenarioRow {
  label: string; // "나스닥 +1%"
  expected: number; // 예상 변화율 (0.008 = +0.8%)
  beta: number; // 회귀 계수
  baselineLabel: string; // "NQ=F 60일 베타"
  // 회귀 적합도(R²) — 시장 지수가 종목 수익률을 얼마나 설명하는지. 0~1.
  // 옛 스냅샷 호환 위해 optional. 신규 응답엔 항상 채움.
  r2?: number;
  // R² 기반 신뢰도 등급 — UI에서 배지/회색 처리 분기에 사용.
  //   high   : R² ≥ 0.6
  //   medium : 0.3 ≤ R² < 0.6
  //   low    : R² < 0.3 → 시나리오 자체 신뢰도 낮음 (회색/주석)
  confidence?: "high" | "medium" | "low";
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

// 분석가(증권사)별 개별 리포트.
// 한국 종목은 wisereport에서 증권사별 목표가 표를 파싱해 채운다 (UI 노출 + 국내 평균 산정).
// 해외 종목은 현재 미수집(Yahoo는 분포만 줌).
export interface AnalystReport {
  // 증권사명. wisereport 표 그대로(예: "미래에셋", "신한투자", "메리츠")
  brokerName: string;
  // 목표가 (원, 통화 단위는 원본 그대로)
  targetPrice: number;
  // 투자의견. wisereport 원문 ("BUY" / "Buy" / "매수" / "Hold" 등)
  opinion?: string;
  // 발행/최종 일자 (epoch ms)
  publishDate?: number;
  // 직전 목표가 — 상향/하향 여부 판단용
  previousTarget?: number | null;
  // 직전 투자의견
  previousOpinion?: string | null;
  // 한국 증권사 여부 — 화이트리스트 매칭. 모르면 wisereport 출처라 true 기본.
  isDomestic: boolean;
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

  // ── 증권사별 detail / 국내 평균 (한국 종목 한정) ──────────────────
  // wisereport 제공처별 표를 파싱한 raw 리스트. 최근 발행 순으로 정렬.
  // 외국 종목은 빈 배열 또는 undefined.
  reports?: AnalystReport[];
  // 국내(한국) 증권사만 모은 평균/최고/최저/카운트.
  // targetMean(merged)에는 외국인 분석가 평균까지 섞여 있어 한국 종목 verdict가 과보수적으로
  // 기우는 문제를 보정. 룰은 한국 종목인 경우 domesticMean 우선 사용.
  domesticMean?: number | null;
  domesticHigh?: number | null;
  domesticLow?: number | null;
  domesticCount?: number;
  // domesticMean 기준 상승여력 — snapshot에서 매번 재계산
  domesticUpsidePercent?: number | null;

  // ── 글로벌(외국 증권사) 컨센서스 — Yahoo quoteSummary 기반 ──────────
  // 미국·EU broker 평균. 한국 종목엔 외국 broker가 별로 없어 종종 null.
  // - 한국 종목: Yahoo가 주는 mean이 국내 분석가까지 섞여 있는 경우가 있지만
  //   대부분 외국계라 globalMean으로 매핑한다. 데이터가 없으면 null.
  // - 미국 종목: Yahoo의 mean이 곧 globalMean. domesticMean은 항상 null.
  globalMean?: number | null;
  globalHigh?: number | null;
  globalLow?: number | null;
  globalCount?: number;
  // globalMean 기준 상승여력 — snapshot에서 매번 재계산
  globalUpsidePercent?: number | null;
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
  // 두 소스(Yahoo forwardPE / Naver cnsPer) 비교 결과.
  //   - "high": 단일 소스이거나 두 값이 가까움(2× 이내)
  //   - "low" : 두 값이 2× 이상 차이 — 룰 적용 가중치 축소
  forwardPerConfidence?: "high" | "low";
  // 디버그/표시용 — 두 소스가 모두 있을 때 raw 비교값
  forwardPerYahoo?: number | null;
  forwardPerNaver?: number | null;
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

// ----------------------------------------------------------------------------
// 추천 — watchlist candidates 전체를 분석 파이프라인에 돌려서 카테고리별로 정렬한 결과.
// 새 데이터 소스 없이 기존 analyze + 컨센서스 + 뉴스리스크 + 시장경보 결과를 재사용한다.
// ----------------------------------------------------------------------------

// verdict.action 을 한국어 사용자 관점의 3개 버킷으로 묶는다.
//   buy    : NEW_ENTRY · SCALE_IN  → "매수·분할매수 추천"
//   hold   : HOLD_WAIT · HOLD · AVOID · SHORT_TRADE → "관망·눌림목 대기"
//   reduce : TRIM · REDUCE → "비중축소 (참고)"
export type RecommendationCategory = "buy" | "hold" | "reduce";

// buy 버킷을 다시 두 갈래로 세분화 — UI 노출 분리용.
//   new_entry : NEW_ENTRY (단·장기 모두 양호) — 신규 진입 우위
//   scale_in  : SCALE_IN (단기 SELL/ADD + 장기 BUY/ADD) — 눌림 분할 매수
// hold/reduce 버킷에는 의미 없으므로 buy 버킷에서만 사용.
export type RecommendationSubCategory = "new_entry" | "scale_in";

// 오늘 시장 컨텍스트 — 추천 헤더에 한 줄로 표시 + 섹터 보너스 계산 입력으로 사용.
export interface MarketContext {
  soxRate: number; // ^SOX 등락률 (0.025 = +2.5%)
  fxRate: number; // KRW=X 등락률 (양수면 원화 약세)
  nasdaqRate: number; // NQ=F 선물 등락률
  vix: number; // VIX 수치
  // 컨텍스트 한 줄 요약 — UI 헤더에 그대로 노출.
  // 예: "오늘 시장: SOX +2.5%, 환율 +0.8% → 반도체·수출주 우호"
  summary: string;
  // 우호적인 섹터 라벨 (예: ["반도체", "수출주"]) — UI 부가 노출/툴팁용.
  favorableSectors: SectorTag[];
}

// 한 종목당 추천 1건. 단·장기 시그널, 메인 verdict, 점수, 컨텍스트 가산점을 한 번에 들고 있다.
export interface Recommendation {
  code: string;
  name: string;
  kind: SymbolKind;
  sector: SectorTag;
  // 현재 시세 — 카드 노출용 (전체 Quote 가 아닌 핵심 필드만 노출해 응답 크기 절감)
  price: number;
  changeRate: number;
  currency?: string;
  // 분석 결과 — 메인 verdict + 단·장기 시그널 + 외부 리스크
  verdict: ActionVerdict;
  shortTerm: SignalDetail;
  longTerm: SignalDetail;
  externalRisk: NewsRiskAssessment;
  // 점수 (analyze 결과 기준)
  buyScore: number; // 0~100
  heatScore: number; // 0~100
  longScore: number; // 0~100
  // 시장 컨텍스트 가산점 — 정렬에만 영향, 분석 자체는 안 바꿈
  contextBonus: number;
  // 정렬 키: buyScore + contextBonus
  rankScore: number;
  // 카테고리 (buy/hold/reduce)
  category: RecommendationCategory;
  // buy 버킷 내 세분화 — buy일 때만 의미. hold/reduce에서는 undefined.
  subCategory?: RecommendationSubCategory;
  // 한 줄 이유 — verdict.headline 미러
  headline: string;
  // 한국 종목인 경우 시장경보(투자주의 등) — 없으면 null
  marketAlert?: MarketAlert | null;
}

export interface RecommendationsResponse {
  generatedAt: number;
  context: MarketContext;
  // 응답에 포함된 종목들의 섹터 목록 (탭 UI 용, 가나다순)
  sectors: SectorTag[];
  // verdict 우선순위 > rankScore desc > heatScore asc 로 정렬된 전체 추천 목록
  items: Recommendation[];
  // 분석 실패한 종목들 (error 메시지). 클라이언트는 디버그 영역에만 노출.
  errors: Record<string, string>;
  // 빌드 소요 시간 (디버그/UI 안내용)
  buildMs: number;
  // 이 응답이 캐시에서 나온 것인지
  cached: boolean;
}
