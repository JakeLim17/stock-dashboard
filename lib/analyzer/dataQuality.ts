import "server-only";
import type { AnalysisResult, FlowData, Predictions, DataQualityInfo } from "../types";
import { isKrStock } from "../providers/naver";

/** 거래일 히스토리 최소 기준 — 미만이면 단기 신호·변동 구간을 보수 처리. */
export const MIN_HISTORY_TRADING_DAYS = 30;

/** KST(UTC+9) 기준 YYYY-MM-DD — 일일 추천 스냅샷 키. */
export function kstDateKey(d = new Date()): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function assessDataQuality(input: {
  code: string;
  historyLength: number;
  flow: FlowData;
}): DataQualityInfo {
  const overseasNoFlow = !isKrStock(input.code);
  const flowIsMock = input.flow.source === "mock";
  const historyDays = Math.max(0, input.historyLength);
  return {
    historyDays,
    thinHistory: historyDays < MIN_HISTORY_TRADING_DAYS,
    overseasNoFlow,
    flowIsMock,
  };
}

const SIGNAL_RANK: Record<string, number> = {
  BUY: 4,
  ADD: 3,
  HOLD: 2,
  WATCH: 1,
  SELL: 0,
};

function capSignal(
  signal: AnalysisResult["shortTerm"]["signal"],
  max: "HOLD" | "WATCH"
): AnalysisResult["shortTerm"]["signal"] {
  const maxRank = SIGNAL_RANK[max];
  if (SIGNAL_RANK[signal] <= maxRank) return signal;
  return max;
}

/** IPO·얇은 히스토리 — 단기 BUY/ADD/SELL 상한을 HOLD 또는 WATCH 로 제한. */
export function applyThinHistoryAnalysisGate(
  analysis: AnalysisResult,
  dq: DataQualityInfo
): AnalysisResult {
  if (!dq.thinHistory) return analysis;

  const capped = capSignal(analysis.shortTerm.signal, "WATCH");
  if (capped === analysis.shortTerm.signal) return analysis;

  const note = `· 데이터 축적 중 (${dq.historyDays}일) — 단기 신호 보수 처리`;
  const shortReasons = [note, ...analysis.shortTerm.reasons].slice(0, 3);

  const shortTerm = {
    ...analysis.shortTerm,
    signal: capped,
    headline: "상장·거래 이력 짧음 — 방향 판단 보류",
    reasons: shortReasons,
  };

  const verdict = {
    ...analysis.verdict,
    headline: `${analysis.verdict.headline} · 데이터 ${dq.historyDays}일`,
  };

  return {
    ...analysis,
    shortTerm,
    signal: shortTerm.signal,
    headline: verdict.headline,
    reasons: shortReasons,
    verdict,
  };
}

/** 변동성 참고 구간 — 얇은 히스토리면 ranges/targets 제거. */
export function applyThinHistoryPredictionGate(
  predictions: Predictions | null,
  dq: DataQualityInfo
): Predictions | null {
  if (!predictions || !dq.thinHistory) return predictions;
  return {
    ...predictions,
    ranges: [],
    targets: null,
    scenarios: [],
    intradayRange: null,
  };
}

/** 추천 풀 — buy 버킷에서 제외·hold 로 강등할지. */
export function shouldDemoteRecommendationBuy(
  dq: DataQualityInfo,
  category: "buy" | "hold" | "reduce"
): boolean {
  if (category !== "buy") return false;
  if (dq.thinHistory) return true;
  if (dq.overseasNoFlow && dq.historyDays < MIN_HISTORY_TRADING_DAYS) return true;
  return false;
}
