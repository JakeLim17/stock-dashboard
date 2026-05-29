import type {
  AnalysisResult,
  AnalystConsensus,
  FlowData,
  MarketIndicator,
  Quote,
  SignalDetail,
  SignalStatus,
  TechIndicators,
  Valuation,
} from "../types";

// 분석 입력. provider에서 모은 1차 데이터.
export interface AnalyzeInput {
  quote: Quote;
  tech: TechIndicators;
  flow: FlowData;
  // 펀더멘털 보조 (캐시) — 없을 수 있음.
  consensus?: AnalystConsensus | null;
  valuation?: Valuation | null;
  // 시장 컨텍스트 (반도체 강세 여부 등 평가용)
  context: {
    semiHeat: number; // 0~100, 반도체 섹터 과열도
    nasdaqRate: number; // 나스닥 선물 등락률
    fxRate: number; // 환율 등락률 (원화 약세면 양수)
    vix: number; // VIX 수치
    overseasNightRate?: number | null; // 해외 개별 GDR/DR 등락률
  };
}

// 단기 룰 hit — 추격 위험(heat) / 매수 우위(buy) 양방향.
interface ShortTermHit {
  label: string;
  heat: number; // +면 위험↑
  buy: number; // +면 매수우위↑
  good: boolean; // 화면 노출용 (긍정/부정)
}

// 장기 룰 hit — base 50에서 한 방향 점수만 가감.
interface LongTermHit {
  label: string;
  score: number; // +면 장기 매력↑, −면 매력↓
  good: boolean;
}

