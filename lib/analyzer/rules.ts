import type {
  ActionRecommendation,
  ActionVerdict,
  AnalysisResult,
  AnalystConsensus,
  FlowData,
  MarketAlert,
  MarketAlertLevel,
  MarketIndicator,
  NewsRiskAssessment,
  OpportunityAssessment,
  Quote,
  SignalDetail,
  SignalStatus,
  TechIndicators,
  Valuation,
} from "../types";
import { emptyRiskAssessment } from "../news/riskScore";

// 분석 입력. provider에서 모은 1차 데이터.
export interface AnalyzeInput {
  quote: Quote;
  tech: TechIndicators;
  flow: FlowData;
  // 펀더멘털 보조 (캐시) — 없을 수 있음.
  consensus?: AnalystConsensus | null;
  valuation?: Valuation | null;
  // 외부 이벤트 리스크 (트럼프 주둥이·관세·지정학 등). 없으면 low로 처리.
  externalRisk?: NewsRiskAssessment | null;
  // 외부 호재 점수 — 수주·실적호조·목표상향 등. verdict shift는 안전장치 부족으로 X.
  // reasons에 첨부되고 결과에 그대로 노출만 됨.
  externalOpportunity?: OpportunityAssessment | null;
  // 시장 컨텍스트 (반도체 강세 여부 등 평가용)
  context: {
    // 0~100, 반도체 섹터 과열도. SOX/NVDA 데이터가 결손이면 null → 관련 룰 미적용.
    semiHeat: number | null;
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
/** 급락(-5%↑) + 수급 악화 시 분할 매수 보너스·강한 BUY 억제용. */
const CRASH_NET_SELL_THRESHOLD = 3e10; // 300억 순매도

function isCrashWithBadFlow(
  changeRate: number,
  flow: FlowData
): boolean {
  if (changeRate > -0.05) return false;
  if (flow.source === "mock") return false;
  const foreign = flow.foreignNet;
  const institution = flow.institutionNet;
  if (foreign == null && institution == null) return false;
  const f = foreign ?? 0;
  const i = institution ?? 0;
  if (f < 0 && i < 0) return true;
  return -(f + i) > CRASH_NET_SELL_THRESHOLD;
}

function evaluateShortTermRules(input: AnalyzeInput): ShortTermHit[] {
  const { quote, tech, flow, context } = input;
  const hits: ShortTermHit[] = [];
  // mock 수급은 해외 등 가짜 값 — 룰 전체 스킵 (가중치 0과 동일).
  const flowWeight = flow.source === "mock" ? 0 : 1;
  const flowSuffix = "";

  // 1) 단기 등락률
  //    한국 시장 상한가/하한가는 ±30%. ±29% 이상이면 별도 룰로 처리해
  //    단순 "+4% 이상 급등"과 다르게 점수 가산하고 reason에 명시.
  const r = quote.changeRate;
  const crashBadFlow = isCrashWithBadFlow(r, flow);
  if (r >= 0.295) hits.push({ label: "상한가 도달 (+30%) — 시장경보 위험권", heat: 40, buy: -20, good: false });
  else if (r >= 0.04) hits.push({ label: "오늘 +4% 이상 급등", heat: 25, buy: -10, good: false });
  else if (r >= 0.02) hits.push({ label: "오늘 +2% 강세", heat: 10, buy: 0, good: true });
  else if (r <= -0.295) hits.push({ label: "하한가 도달 (-30%) — 단기 반등 vs 추가 하락 분기", heat: 0, buy: 25, good: true });
  else if (r <= -0.05) {
    if (crashBadFlow) {
      hits.push({
        label: "급락 + 수급 악화 — 분할 매수 보류",
        heat: 8,
        buy: -12,
        good: false,
      });
    } else {
      hits.push({ label: "오늘 -5% 이상 급락", heat: -5, buy: 10, good: true });
    }
  } else if (r <= -0.03) {
    hits.push({
      label: "오늘 -3% 이상 급락",
      heat: -10,
      buy: 8,
      good: true,
    });
  }

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

  // 4) 외인 수급 — mock 이면 flowWeight=0 으로 전체 스킵
  if (flowWeight > 0 && flow.foreignNet != null) {
    if (flow.foreignNet > 5e10) hits.push({ label: `외인 +500억 이상 순매수${flowSuffix}`, heat: Math.round(-5 * flowWeight), buy: Math.round(20 * flowWeight), good: true });
    else if (flow.foreignNet > 1e10) hits.push({ label: `외인 순매수${flowSuffix}`, heat: 0, buy: Math.round(10 * flowWeight), good: true });
    else if (flow.foreignNet < -5e10) hits.push({ label: `외인 -500억 이상 순매도${flowSuffix}`, heat: Math.round(5 * flowWeight), buy: Math.round(-20 * flowWeight), good: false });
    else if (flow.foreignNet < -1e10) hits.push({ label: `외인 순매도${flowSuffix}`, heat: Math.round(5 * flowWeight), buy: Math.round(-10 * flowWeight), good: false });
  }

  // 5) 기관 수급
  if (flowWeight > 0 && flow.institutionNet != null) {
    if (flow.institutionNet > 3e10) hits.push({ label: `기관 순매수${flowSuffix}`, heat: 0, buy: Math.round(10 * flowWeight), good: true });
    else if (flow.institutionNet < -3e10) hits.push({ label: `기관 순매도${flowSuffix}`, heat: 0, buy: Math.round(-10 * flowWeight), good: false });
  }

  // 6) 시장 컨텍스트 — 반도체 종목은 SOX/NVDA에 민감.
  //    semiHeat 가 null (= SOX/NVDA 결손) 이면 해당 룰은 적용하지 않는다.
  if (context.semiHeat != null) {
    if (context.semiHeat >= 70) hits.push({ label: "미국 반도체 과열", heat: 10, buy: -10, good: false });
    if (context.semiHeat <= 35) hits.push({ label: "미국 반도체 약세", heat: 5, buy: -15, good: false });
    if (context.semiHeat > 40 && context.semiHeat < 65) hits.push({ label: "미국 반도체 안정", heat: 0, buy: 5, good: true });
  }

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

  // 11) 한국거래소 시장경보 — 단기 급등에 따른 매매 거래 정지/관리종목 위험.
  //     주인님 관점: caution은 가벼운 주의 신호, warning/risk 는 매수를 사실상 막아야 함.
  if (quote.marketAlert) {
    const ma = quote.marketAlert;
    switch (ma.level) {
      case "caution":
        hits.push({
          label: "투자주의 종목 — 단기 급등 주의",
          heat: 5,
          buy: -3,
          good: false,
        });
        break;
      case "warning":
        hits.push({
          label: "투자경고 종목 — 매매 거래정지 가능",
          heat: 20,
          buy: -15,
          good: false,
        });
        break;
      case "risk":
        hits.push({
          label: "투자위험 종목 — 추가 상승 시 거래정지",
          heat: 35,
          buy: -25,
          good: false,
        });
        break;
      case "halt":
        // 이미 거래 안 되는 상태 — heat/buy를 크게 흔들지 않고 경고만.
        // verdict 시프트 단계에서 액션을 AVOID로 강제한다.
        hits.push({
          label: "거래정지 종목 — 매매 불가",
          heat: 10,
          buy: -20,
          good: false,
        });
        break;
      case "admin":
        hits.push({
          label: "관리종목 — 상장 폐지 위험",
          heat: 15,
          buy: -20,
          good: false,
        });
        break;
    }
  }

  return hits;
}

/**
 * 단기 신호 결정 — heat(과열)·buy(매수우위) 두 점수를 임계값 lattice 로 분류.
 *
 * ⚠️ 임계값 사이 "갭 영역" 이 존재해 같은 입력의 미세한 변동(±1점)으로 신호가
 *    비단조적으로 바뀔 수 있다. 예) buy=58 (장중) 인데 heat=63 이면 buy≥56 / heat≤62
 *    조건을 모두 못 만족해 ADD 가 아닌 HOLD 로 떨어진다. 알고는 있되 — 의도된 보수성
 *    (애매한 구간에서 매수 우위를 잘못 선언하지 않으려는 디자인) 이므로 코드는 유지.
 *
 * 장중(REGULAR) — 우선순위 위→아래 (먼저 매치되는 branch 채택):
 *   - heat ≥ 80 & buy ≤ 35              → SELL    (과열 + 매수 약함)
 *   - buy ≥ 62 & heat ≤ 55              → BUY     (매수 강 + 과열 약) — 경계 히스테리시스
 *   - buy ≥ 90 & heat ≤ 80              → ADD     (극강 매수면 과열 일부 무시)
 *   - buy ≥ 58 & heat ≤ 60              → ADD     (일반 매수 + 과열 보통 이하) — 경계 히스테리시스
 *   - heat ≥ 65 & buy < 60              → WATCH   (과열인데 매수 약)
 *   - buy ≤ 35 & heat ≤ 45              → WATCH   (매수 없음, 과열도 없음 — 무근거)
 *   - 그 외                              → HOLD
 *
 * 비장중(CLOSED 등) — 보수적으로 ±2~4 점 더 빡빡:
 *   - heat ≥ 82 & buy ≤ 32              → SELL
 *   - buy ≥ 72 & heat ≤ 52              → BUY
 *   - buy ≥ 90 & heat ≤ 80              → ADD     (극강은 동일)
 *   - buy ≥ 58 & heat ≤ 62              → ADD
 *   - heat ≥ 65 & buy < 62              → WATCH
 *   - buy ≤ 35 & heat ≤ 45              → WATCH
 *   - 그 외                              → HOLD
 *
 * "갭 영역" 예시 (장중):
 *   buy=58, heat=63 → ADD 조건(heat≤62) 못 맞춤 → HOLD
 *   buy=68, heat=56 → BUY 조건(heat≤55) 못 맞춤 → ADD(buy≥56 매치) — OK
 *   buy=50, heat=70 → WATCH(heat≥65) 매치
 *
 * 의도된 동작이지만, 임계값 한두 점 차이로 신호가 도약하므로 UI 에서 점수 자체도
 * 함께 노출해 사용자가 "왜 ADD 인지/HOLD 인지" 추적 가능하게 한다.
 */
function decideShortTermSignal(
  heat: number,
  buy: number,
  marketState?: string
): SignalStatus {
  // 장중/비장중 임계값을 분리한다.
  // 강한 매수 근거가 있으면 과열만으로 바로 관망/축소로 밀지 않는다.
  if (isRegularMarket(marketState)) {
    if (heat >= 80 && buy <= 35) return "SELL";
    if (buy >= 62 && heat <= 55) return "BUY";
    if (buy >= 90 && heat <= 80) return "ADD"; // 강한 매수 근거가 단기 과열을 덮음
    if (buy >= 58 && heat <= 60) return "ADD";
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

  // 1) 컨센 평균 대비 상승여력 (가장 큰 신호) — 3-way 우선순위
  //
  //    한국 종목: domesticUpsidePercent (count≥5) > globalUpsidePercent (count>0) > upsidePercent(통합)
  //    미국·기타: domestic이 비어있으므로 자연스럽게 global → 통합 순으로 떨어진다.
  //
  //    이유: 기존 targetMean(merged)는 Yahoo 외국인 평균까지 섞여 있어 한국 종목을
  //    과보수적으로 평가하던 문제 (예: 삼성전기 +35% 여력이 -22%로 잘못 표시).
  //    국내 평균 데이터가 5건 이상이면 신뢰도 충분으로 보고 그걸 채택.
  //    국내 데이터가 부족한 한국 종목·미국 종목은 글로벌 broker 평균(global*)을 다음 후보로.
  let upsideUsed: number | null = null;
  let upsideSourceNote = "";
  if (
    consensus?.domesticUpsidePercent != null &&
    (consensus.domesticCount ?? 0) >= 5
  ) {
    upsideUsed = consensus.domesticUpsidePercent;
    upsideSourceNote = `국내 ${consensus.domesticCount}사`;
  } else if (
    consensus?.globalUpsidePercent != null &&
    (consensus.globalCount ?? 0) > 0
  ) {
    upsideUsed = consensus.globalUpsidePercent;
    upsideSourceNote = `글로벌 ${consensus.globalCount}명`;
  } else if (consensus?.upsidePercent != null) {
    upsideUsed = consensus.upsidePercent;
    upsideSourceNote = "통합";
  }
  if (upsideUsed != null) {
    const up = upsideUsed;
    const upPct = (up * 100).toFixed(0);
    const tag = upsideSourceNote ? `${upsideSourceNote} ` : "컨센서스 ";
    if (up >= 0.25)
      hits.push({ label: `${tag}+${upPct}% 상승여력 — 큰 폭`, score: 25, good: true });
    else if (up >= 0.15)
      hits.push({ label: `${tag}+${upPct}% 상승여력`, score: 18, good: true });
    else if (up >= 0.05)
      hits.push({ label: `${tag}+${upPct}% 여력`, score: 10, good: true });
    else if (up > -0.05)
      hits.push({ label: `${tag}±${upPct}% — 적정 구간`, score: 0, good: true });
    else if (up > -0.15)
      hits.push({ label: `${tag}${upPct}% — 여력 제한`, score: -10, good: false });
    else if (up > -0.25)
      hits.push({ label: `${tag}${upPct}% — 목표가 초과`, score: -20, good: false });
    else hits.push({ label: `${tag}${upPct}% — 25% 이상 고평가`, score: -30, good: false });
  }

  // 2) 컨센 최고가 보너스 — mean이 박살나도 high가 크면 강세 시나리오 존재.
  //    SK하이닉스 케이스(최고 +71%) 대응: 50~80% 구간을 두텁게 보정.
  //    high도 위 우선순위(domestic≥5 → global>0 → targetHigh)와 일관되게 사용.
  //    high와 mean의 격차가 큰 경우(분산 큼)는 outlier로 보고 가중치 절반.
  //    조건: (high - mean) / mean > 1.0 → 1배 이상 차이
  const useDomesticForHigh =
    (consensus?.domesticCount ?? 0) >= 5 && consensus?.domesticHigh != null;
  const useGlobalForHigh =
    !useDomesticForHigh &&
    consensus?.globalHigh != null &&
    (consensus?.globalCount ?? 0) > 0;
  const highUsed = useDomesticForHigh
    ? (consensus!.domesticHigh as number)
    : useGlobalForHigh
      ? (consensus!.globalHigh as number)
      : (consensus?.targetHigh ?? null);
  const meanForOutlier = useDomesticForHigh
    ? (consensus!.domesticMean as number)
    : useGlobalForHigh
      ? (consensus!.globalMean as number)
      : (consensus?.targetMean ?? null);
  if (highUsed != null && quote.price > 0) {
    const highUp = highUsed / quote.price - 1;
    let outlierFactor = 1;
    let outlierNote = "";
    if (
      meanForOutlier != null &&
      meanForOutlier > 0 &&
      (highUsed - meanForOutlier) / meanForOutlier > 1.0
    ) {
      outlierFactor = 0.5;
      outlierNote = " · 최고치는 outlier(다수 의견과 격차 큼)";
    }
    if (highUp >= 0.8)
      hits.push({
        label: `최고 컨센서스 +${(highUp * 100).toFixed(0)}% — 강세 시나리오 큼${outlierNote}`,
        score: Math.round(20 * outlierFactor),
        good: true,
      });
    else if (highUp >= 0.5)
      hits.push({
        label: `최고 컨센서스 +${(highUp * 100).toFixed(0)}% — 강세 시나리오 존재${outlierNote}`,
        score: Math.round(15 * outlierFactor),
        good: true,
      });
    else if (highUp >= 0.3)
      hits.push({
        label: `최고 컨센서스 +${(highUp * 100).toFixed(0)}% 여지${outlierNote}`,
        score: Math.round(8 * outlierFactor),
        good: true,
      });
  }

  // 3) 추정 PER (forwardPer) — "내년 실적 대비" 저평가/고평가
  //    - 음수(적자기업) 가드: 양수 분기 진입 차단, 별도 reason으로 노출
  //    - 두 소스(Yahoo/Naver) 신뢰도 "low" 시 가중치 절반 + reason 명시
  const fpConfidence = valuation?.forwardPerConfidence ?? "high";
  const fpFactor = fpConfidence === "low" ? 0.5 : 1;
  const fpNote = fpConfidence === "low" ? " · 두 소스 격차 큼(가중치 축소)" : "";
  if (forwardPer != null && forwardPer > 0) {
    if (forwardPer < 8)
      hits.push({
        label: `추정PER ${forwardPer.toFixed(1)}배 — 매우 저평가${fpNote}`,
        score: Math.round(15 * fpFactor),
        good: true,
      });
    else if (forwardPer < 10)
      hits.push({
        label: `추정PER ${forwardPer.toFixed(1)}배 저평가${fpNote}`,
        score: Math.round(10 * fpFactor),
        good: true,
      });
    else if (forwardPer < 14)
      hits.push({
        label: `추정PER ${forwardPer.toFixed(1)}배 적정 이하${fpNote}`,
        score: Math.round(5 * fpFactor),
        good: true,
      });
    else if (forwardPer > 40)
      hits.push({
        label: `추정PER ${forwardPer.toFixed(0)}배 — 다음 실적 대비도 부담${fpNote}`,
        score: Math.round(-15 * fpFactor),
        good: false,
      });
    else if (forwardPer > 25)
      hits.push({
        label: `추정PER ${forwardPer.toFixed(0)}배 — 다음 실적 부담${fpNote}`,
        score: Math.round(-5 * fpFactor),
        good: false,
      });
  } else if (forwardPer != null && forwardPer <= 0) {
    hits.push({
      label: "적자(추정PER 음수) — 컨센 PER 적용 불가",
      score: -20,
      good: false,
    });
  }

  // 4) PBR — 음수(자본잠식) 가드
  if (pbr != null && pbr > 0) {
    if (pbr < 1)
      hits.push({ label: `PBR ${pbr.toFixed(2)}배 — 청산가치 이하`, score: 5, good: true });
    else if (pbr >= 8)
      hits.push({ label: `PBR ${pbr.toFixed(1)}배 — 자산가치 대비 매우 부담`, score: -15, good: false });
    else if (pbr >= 5)
      hits.push({ label: `PBR ${pbr.toFixed(1)}배 자산가치 부담`, score: -8, good: false });
  } else if (pbr != null && pbr <= 0) {
    hits.push({
      label: "자본잠식(PBR 음수) — 큰 위험",
      score: -25,
      good: false,
    });
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
// 통합 액션 매트릭스 (mergeVerdict) — 단·장기 조합으로 1초 안에 행동을 정할
// 메인 결론(verdict)을 만든다. 주인님 관점: 장기 가치 우위 — 단기 SELL + 장기
// BUY/ADD 조합은 단기 약세를 분할 진입 기회로 본다.
//
//   단기 \ 장기 | BUY        | ADD        | HOLD       | WATCH       | SELL
//   ------------|------------|------------|------------|-------------|-----------
//   BUY         | NEW_ENTRY  | NEW_ENTRY  | NEW_ENTRY  | SHORT_TRADE | SHORT_TRADE
//   ADD         | SCALE_IN   | SCALE_IN   | SCALE_IN   | HOLD        | TRIM
//   HOLD        | HOLD_WAIT  | HOLD_WAIT  | HOLD       | HOLD        | TRIM
//   WATCH       | HOLD_WAIT  | AVOID      | AVOID      | AVOID       | REDUCE
//   SELL        | SCALE_IN   | SCALE_IN   | TRIM       | REDUCE      | REDUCE
// ----------------------------------------------------------------------------
const VERDICT_MATRIX: Record<
  SignalStatus,
  Record<SignalStatus, ActionRecommendation>
> = {
  BUY: {
    BUY: "NEW_ENTRY",
    ADD: "NEW_ENTRY",
    HOLD: "NEW_ENTRY",
    WATCH: "SHORT_TRADE",
    SELL: "SHORT_TRADE",
  },
  ADD: {
    BUY: "SCALE_IN",
    ADD: "SCALE_IN",
    HOLD: "SCALE_IN",
    WATCH: "HOLD",
    SELL: "TRIM",
  },
  HOLD: {
    BUY: "HOLD_WAIT",
    ADD: "HOLD_WAIT",
    HOLD: "HOLD",
    WATCH: "HOLD",
    SELL: "TRIM",
  },
  WATCH: {
    BUY: "HOLD_WAIT",
    ADD: "AVOID",
    HOLD: "AVOID",
    WATCH: "AVOID",
    SELL: "REDUCE",
  },
  SELL: {
    BUY: "SCALE_IN",
    ADD: "SCALE_IN",
    HOLD: "TRIM",
    WATCH: "REDUCE",
    SELL: "REDUCE",
  },
};

// 각 액션의 라벨/톤/대표 헤드라인. SCALE_IN 만 단·장기 조합에 따라 헤드라인 분기.
function actionMeta(
  action: ActionRecommendation,
  shortSig: SignalStatus,
  longSig: SignalStatus
): { label: string; tone: ActionVerdict["tone"]; headline: string } {
  switch (action) {
    case "NEW_ENTRY":
      return {
        label: "신규 진입",
        tone: "buy",
        headline: "단·장기 모두 양호 — 신규 진입 우위",
      };
    case "SCALE_IN": {
      // SK하이닉스 케이스: 단기 SELL + 장기 BUY/ADD
      if (shortSig === "SELL" && (longSig === "BUY" || longSig === "ADD")) {
        return {
          label: "분할 매수",
          tone: "add",
          headline: "단기 과열·차익실현 구간, 장기 매력 큼 — 분할 재진입 기회",
        };
      }
      return {
        label: "분할 매수",
        tone: "add",
        headline: "단·장기 매수 우위 — 분할 매수 적정",
      };
    }
    case "HOLD_WAIT":
      return {
        label: "눌림목 대기",
        tone: "watch",
        headline: "장기 양호, 단기 추격 자제 — 눌림목 진입 대기",
      };
    case "HOLD":
      return {
        label: "보유 유지",
        tone: "hold",
        headline: "특별한 시그널 없음 — 보유 유지",
      };
    case "SHORT_TRADE":
      return {
        label: "짧게 매매",
        tone: "add",
        headline: "단기 모멘텀 살아있으나 장기 고평가 — 짧게 가져갈 것",
      };
    case "TRIM":
      return {
        label: "점진 축소",
        tone: "watch",
        headline: "단기 약세·장기도 평이 — 비중 점진 축소",
      };
    case "REDUCE":
      return {
        label: "비중 축소",
        tone: "sell",
        headline: "단·장기 모두 약세 — 비중 축소",
      };
    case "AVOID":
      return {
        label: "관망",
        tone: "watch",
        headline: "방향성 불명확 — 관망",
      };
  }
}

// 단·장기 신호 조합 → 메인 결론(verdict).
export function mergeVerdict(
  shortSig: SignalStatus,
  longSig: SignalStatus
): ActionVerdict {
  const action = VERDICT_MATRIX[shortSig][longSig];
  const meta = actionMeta(action, shortSig, longSig);
  return {
    action,
    label: meta.label,
    headline: meta.headline,
    tone: meta.tone,
    detail: `단기 ${shortSig} · 장기 ${longSig}`,
  };
}

// 외부 리스크(트럼프·관세·지정학)가 high면 한 단계 보수적으로 시프트한다.
// 매트릭스:
//   NEW_ENTRY   → SCALE_IN
//   SCALE_IN    → HOLD_WAIT
//   HOLD_WAIT   → AVOID
//   HOLD        → AVOID
//   SHORT_TRADE → AVOID
//   나머지(TRIM/REDUCE/AVOID)는 그대로
// medium은 시프트 없이 headline에 "외부 리스크 주의" 부연만 추가.
// low는 표시 없음.
const RISK_SHIFT_MAP: Partial<Record<ActionRecommendation, ActionRecommendation>> = {
  NEW_ENTRY: "SCALE_IN",
  SCALE_IN: "HOLD_WAIT",
  HOLD_WAIT: "AVOID",
  HOLD: "AVOID",
  SHORT_TRADE: "AVOID",
};

// 한국거래소 시장경보로 인한 verdict 시프트.
//   - caution         : 액션 그대로, 헤드라인에만 표기
//   - warning / risk  : 외부 리스크 high 와 동일한 한 단계 보수 시프트 + headline 부연
//   - admin           : warning 과 동일 취급
//   - halt            : 거래 자체가 안 되므로 무조건 AVOID 로 고정
//
// 외부 리스크 high 가 이미 시프트한 액션도 시장경보가 warning 이상이면 추가 시프트.
// (즉, 두 단계 보수까지 가능 — NEW_ENTRY → SCALE_IN → HOLD_WAIT)
export function applyMarketAlertShift(
  verdict: ActionVerdict,
  alert: MarketAlert | null | undefined,
  shortSig: SignalStatus,
  longSig: SignalStatus
): ActionVerdict {
  if (!alert) return verdict;

  // 헤드라인 끝에 시장경보 부연 — 항상 추가
  const suffix = ` · 시장경보(${alert.label})`;

  // 거래정지는 매수/추가 자체가 불가능하므로 AVOID 강제
  if (alert.level === "halt") {
    const meta = actionMeta("AVOID", shortSig, longSig);
    return {
      action: "AVOID",
      label: meta.label,
      tone: "sell", // 거래정지는 시각적으로도 가장 강하게
      headline: `거래정지 — 매매 불가${suffix}`,
      detail: verdict.detail,
      riskShifted: true,
    };
  }

  // warning / risk / admin → 한 단계 보수 시프트
  const heavy: MarketAlertLevel[] = ["warning", "risk", "admin"];
  if (heavy.includes(alert.level)) {
    const nextAction = RISK_SHIFT_MAP[verdict.action];
    if (nextAction && nextAction !== verdict.action) {
      const meta = actionMeta(nextAction, shortSig, longSig);
      return {
        action: nextAction,
        label: meta.label,
        tone: meta.tone,
        headline: `${meta.headline}${suffix}`,
        detail: verdict.detail,
        riskShifted: true,
      };
    }
    // 이미 보수 액션(TRIM/REDUCE/AVOID)이면 헤드라인만 표기
    return {
      ...verdict,
      headline: `${verdict.headline}${suffix}`,
      riskShifted: true,
    };
  }

  // caution — 액션은 유지, 헤드라인만 표기
  return {
    ...verdict,
    headline: `${verdict.headline}${suffix}`,
  };
}

export function applyRiskShift(
  verdict: ActionVerdict,
  risk: NewsRiskAssessment,
  shortSig: SignalStatus,
  longSig: SignalStatus
): ActionVerdict {
  // 대표 driver 라벨 (UI 노출용)
  const topDriver = risk.drivers[0]?.label;

  if (risk.level === "high") {
    const nextAction = RISK_SHIFT_MAP[verdict.action];
    if (nextAction && nextAction !== verdict.action) {
      const meta = actionMeta(nextAction, shortSig, longSig);
      const driverHint = topDriver ? ` (${topDriver})` : "";
      return {
        action: nextAction,
        label: meta.label,
        tone: meta.tone,
        headline: `${meta.headline} · 외부 리스크 ↑ 한 단계 보수${driverHint}`,
        detail: verdict.detail,
        riskShifted: true,
      };
    }
    // 시프트 대상이 아닌 액션(TRIM/REDUCE/AVOID)이라도 헤드라인에 리스크 표시는 남긴다.
    const driverHint = topDriver ? ` (${topDriver})` : "";
    return {
      ...verdict,
      headline: `${verdict.headline} · 외부 리스크 ↑${driverHint}`,
      riskShifted: true,
    };
  }

  if (risk.level === "medium") {
    const driverHint = topDriver ? ` (${topDriver})` : "";
    return {
      ...verdict,
      headline: `${verdict.headline} · 외부 리스크 주의${driverHint}`,
      // medium은 액션 자체는 안 바꿈 — 플래그도 false 유지.
    };
  }

  return verdict;
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
  let shortSignal = decideShortTermSignal(
    heat,
    buy,
    input.quote.marketState
  );
  // 급락 + 수급 악화 — 단기 BUY/ADD/SELL 상한 WATCH
  if (isCrashWithBadFlow(input.quote.changeRate, input.flow)) {
    if (shortSignal === "BUY" || shortSignal === "ADD" || shortSignal === "SELL") {
      shortSignal = "WATCH";
    }
  }

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

  // 외부 호재(opportunity) — 의미 있는 medium/high일 때 단기 reasons에 한 줄 prepend.
  // verdict shift는 하지 않고 표시만. high면 대표 driver 라벨, medium은 매칭 수 정도.
  const opportunity = input.externalOpportunity ?? null;
  if (opportunity && opportunity.level !== "low") {
    const top = opportunity.drivers[0]?.label;
    const opLabel =
      opportunity.level === "high"
        ? `호재 ↑ (${top ?? `${opportunity.matchCount}건`})`
        : `호재 주목 (${top ?? `${opportunity.matchCount}건`})`;
    shortReasons.unshift(`+ ${opLabel}`);
  }

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

  // 통합 액션 — 단·장기 조합 매트릭스에서 메인 결론 도출.
  const baseVerdict = mergeVerdict(shortSignal, longSignal);

  // 외부 이벤트 리스크 시프트 — 트럼프 주둥이/관세/지정학 high면 한 단계 보수.
  const externalRisk = input.externalRisk ?? emptyRiskAssessment();
  const riskShifted = applyRiskShift(
    baseVerdict,
    externalRisk,
    shortSignal,
    longSignal
  );
  // 시장경보 시프트 — warning/risk/admin이면 추가로 한 단계 보수, halt면 AVOID 고정.
  // 외부 리스크 시프트 이후에 적용해 누적이 가능하게(예: high 뉴스 + 투자경고).
  const verdict = applyMarketAlertShift(
    riskShifted,
    input.quote.marketAlert,
    shortSignal,
    longSignal
  );

  return {
    shortTerm,
    longTerm,
    externalRisk,
    externalOpportunity: opportunity ?? undefined,
    verdict,
    // 백워드 호환 미러 — headline은 verdict 메시지로 노출
    signal: shortTerm.signal,
    heatScore: heat,
    buyScore: buy,
    headline: verdict.headline,
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
