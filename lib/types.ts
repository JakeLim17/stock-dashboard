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
  | "항공"
  // ── 2026-06 카탈로그 확장 — 한국 신규 14개 분야 ────────────
  | "로봇"
  | "반도체장비"
  | "반도체소재"
  | "신재생"
  | "수소"
  | "의료미용"
  | "화장품"
  | "식음료"
  | "콘텐츠"
  | "여행레저"
  | "유통"
  | "건설"
  | "디스플레이"
  | "전선"
  | "AI소프트웨어"
  | "물류"
  // ── 미국 빅테크 — 한국어 분류로 통일 ───────────────────────
  | "글로벌IT"
  | "글로벌EV"
  | "글로벌반도체"
  | "글로벌AI"
  // ── 2026-06 미국 카탈로그 확장 — 섹터별 대표주 묶음 ────────
  | "글로벌소프트웨어"   // CRM/ORCL/NOW/ADBE
  | "글로벌헬스케어"     // LLY/UNH
  | "글로벌핀테크"       // V/MA
  | "글로벌소비재"       // COST/WMT/HD
  | "중국ADR"            // BABA/PDD
  | "글로벌에너지"       // XOM/CVX
  | "글로벌암호화폐";    // MSTR/COIN (BTC 노출)

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
  // ─── 분야 "대장주" 마크 (재미 요소) ─────────────────────────────────────
  // 시총·시장 영향력 기준 분야 1위 종목에만 true. 너무 많이 붙으면 의미가 퇴색하므로
  // 분야 내 명백한 절대 1위에만 마킹한다 (2·3위는 마킹 X).
  isSectorLeader?: boolean;
  // 배지에 표시되는 한국어 짧은 라벨. 예: "반도체 대장", "MLCC 대장", "AI 반도체 대장".
  // isSectorLeader가 true일 때만 의미가 있다.
  sectorLeaderLabel?: string;
  // 표시·환산용 통화. 한국 종목·환율은 "KRW", 미국 종목은 "USD".
  // 비워두면 currencyOf(code) 헬퍼가 코드 형태로 추정한다(.KS/.KQ → KRW, 그 외 → USD).
  // 수치 계산 자체엔 영향 없음. 원화 병기·포맷 분기에만 사용.
  currency?: "KRW" | "USD";
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
  // 오늘 정규장 시가. 갭상승/갭하락 시그널 평가 등에 사용. Yahoo regularMarketOpen.
  open?: number | null;
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
  //
  // 주의: 네이버 dealTrendInfos는 "일별 누적"이라 분 단위 실시간 변동을 표현하지 못한다.
  // 진짜 실시간 외인/프로그램 매매는 KIS API가 필요하다 — UI에 그 한계를 명시한다.
  foreignNet: number | null;
  institutionNet: number | null;
  individualNet?: number | null;
  // 5일 누적 — 각 거래일 종가 × 해당일 순매수 수량의 합.
  foreignNet5d?: number | null;
  institutionNet5d?: number | null;
  individualNet5d?: number | null;
  // 데이터 출처 — UI에 mock 표시용
  source?: "naver" | "kis" | "mock";
  // 수급 데이터를 받아온 시각 (epoch ms). UI 신선도 라벨용. 최초엔 quote.fetchedAt에 동기화.
  fetchedAt?: number;
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

// 호재 점수 — Risk와 대칭 구조. 수주·실적·목표상향·신제품 등 긍정 이벤트.
//
// verdict shift에는 안전장치 부족으로 영향 주지 않고 (잘못된 매칭/펌프 위험),
// AnalysisResult.externalOpportunity 로 노출만 한다. UI는 OpportunityBadge·
// AnalysisBox·NewsPanel에서 활용.
export type NewsOpportunityLevel = "low" | "medium" | "high";

export interface NewsOpportunityDriver {
  label: string;
  category: string;
  headline: string;
  date: number;
  weight: number;
  contribution: number;
}