function isRegularMarket(marketState?: string): boolean {
  return (marketState ?? "").toUpperCase() === "REGULAR";
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

// ----------------------------------------------------------------------------
// 단기 룰 — RSI / 이평 / 등락률 / 수급 / 반도체·환율·VIX·나스닥·해외 야간.
// 펀더(컨센·PER·PBR) 룰은 장기 갈래로 이동했다. 단, 단기 헤드라인 분기에서는
// longTerm.signal 을 함께 본다 (예: 단기 HOLD인데 장기 BUY → "장기 양호…").
// ----------------------------------------------------------------------------
function evaluateShortTermRules(input: AnalyzeInput): ShortTermHit[] {
  const { quote, tech, flow, context } = input;
  const hits: ShortTermHit[] = [];
  const flowWeight = flow.source === "mock" ? 0.35 : 1;
  const flowSuffix = flow.source === "mock" ? " (mock 가중치 축소)" : "";

  // 1) 단기 등락률
  const r = quote.changeRate;
  if (r >= 0.04) hits.push({ label: "오늘 +4% 이상 급등", heat: 25, buy: -10, good: false });
  else if (r >= 0.02) hits.push({ label: "오늘 +2% 강세", heat: 10, buy: 0, good: true });
  else if (r <= -0.03) hits.push({ label: "오늘 -3% 이상 급락", heat: -10, buy: 15, good: true });

  // 2) RSI 과열/침체
  if (tech.rsi14 != null) {
    if (tech.rsi14 >= 75) hits.push({ label: `RSI ${tech.rsi14.toFixed(0)} 과열`, heat: 20, buy: -10, good: false });
    else if (tech.rsi14 >= 65) hits.push({ label: `RSI ${tech.rsi14.toFixed(0)} 다소 과열`, heat: 10, buy: -5, good: false });
    else if (tech.rsi14 <= 30) hits.push({ label: `RSI ${tech.rsi14.toFixed(0)} 침체권`, heat: -15, buy: 20, good: true });
    else if (tech.rsi14 <= 40) hits.push({ label: `RSI ${tech.rsi14.toFixed(0)} 약세권`, heat: -5, buy: 10, good: true });
  }

  // 3) 이평선 정배열 / 데드크로스
  if (tech.sma5 != null && tech.sma20 != null) {
    if (tech.sma5 > tech.sma20 * 1.01) hits.push({ label: "단기 이평 상향 (5>20)", heat: 5, buy: 10, good: true });
    if (tech.sma5 < tech.sma20 * 0.99) hits.push({ label: "단기 이평 하향 (5<20)", heat: -5, buy: -10, good: false });
  }

  // 4) 외인 수급
  if (flow.foreignNet != null) {
    if (flow.foreignNet > 5e10) hits.push({ label: `외인 +500억 이상 순매수${flowSuffix}`, heat: Math.round(-5 * flowWeight), buy: Math.round(20 * flowWeight), good: true });
    else if (flow.foreignNet > 1e10) hits.push({ label: `외인 순매수${flowSuffix}`, heat: 0, buy: Math.round(10 * flowWeight), good: true });
    else if (flow.foreignNet < -5e10) hits.push({ label: `외인 -500억 이상 순매도${flowSuffix}`, heat: Math.round(5 * flowWeight), buy: Math.round(-20 * flowWeight), good: false });
    else if (flow.foreignNet < -1e10) hits.push({ label: `외인 순매도${flowSuffix}`, heat: Math.round(5 * flowWeight), buy: Math.round(-10 * flowWeight), good: false });
  }

  // 5) 기관 수급
  if (flow.institutionNet != null) {
    if (flow.institutionNet > 3e10) hits.push({ label: `기관 순매수${flowSuffix}`, heat: 0, buy: Math.round(10 * flowWeight), good: true });
    else if (flow.institutionNet < -3e10) hits.push({ label: `기관 순매도${flowSuffix}`, heat: 0, buy: Math.round(-10 * flowWeight), good: false });
  }

  // 6) 시장 컨텍스트 — 반도체 종목은 SOX/NVDA에 민감
  if (context.semiHeat >= 70) hits.push({ label: "미국 반도체 과열", heat: 10, buy: -10, good: false });
  if (context.semiHeat <= 35) hits.push({ label: "미국 반도체 약세", heat: 5, buy: -15, good: false });
  if (context.semiHeat > 40 && context.semiHeat < 65) hits.push({ label: "미국 반도체 안정", heat: 0, buy: 5, good: true });

  // 7) 환율 — 원화 급격한 약세는 외인 이탈 신호
  if (context.fxRate >= 0.005) hits.push({ label: "환율 급등 (원화 약세)", heat: 10, buy: -10, good: false });
  if (context.fxRate <= -0.005) hits.push({ label: "환율 안정/하락", heat: -5, buy: 5, good: true });

  // 8) VIX
  if (context.vix >= 25) hits.push({ label: `VIX ${context.vix.toFixed(0)} 변동성 경계`, heat: 15, buy: -10, good: false });

  // 9) 나스닥 선물
  if (context.nasdaqRate >= 0.005) hits.push({ label: "나스닥 선물 강세", heat: 0, buy: 10, good: true });
  if (context.nasdaqRate <= -0.01) hits.push({ label: "나스닥 선물 약세", heat: 10, buy: -10, good: false });

  // 10) 해외 개별 야간 지표(GDR/DR). 토글이 켜졌을 때만 들어온다.
  if (context.overseasNightRate != null) {
    const nr = context.overseasNightRate;
    if (nr >= 0.03) hits.push({ label: "해외 개별 야간 +3% 이상", heat: 8, buy: 12, good: true });
    else if (nr >= 0.01) hits.push({ label: "해외 개별 야간 강세", heat: 3, buy: 8, good: true });
    else if (nr <= -0.03) hits.push({ label: "해외 개별 야간 -3% 이상", heat: 12, buy: -12, good: false });
    else if (nr <= -0.01) hits.push({ label: "해외 개별 야간 약세", heat: 8, buy: -8, good: false });
  }

  return hits;
}

function decideShortTermSignal(
  heat: number,
  buy: number,
  marketState?: string
): SignalStatus {
  // 장중/비장중 임계값을 분리한다.
  // 강한 매수 근거가 있으면 과열만으로 바로 관망/축소로 밀지 않는다.
  if (isRegularMarket(marketState)) {
    if (heat >= 80 && buy <= 35) return "SELL";
    if (buy >= 68 && heat <= 55) return "BUY";
    if (buy >= 90 && heat <= 80) return "ADD"; // 강한 매수 근거가 단기 과열을 덮음
    if (buy >= 56 && heat <= 62) return "ADD";
    if (heat >= 65 && buy < 60) return "WATCH";
    if (buy <= 35 && heat <= 45) return "WATCH";
    return "HOLD";
  }

  // 비장중은 보수적으로 보되, 해외 야간 강세 같은 보조 근거가 있으면 기회를 남긴다.
  if (heat >= 82 && buy <= 32) return "SELL";
  if (buy >= 72 && heat <= 52) return "BUY";
  if (buy >= 90 && heat <= 80) return "ADD";
  if (buy >= 58 && heat <= 62) return "ADD";
  if (heat >= 65 && buy < 62) return "WATCH";
  if (buy <= 35 && heat <= 45) return "WATCH";
  return "HOLD";
}

// ----------------------------------------------------------------------------
// 장기 룰 — 컨센서스 / 추정 PER / PBR / 애널 분포.
// base 50점에서 룰별 가감산. 장기는 시점과 무관 → 시장 상태 무시.
// ----------------------------------------------------------------------------
function evaluateLongTermRules(input: {
  quote: Quote;
  consensus?: AnalystConsensus | null;
  valuation?: Valuation | null;
}): LongTermHit[] {
  const { quote, consensus, valuation } = input;
  const hits: LongTermHit[] = [];

  const per = valuation?.per ?? quote.valuation?.per ?? null;
  const forwardPer =
    valuation?.forwardPer ?? quote.valuation?.forwardPer ?? null;
  const pbr = valuation?.pbr ?? quote.valuation?.pbr ?? null;

  // 1) 컨센 평균 대비 상승여력 (가장 큰 신호)
  if (consensus?.upsidePercent != null) {
    const up = consensus.upsidePercent;
    const upPct = (up * 100).toFixed(0);
    if (up >= 0.25)
      hits.push({ label: `컨센서스 평균 +${upPct}% 상승여력 — 큰 폭`, score: 25, good: true });
    else if (up >= 0.15)
      hits.push({ label: `컨센서스 평균 +${upPct}% 상승여력`, score: 18, good: true });
    else if (up >= 0.05)
      hits.push({ label: `컨센서스 평균 +${upPct}% 여력`, score: 10, good: true });
    else if (up > -0.05)
      hits.push({ label: `컨센서스 평균 ±${upPct}% — 적정 구간`, score: 0, good: true });
    else if (up > -0.15)
      hits.push({ label: `컨센서스 평균 ${upPct}% — 여력 제한`, score: -10, good: false });
    else if (up > -0.25)
      hits.push({ label: `컨센서스 평균 ${upPct}% — 목표가 초과`, score: -20, good: false });
    else hits.push({ label: `컨센서스 평균 ${upPct}% — 25% 이상 고평가`, score: -30, good: false });
  }

  // 2) 컨센 최고가 보너스 — mean이 박살나도 high가 크면 강세 시나리오 존재.
  //    SK하이닉스 케이스(최고 +71%) 대응: 50~80% 구간을 두텁게 보정.
  if (consensus?.targetHigh != null && quote.price > 0) {
    const highUp = consensus.targetHigh / quote.price - 1;
    if (highUp >= 0.8)
      hits.push({ label: `최고 컨센서스 +${(highUp * 100).toFixed(0)}% — 강세 시나리오 큼`, score: 20, good: true });
    else if (highUp >= 0.5)
      hits.push({ label: `최고 컨센서스 +${(highUp * 100).toFixed(0)}% — 강세 시나리오 존재`, score: 15, good: true });
    else if (highUp >= 0.3)
      hits.push({ label: `최고 컨센서스 +${(highUp * 100).toFixed(0)}% 여지`, score: 8, good: true });
  }

  // 3) 추정 PER (forwardPer) — "내년 실적 대비" 저평가/고평가
  if (forwardPer != null) {
    if (forwardPer < 8)
      hits.push({ label: `추정PER ${forwardPer.toFixed(1)}배 — 매우 저평가`, score: 15, good: true });
    else if (forwardPer < 10)
      hits.push({ label: `추정PER ${forwardPer.toFixed(1)}배 저평가`, score: 10, good: true });
    else if (forwardPer < 14)
      hits.push({ label: `추정PER ${forwardPer.toFixed(1)}배 적정 이하`, score: 5, good: true });
    else if (forwardPer > 40)
      hits.push({ label: `추정PER ${forwardPer.toFixed(0)}배 — 다음 실적 대비도 부담`, score: -15, good: false });
    else if (forwardPer > 25)
      hits.push({ label: `추정PER ${forwardPer.toFixed(0)}배 — 다음 실적 부담`, score: -5, good: false });
  }

  // 4) PBR
  if (pbr != null) {
    if (pbr < 1)
      hits.push({ label: `PBR ${pbr.toFixed(2)}배 — 청산가치 이하`, score: 5, good: true });
    else if (pbr >= 8)
      hits.push({ label: `PBR ${pbr.toFixed(1)}배 — 자산가치 대비 매우 부담`, score: -15, good: false });
    else if (pbr >= 5)
      hits.push({ label: `PBR ${pbr.toFixed(1)}배 자산가치 부담`, score: -8, good: false });
  }

  // 5) 애널리스트 분포 (Yahoo 기반). 한국 종목은 분포가 0,0,0,0,0이면 룰 미적용.
  if (consensus) {
    const total =
      consensus.strongBuy +
      consensus.buy +
      consensus.hold +
      consensus.sell +
      consensus.strongSell;
    if (total >= 5) {
      const strongBuyShare = consensus.strongBuy / total;
      const buyShare = (consensus.strongBuy + consensus.buy) / total;
      const holdShare = consensus.hold / total;
      const sellShare = (consensus.sell + consensus.strongSell) / total;

      if (strongBuyShare >= 0.3 && consensus.sell + consensus.strongSell === 0) {
        hits.push({
          label: `Strong Buy ${(strongBuyShare * 100).toFixed(0)}% · 매도 0`,
          score: 15,
          good: true,
        });
      } else if (buyShare >= 0.7) {
        hits.push({
          label: `매수 의견 ${(buyShare * 100).toFixed(0)}% 우세`,
          score: 10,
          good: true,
        });
      }

      if (sellShare >= 0.2) {
        hits.push({
          label: `매도 의견 ${(sellShare * 100).toFixed(0)}% — 분포 부정적`,
          score: -15,
          good: false,
        });
      } else if (holdShare >= 0.5) {
        hits.push({
          label: `Hold ${(holdShare * 100).toFixed(0)}% — 의견 보수적`,
          score: 0,
          good: false,
        });
      }
    }
  }

  return hits;
}

// 장기 신호 결정. 시장 상태(REGULAR/CLOSED)는 무시 — 장기는 시점과 무관.
function decideLongTermSignal(score: number): SignalStatus {
  if (score >= 80) return "BUY";
  if (score >= 65) return "ADD";
  if (score >= 45) return "HOLD";
  if (score >= 30) return "WATCH";
  return "SELL";
}

// ----------------------------------------------------------------------------
// 헤드라인 — 단기는 단·장기 조합 메시지를, 장기는 단순 신호 메시지를 만든다.
// ----------------------------------------------------------------------------

function shortTermHeadline(
  shortSignal: SignalStatus,
  longSignal: SignalStatus,
  heat: number
): string {
  const longBullish = longSignal === "BUY" || longSignal === "ADD";
  const longBearish = longSignal === "WATCH" || longSignal === "SELL";

  // 단·장기 조합 통합 메시지 우선
  if ((shortSignal === "HOLD" || shortSignal === "WATCH") && longBullish) {
    return "장기 펀더 양호, 단기 추격 자제 — 눌림목 대기";
  }
  if ((shortSignal === "BUY" || shortSignal === "ADD") && longBullish) {
    return "단·장기 모두 양호 — 진입 우위";
  }
  if ((shortSignal === "BUY" || shortSignal === "ADD") && longBearish) {
    return "단기 모멘텀 살아있으나 장기 고평가 — 짧게 가져갈 것";
  }
  if (shortSignal === "SELL" && longSignal === "SELL") {
    return "단·장기 모두 약세 — 비중 축소 검토";
  }
  // 단기 SELL + 장기 BUY/ADD (SK하이닉스류) — 단기 차익실현 + 분할 재진입.
  if (shortSignal === "SELL" && longBullish) {
    return "단기 과열은 차익실현, 장기 매력 큼 — 분할 재진입 기회";
  }

  // 기본 단기 메시지
  switch (shortSignal) {
    case "BUY":
      return "지금 신규 진입 우위";
    case "ADD":
      return "눌림목 분할매수 우위";
    case "HOLD":
      return "보유 유지 / 추격은 자제";
    case "WATCH":
      return heat >= 60 ? "과열 구간 — 눌림 확인" : "방향성 확인 필요";
    case "SELL":
      return "과열 + 약세 신호 — 일부 익절 검토";
  }
}

function longTermHeadline(signal: SignalStatus): string {
  switch (signal) {
    case "BUY":
      return "장기 매력 매우 큼 — 신규 진입 고려";
    case "ADD":
      return "장기 컨센서스 양호 — 분할 매수 적정";
    case "HOLD":
      return "장기 보유 무난";
    case "WATCH":
      return "장기 매력 제한적 — 비중 유지";
    case "SELL":
      return "컨센 대비 고평가 — 비중 축소 고려";
  }
}

// ----------------------------------------------------------------------------
// 메인 entry — 단기/장기를 각각 평가해 AnalysisResult로 합친다.
// ----------------------------------------------------------------------------
export function analyze(input: AnalyzeInput): AnalysisResult {
  // 단기
  const shortHits = evaluateShortTermRules(input);
  let heat = 50;
  let buy = 50;
  for (const h of shortHits) {
    heat += h.heat;
    buy += h.buy;
  }
  heat = clamp(heat);
  buy = clamp(buy);
  const shortSignal = decideShortTermSignal(
    heat,
    buy,
    input.quote.marketState
  );

  // 장기
  const longHits = evaluateLongTermRules({
    quote: input.quote,
    consensus: input.consensus,
    valuation: input.valuation,
  });
  let longScore = 50;
  for (const h of longHits) longScore += h.score;
  longScore = clamp(longScore);
  const longSignal = decideLongTermSignal(longScore);

  // 헤드라인 — 단기는 단·장기 조합 통합 메시지 우선
  const shortBaseHeadline = shortTermHeadline(shortSignal, longSignal, heat);
  const shortHeadline = isRegularMarket(input.quote.marketState)
    ? shortBaseHeadline
    : `${shortBaseHeadline} (비장중 기준)`;
  const longHeadline = longTermHeadline(longSignal);

  // reasons — 단기는 영향 큰 순 3개
  const shortReasons = shortHits
    .map((h) => ({ ...h, weight: Math.abs(h.heat) + Math.abs(h.buy) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((h) => `${h.good ? "+ " : "− "}${h.label}`);
  if (!isRegularMarket(input.quote.marketState)) {
    shortReasons.unshift("· 비장중이라 종가/야간 지표 기준으로 판정");
  }
  if (shortReasons.length === 0) shortReasons.push("특이 신호 없음");

  // 장기 reasons — score 절대값 큰 순 3개
  const longReasons = longHits
    .map((h) => ({ ...h, weight: Math.abs(h.score) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((h) => `${h.good ? "+ " : "− "}${h.label}`);
  if (longReasons.length === 0) longReasons.push("컨센·밸류 데이터 부족");

  // 단기 종합 점수 — 매수우위 - 과열 + 50 (0~100 정규화)
  const shortScore = clamp(50 + Math.round((buy - heat) / 2));

  const shortTerm: SignalDetail = {
    signal: shortSignal,
    headline: shortHeadline,
    reasons: shortReasons.slice(0, 3),
    score: shortScore,
  };
  const longTerm: SignalDetail = {
    signal: longSignal,
    headline: longHeadline,
    reasons: longReasons.slice(0, 3),
    score: longScore,
  };

  return {
    shortTerm,
    longTerm,
    // 백워드 호환 미러
    signal: shortTerm.signal,
    heatScore: heat,
    buyScore: buy,
    headline: shortTerm.headline,
    reasons: shortTerm.reasons,
  };
}

// 시장 분위기 라벨링 (강세/중립/약세)
export function marketMoodLabel(
  indicators: MarketIndicator[]
): "강세" | "중립" | "약세" {
  const nasdaq = indicators.find((i) => i.code === "NQ=F");
  const sox = indicators.find((i) => i.code === "^SOX");
  const vix = indicators.find((i) => i.code === "^VIX");
  const fx = indicators.find((i) => i.code === "KRW=X");

  let score = 0;
  if (nasdaq) score += nasdaq.changeRate * 100;
  if (sox) score += sox.changeRate * 100 * 1.5;
  if (vix && vix.value >= 25) score -= 1;
  if (fx && fx.changeRate >= 0.005) score -= 1;

  if (score >= 1) return "강세";
  if (score <= -1) return "약세";
  return "중립";
}
