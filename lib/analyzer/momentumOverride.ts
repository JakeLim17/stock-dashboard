import type { HistoricalPoint } from "../providers/yahoo";
import type {
  ActionVerdict,
  FlowData,
  Quote,
  SignalMark,
  SignalStatus,
  Valuation,
} from "../types";
import type { AnalyzeInput } from "./rules";

/** 모멘텀 override 판정 결과 — verdict·랭킹·UI에 공유. */
export interface MomentumOverrideResult {
  active: boolean;
  /** 추천 rankScore 가산용 0~25 */
  rankBonus: number;
  /** 강한 상승 추세(5연속 양봉 또는 당일 +5%↑) — 눌림목 문구 억제 */
  strongTrend: boolean;
  /** semiHeat 과열이어도 관망 대신 추세 추종 허용 */
  semiHeatOverridden: boolean;
  /** UI 1줄 이유 / reasons prepend */
  reasons: string[];
  /** 과열 추세 배지 등 */
  badges: string[];
}

function countUpStreak(history: HistoricalPoint[], quote: Quote): number {
  if (history.length < 2) return 0;
  const closes = history.map((h) => h.close);
  const lastBarClose = closes[closes.length - 1];
  const sameDay =
    lastBarClose > 0 &&
    Math.abs(quote.price - lastBarClose) / lastBarClose < 0.005;
  const series = sameDay ? closes : [...closes, quote.price];
  let n = 0;
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i] > series[i - 1]) n++;
    else break;
  }
  return n;
}

function volumeRatio(history: HistoricalPoint[], quote: Quote): number | null {
  if (quote.volume == null || quote.volume <= 0 || history.length < 21) {
    return null;
  }
  const closes = history.map((h) => h.close);
  const lastBarClose = closes[closes.length - 1];
  const sameDay =
    lastBarClose > 0 &&
    Math.abs(quote.price - lastBarClose) / lastBarClose < 0.005;
  const past = sameDay ? history.slice(-21, -1) : history.slice(-20);
  if (past.length < 10) return null;
  const avg = past.reduce((a, b) => a + b.volume, 0) / past.length;
  if (avg <= 0) return null;
  return quote.volume / avg;
}

function hasPositiveFlow(flow: FlowData): boolean {
  if (flow.source === "mock") return false;
  const f = flow.foreignNet ?? 0;
  const i = flow.institutionNet ?? 0;
  return f > 0 || i > 0;
}

function markKeysFromInput(
  quote: Quote,
  history: HistoricalPoint[] | undefined,
  flow: FlowData,
  valuation: Valuation | null | undefined
): Set<string> {
  const keys = new Set<string>();
  const upStreak = history ? countUpStreak(history, quote) : 0;
  if (upStreak >= 3) keys.add("consecutive_up");

  const volRatio = history ? volumeRatio(history, quote) : null;
  if (volRatio != null && volRatio >= 2.0) keys.add("volume_surge");

  if (
    flow.foreignNet5d != null &&
    flow.foreignNet5d >= 5_000_000_000 &&
    flow.source !== "mock"
  ) {
    keys.add("foreign_pick");
  }

  const w52 = valuation?.week52High ?? null;
  if (w52 != null && w52 > 0) {
    if (quote.price >= w52 * 0.999) keys.add("new_52w_high");
    else if (quote.price >= w52 * 0.97) keys.add("near_52w_high");
  }

  if (
    quote.open != null &&
    quote.open > 0 &&
    quote.prevClose > 0 &&
    quote.open / quote.prevClose - 1 >= 0.02
  ) {
    keys.add("gap_up");
  }

  return keys;
}

/**
 * 급등·돌파·수급 급증 시 관망 편향을 완화하는 모멘텀 레인.
 *
 * 조건 (명확한 경우만):
 *   (거래량 급증 OR 당일 +4%↑) AND
 *   (외인픽 OR N일 연속상승 OR 신고가 근접 OR 갭상승) AND
 *   당일 외인/기관 순매수 양수
 *
 * 대안: 5연속 양봉 또는 당일 +5%↑ + 수급 양수 + (외인픽 OR 거래량급증 OR 3연속↑)
 */
export function detectMomentumOverride(
  input: AnalyzeInput & { history?: HistoricalPoint[] }
): MomentumOverrideResult {
  const inactive: MomentumOverrideResult = {
    active: false,
    rankBonus: 0,
    strongTrend: false,
    semiHeatOverridden: false,
    reasons: [],
    badges: [],
  };

  const { quote, flow, valuation, context, history } = input;
  if (flow.source === "mock") return inactive;
  if (!hasPositiveFlow(flow)) return inactive;

  const marks = markKeysFromInput(quote, history, flow, valuation);
  const upStreak = history ? countUpStreak(history, quote) : 0;
  const volRatio = history ? volumeRatio(history, quote) : null;
  const volumeSurge =
    (volRatio != null && volRatio >= 2.0) || quote.changeRate >= 0.04;
  const secondary =
    marks.has("foreign_pick") ||
    marks.has("consecutive_up") ||
    marks.has("near_52w_high") ||
    marks.has("new_52w_high") ||
    marks.has("gap_up");

  const strongTrend = quote.changeRate >= 0.05 || upStreak >= 5;
  const coreLane = volumeSurge && secondary;
  const altLane =
    strongTrend &&
    (marks.has("foreign_pick") ||
      (volRatio != null && volRatio >= 2.0) ||
      upStreak >= 3);

  if (!coreLane && !altLane) return inactive;

  const reasons: string[] = [];
  if (marks.has("foreign_pick")) {
    const eok = Math.round((flow.foreignNet5d ?? 0) / 1e8);
    reasons.push(`외인 5일 누적 +${eok.toLocaleString("ko-KR")}억`);
  }
  if (volRatio != null && volRatio >= 2.0) {
    reasons.push(`거래량 ${volRatio.toFixed(1)}배 급증`);
  } else if (quote.changeRate >= 0.04) {
    reasons.push(`당일 +${(quote.changeRate * 100).toFixed(1)}% 강세`);
  }
  if (upStreak >= 3) reasons.push(`${upStreak}일 연속 상승`);
  if (marks.has("near_52w_high") || marks.has("new_52w_high")) {
    reasons.push("52주 신고가 근접·돌파");
  }
  if (marks.has("gap_up")) reasons.push("갭상승");

  const semiHeatOverridden =
    context.semiHeat != null && context.semiHeat >= 70 && coreLane;

  const badges: string[] = [];
  if (semiHeatOverridden) badges.push("과열 추세");
  if (strongTrend) badges.push("강한 상승 추세");

  const rankBonus = Math.min(
    25,
    10 +
      (strongTrend ? 5 : 0) +
      (marks.has("foreign_pick") ? 5 : 0) +
      (volRatio != null && volRatio >= 2.5 ? 5 : 0)
  );

  return {
    active: true,
    rankBonus,
    strongTrend,
    semiHeatOverridden,
    reasons: reasons.slice(0, 3),
    badges,
  };
}