export interface OpportunityAssessment {
  level: NewsOpportunityLevel;
  score: number;
  drivers: NewsOpportunityDriver[];
  matchCount: number;
}

// ─── 변동성("사팔사팔") 점수 ────────────────────────────────────────────────
// 외인/기관/개인이 단시간에 사고팔며 가격이 위아래로 흔들리는 종목을
// 정량화·시각화해서 매매 의사결정에 활용하기 위한 점수.
//   stable    : 0~30   — 안정 (배지 미노출)
//   moderate  : 30~60  — 변동성 보통 (회색)
//   high      : 60~80  — 고변동
//   gambling  : 80~100 — 도박장 (강한 warn)
// drivers는 점수에 기여한 raw signal 라벨 + 기여 점수. UI 툴팁/근거 표시용.
export type VolatilityLevel = "stable" | "moderate" | "high" | "gambling";

export interface VolatilityDriver {
  label: string;
  contribution: number; // 가중 합산 후 실제 점수 기여(소수점 첫째자리 반올림)
}

export interface VolatilityAssessment {
  score: number; // 0~100
  level: VolatilityLevel;
  drivers: VolatilityDriver[];
  // 분봉 신호가 합산에 들어갔으면 true (장중 한국 종목만). UI 안내에 사용.
  intradayUsed?: boolean;
}

// 네이버 finance.naver.com/research 의 종목별 리서치 리포트 목록.
// wisereport(증권사별 목표가 표)와 다르게 "오늘 발표된 리포트 제목 + PDF 직링크"가 핵심.
// 사용자는 컨센서스 탭에서 최근 N개 리포트를 한눈에 보고 PDF 새 탭으로 열어보면 된다.
export interface NaverResearchReport {
  title: string;
  brokerName: string;
  publishDate: number; // epoch ms
  reportUrl?: string;  // 네이버 리포트 상세 페이지 링크
  pdfUrl?: string;     // PDF 직접 다운로드 링크 (있을 때만)
}

export interface AnalysisResult {
  // 새 구조 — 단기/장기 분리
  shortTerm: SignalDetail;
  longTerm: SignalDetail;
  // 외부 이벤트 리스크 (트럼프·관세·지정학·정책 등). low/medium/high.
  externalRisk: NewsRiskAssessment;
  // 외부 호재 점수 — 수주·실적호조·목표상향·신제품 등.
  // verdict shift에는 영향 없고 (안전장치 부족), 표시·근거 전용.
  externalOpportunity?: OpportunityAssessment;
  // 변동성("사팔사팔") 점수 — 0~100, 도박장 등급 분류.
  // verdict shift에는 영향을 주지 않고(안전장치 유지), 배지·reasons에서만 표시.
  volatility?: VolatilityAssessment;
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
  // 1일(오늘) 진폭 예측 — ATR(14) 또는 GBM σ 기반의 예상 high/low 밴드.
  // PredictionHero 한 줄 노출, StockCard "예상 변동 범위" 박스에 사용.
  // 분봉 어댑터가 살아 있고 장중이면 intraday Parkinson vol을 가중해 정밀화한다.
  intradayRange?: {
    expectedHigh: number;
    expectedLow: number;
    // (high - low) / 2 / price. 0.018 = ±1.8%
    expectedRangePct: number;
    // "atr" | "sigma" | "intraday-blend" — 디버그/디스플레이용 출처 라벨
    source?: "atr" | "sigma" | "intraday-blend";
  } | null;
  // PriceRange 계산에 사용한 변동성 모델 메타.
  //   kind         : "ewma-t" = EWMA σ + t(df=5) quantile (fat-tail) / "stddev-normal" = 단순 stddev + 정규분포 폴백
  //   lambda       : EWMA 감쇠 계수 (기본 0.94)
  //   df           : t-분포 자유도 (기본 5)
  //   confidence   : 0.95 = 95% 양측 신뢰구간
  //   dailySigma   : 부풀림 적용 전 일일 σ (UI σ 배지에 표시)
  //   adjustedDailySigma : 이벤트 부풀림 곱한 후 일일 σ (range 계산에 실제 사용)
  // 옛 스냅샷 호환을 위해 optional. 신규 응답엔 항상 채움.
  volatilityModel?: {
    kind: "ewma-t" | "stddev-normal";
    lambda?: number;
    df?: number;
    confidence: number;
    dailySigma: number;
    adjustedDailySigma: number;
  } | null;
  // 임박 이벤트로 σ 가 부풀려진 경우 메타. factor ≤ 1.05 면 null (미미한 영향은 노출 X).
  //   factor       : 1 + α (예: 1.6 = +60%)
  //   eventKind    : earnings | fomc | kospi_expiry | dividend
  //   eventLabel   : 사용자 표시용 한국어 라벨 (예: "삼성전자 실적 발표")
  //   shortLabel   : 짧은 카테고리 ("실적" / "FOMC" / "옵션만기" / "배당락")
  //   daysToEvent  : D-N (양수=미래, 0=오늘, 음수=과거)
  eventVolatility?: {
    factor: number;
    eventKind: EventKind;
    eventLabel: string;
    shortLabel: string;
    daysToEvent: number;
  } | null;
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