/** signalMarks 기반 보조 판정 — snapshot 에서 이미 계산된 마크 재사용. */
export function detectMomentumFromMarks(
  marks: SignalMark[],
  flow: FlowData,
  quote: Quote
): Pick<MomentumOverrideResult, "active" | "reasons"> {
  if (flow.source === "mock" || !hasPositiveFlow(flow)) {
    return { active: false, reasons: [] };
  }
  const keys = new Set(marks.map((m) => m.key));
  const volumeSurge =
    keys.has("volume_burst") || quote.changeRate >= 0.04;
  const secondary =
    keys.has("foreign_pick") ||
    keys.has("up_streak") ||
    keys.has("near_52w_high") ||
    keys.has("new_52w_high") ||
    keys.has("gap_up");
  if (!volumeSurge || !secondary) return { active: false, reasons: [] };
  return {
    active: true,
    reasons: marks.slice(0, 2).map((m) => m.label),
  };
}

/** 단기 신호 1단계 상향 (BUY 남발 방지 — 최대 1스텝). */
export function bumpShortSignalForMomentum(
  signal: SignalStatus
): SignalStatus {
  switch (signal) {
    case "WATCH":
      return "HOLD";
    case "HOLD":
      return "ADD";
    default:
      return signal;
  }
}

export function applyMomentumScoreAdjust(
  heat: number,
  buy: number,
  momentum: MomentumOverrideResult
): { heat: number; buy: number } {
  if (!momentum.active) return { heat, buy };
  let h = heat;
  let b = buy;
  b += momentum.semiHeatOverridden ? 18 : 14;
  h -= momentum.semiHeatOverridden ? 12 : 8;
  if (momentum.strongTrend) b += 4;
  return { heat: h, buy: b };
}

export function applyMomentumVerdict(
  verdict: ActionVerdict,
  shortSig: SignalStatus,
  longSig: SignalStatus,
  momentum: MomentumOverrideResult,
  context: { semiHeat: number | null; heat: number; buy: number }
): ActionVerdict {
  if (!momentum.active) return verdict;

  const reasonLine =
    momentum.reasons[0] ??
    (context.semiHeat != null && context.semiHeat >= 70
      ? `반도체 과열 ${context.semiHeat}/100 · 모멘텀 우위`
      : `단기 모멘텀 (매수 ${context.buy} · 과열 ${context.heat})`);

  const bullishLong = longSig === "BUY" || longSig === "ADD";
  const waitOrAvoid =
    verdict.action === "HOLD_WAIT" ||
    verdict.action === "AVOID" ||
    verdict.action === "HOLD";

  if (waitOrAvoid && bullishLong) {
    return {
      action: "SCALE_IN",
      label: momentum.semiHeatOverridden ? "과열 추세" : "추세 추종",
      tone: "add",
      headline: momentum.semiHeatOverridden
        ? "반도체 과열이나 수급·돌파 모멘텀 — 추세 추종(분할) 참고"
        : "강한 모멘텀 + 장기 양호 — 추세 추종 분할 참고",
      detail: `단기 ${shortSig} · 장기 ${longSig} · 모멘텀 override`,
      reasonLine,
      momentumOverride: true,
    };
  }

  if (verdict.action === "AVOID" || verdict.action === "HOLD_WAIT") {
    return {
      action: "SHORT_TRADE",
      label: "모멘텀 주의",
      tone: "add",
      headline: "단기 돌파·수급 강세 — 짧은 추세 추종만 참고",
      detail: verdict.detail,
      reasonLine,
      momentumOverride: true,
    };
  }

  return {
    ...verdict,
    reasonLine,
    momentumOverride: true,
  };
}

export function buildHoldReasonLine(
  verdict: ActionVerdict,
  heat: number,
  semiHeat: number | null,
  shortReasons: string[]
): string | undefined {
  if (
    verdict.action !== "AVOID" &&
    verdict.action !== "HOLD_WAIT" &&
    verdict.action !== "HOLD"
  ) {
    return undefined;
  }
  if (semiHeat != null && semiHeat >= 70) {
    return `반도체 과열 ${semiHeat}/100 — 추격 자제`;
  }
  if (heat >= 65) {
    return `단기 과열 ${heat}/100 — 눌림 확인`;
  }
  const neg = shortReasons.find((r) => r.startsWith("−"));
  if (neg) return neg.replace(/^−\s*/, "");
  return undefined;
}