  // ── 네이버 리서치 리포트 목록 (한국 종목 한정) ─────────────────────
  // wisereport reports[]는 "증권사별 목표가 표"라 제목·PDF 직링크가 없다.
  // 별도로 finance.naver.com/research 에서 최근 N건의 리서치 제목·PDF를 끌어와 노출.
  // 사용자가 컨센서스 탭 하단에서 한 번 보고 PDF를 새 탭으로 열 수 있게 한다.
  recentReports?: NaverResearchReport[];
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

// ─── 시그널 마크 ────────────────────────────────────────────────────────────
// 종목 카드 헤더에 작게 노출되는 "한눈에 보이는 신호".
// 신고가/신저가/연속/거래량폭발/외인픽/개미무덤 등 빠른 인지용.
//
// tone:
//   good    : 호재/상승 신호 (text-up 계열)
//   bad     : 악재/하락 신호 (text-down 계열)
//   warn    : 주의/관심 신호 (text-warn 계열)
//   neutral : 중립 (회색 계열)
//
// 동시 노출은 우선순위 컷으로 최대 3~4개 — UI에서 잘라낸다.
export interface SignalMark {
  // 안정 키 (저장·매핑용). 예: "new_52w_high"
  key: string;
  // 사용자 노출 이모지. 예: "🚀"
  emoji: string;
  // 한국어 짧은 라벨. 예: "52주 신고가"
  label: string;
  // 색상 분기
  tone: "good" | "bad" | "warn" | "neutral";
  // 호버 시 부연 설명 (있을 때만 title)
  detail?: string;
  // 동시 노출 시 우선순위 — 작을수록 먼저 노출 (우선순위 컷에 사용)
  priority?: number;
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
  // 시그널 마크 (이모지 배지) — 신고가/거래량폭발/외인픽 등 한눈에 보이는 신호.
  // evaluateSignalMarks(quote, history, flow)로 매번 재계산되며, 데이터 부족 시
  // 빈 배열 또는 undefined.
  signalMarks?: SignalMark[];
  // 이 종목과 관련된 다가올 가격 이벤트 (실적·배당). 다음 60일 이내, 날짜 오름차순.
  // 매크로 이벤트(FOMC/KOSPI 만기/휴장)는 DashboardSnapshot.macroEvents에만 노출한다.
  upcomingEvents?: EventItem[];
  // 프로그램 매매 (당일 누적) — 한국 종목 + KIS 활성 시만 채워짐.
  programTrade?: ProgramTradeData | null;
  // 공매도 잔고/거래 정보 — 한국 종목 + KIS 활성 시만 채워짐.
  shortBalance?: ShortBalanceData | null;
}

// ─── KIS 신규 데이터 타입 ────────────────────────────────────────────────────
// KIS Open API가 활성일 때만 채워지는 추가 데이터들. KIS 미사용 시 모두 null.

// 프로그램 매매 (당일 누적) — 차익/비차익 매수·매도·순매수.
// 단위는 원(KRW). 거래대금 데이터가 없으면 null.
export interface ProgramTradeData {
  // 차익거래 (Arbitrage)
  arbitrageBuy: number | null;
  arbitrageSell: number | null;
  arbitrageNet: number | null;
  // 비차익거래 (Non-Arbitrage)
  nonArbitrageBuy: number | null;
  nonArbitrageSell: number | null;
  nonArbitrageNet: number | null;
  // 합계 순매수 — 프로그램 매매 전체 임팩트
  totalNet: number | null;
  fetchedAt: number;
}

// 호가 한 레벨 — 1호가가 가장 가까운 가격
export interface AskingPriceLevel {
  // 매도호가
  askPrice: number;
  askQty: number;
  // 매수호가
  bidPrice: number;
  bidQty: number;
}

// 10단계 호가 + 체결강도.
// levels[0] = 1호가(가장 가까운), levels[9] = 10호가.
export interface AskingPriceData {
  levels: AskingPriceLevel[];
  totalAskQty: number;
  totalBidQty: number;
  // 체결강도 — KIS cttr(체결강도) 응답 우선, 없으면 (총매수잔량/총매도잔량)×100 폴백.
  // 100 = 중립, > 100 = 매수 우위, < 100 = 매도 우위.
  ccldStrength: number | null;
  // 예상체결가/예상거래량 (장중 동시호가 시) — 있으면 채움
  expectedPrice?: number | null;
  expectedVolume?: number | null;
  fetchedAt: number;
}

// 실시간 체결 한 건
export interface ExecutionTick {
  // HHMMSS → epoch ms (오늘 KST 기준 합성)
  time: number;
  price: number;
  // 체결 거래량 (주)
  volume: number;
  // 매수/매도 체결 구분 — KIS는 별도 플래그 안 줘서 sign 으로만 추정 (가능하면)
  side: "buy" | "sell" | "neutral";
  changeAbs: number | null;
  changeRate: number | null;
}

// 지수 시세 — KOSPI/KOSDAQ 등 KIS 지수 API 응답.
export interface IndexQuote {
  // KIS 지수 코드: 0001 KOSPI, 1001 KOSDAQ
  code: string;
  name: string;
  value: number;
  changeAbs: number;
  changeRate: number;
  volume: number | null;
  source: "kis" | "yahoo";
  fetchedAt: number;
}

// 시장 순위 종목 한 건
export interface MarketLeader {
  rank: number;
  // 6자리 단축 코드 (예: "005930")
  code: string;
  name: string;
  price: number;
  changeAbs: number;
  changeRate: number;
  volume: number | null;
}

// 거래량/등락 순위 묶음
export type MarketLeadersKind = "volume" | "rising" | "falling";
export type MarketLeadersMarket = "all" | "kospi" | "kosdaq";

export interface MarketLeadersData {
  kind: MarketLeadersKind;
  market: MarketLeadersMarket;
  items: MarketLeader[];
  fetchedAt: number;
}

// 공매도 잔고/거래 정보.
// 종목별 잔고는 KRX 주간 공시 기반이라 API 응답이 일~수일 지연될 수 있다.
// asOf는 데이터 기준 영업일 epoch ms.
export interface ShortBalanceData {
  // 공매도 잔고 비율 (상장주식 대비) — 0.012 = 1.2%
  ratio: number | null;
  // 공매도 잔고 수량 (주)
  qty: number | null;
  // 공매도 잔고 금액 (원)
  amount: number | null;
  // 데이터 기준일 (epoch ms, KST 자정). KIS가 응답 시 채움.
  asOf: number | null;
  fetchedAt: number;
}

// ─── 이벤트 캘린더 ───────────────────────────────────────────────────────────
// 실적 발표·배당 기준일·FOMC·KOSPI 옵션 만기·휴장 등 "가격 이벤트"를
// 카드/대시보드에 D-N 형태로 노출한다.
//
// 데이터 소스:
//   earnings/dividend  : 야후 calendarEvents (미국·일부 한국 종목)
//   fomc              : 2026 hardcoded 일정 (Federal Reserve 공식)
//   kospi_expiry      : 매월 두 번째 목요일 (계산)
//   holiday           : KRX 휴장일 hardcoded
export type EventKind =
  | "earnings"
  | "dividend"
  | "fomc"
  | "kospi_expiry"
  | "holiday";

export interface EventItem {
  kind: EventKind;
  // 종목별 이벤트면 코드. 매크로면 undefined.
  symbolCode?: string;
  // 카드/리스트에 노출되는 한국어 짧은 라벨 (예: "삼성전자 실적 발표")
  label: string;
  // KST 자정 epoch ms
  date: number;
  importance: "high" | "medium" | "low";
  // 호버/툴팁용 부연
  detail?: string;
}

export interface MarketIndicator {
  code: string;
  name: string;
  value: number;
  changeRate: number;
  status: "up" | "down" | "flat" | "warn";
  hint?: string;
  // 야후 마지막 갱신 시각(epoch ms). 시장 마감 후엔 종가 시각에 박혀 있어
  // UI에서 stale 라벨(N분 전) 표시에 사용 — 매매 판단에 직접 영향.
  priceTime?: number | null;
  // 시장 상태(REGULAR/POSTPOST/CLOSED 등). stale 라벨 톤 결정과
  // "정규장 종가" 같은 안내 문구에 사용.
  marketState?: string;
  // ── 보조 시세 필드 — 카드 좁아도 함께 노출 ────────────────────
  // 전일 종가 대비 절대 변동값. 지수·환율은 % 만 보면 감이 안 잡혀
  // "+22.50" 같은 raw 변화량을 함께 보여준다.
  changeAbs?: number | null;
  // 전일 정규장 종가. 비교 기준.
  prevClose?: number | null;
  // 오늘 정규장 일중 고/저. 미국 지수는 정규장 시간에만 갱신.
  dayHigh?: number | null;
  dayLow?: number | null;
  // ── 변동성 — 일별 close 표본 기반 σ% (KRW=X 등 history 추적 인디케이터에 한정) ──
  // sigmaPct는 day 단위. 0.42 = 0.42% / day. label은 UI 노출용 짧은 문구.
  volatility?: {
    window: "1w" | "1m";
    sigmaPct: number;
    label: string;
    // 보조 — 다른 윈도우 σ도 같이 들고 있어 한 줄에 2개 표기 가능.
    secondaryWindow?: "1w" | "1m";
    secondarySigmaPct?: number;
  } | null;
  // 최근 일별 close — Sparkline(미니 추세 차트) 렌더용. 최대 ~30개.
  // 실패 또는 데이터 부족 시 undefined. 길이 < 2면 클라이언트가 자동 미렌더.
  closeHistory?: number[];
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
  // 매크로 이벤트 (FOMC, KOSPI 옵션 만기, KRX 휴장일).
  // 종목별 이벤트(실적/배당)는 StockSnapshot.upcomingEvents 에 있다.
  // EventCalendar UI가 둘을 합쳐서 한 리스트로 노출.
  macroEvents?: EventItem[];
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
  // 시그널 마크 (이모지 배지) — StockSnapshot.signalMarks와 동일 스키마.
  // 추천 카드 헤더에도 노출하기 위해 함께 계산해 내려준다.
  signalMarks?: SignalMark[];
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
