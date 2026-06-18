import type { SignalStatus } from "./types";

/** 사용자-facing 시그널 라벨 — 내부 SignalStatus(BUY/ADD/…)는 그대로 유지. */
export const SIGNAL_LABEL: Record<SignalStatus, string> = {
  BUY: "신규·적극 진입",
  ADD: "분할·눌림 매수",
  HOLD: "보유 유지",
  WATCH: "관망",
  SELL: "비중 축소",
};

/** 단기 시그널별 한 줄 행동 힌트 — BUY vs ADD 구분용. */
export const SHORT_SIGNAL_HINT: Partial<Record<SignalStatus, string>> = {
  BUY: "매수 근거·과열 모두 양호 → 신규 진입 참고",
  ADD: "매수 우위는 있으나 변동·과열 있음 → 분할·눌림 매수 참고",
};

/** 장기 시그널별 한 줄 행동 힌트. */
export const LONG_SIGNAL_HINT: Partial<Record<SignalStatus, string>> = {
  BUY: "컨센·밸류 매력 큼 → 장기 신규 진입 고려",
  ADD: "장기 매력 양호 → 분할로 천천히 매수",
};

export function signalHorizonLabel(
  horizon: "short" | "long",
  signal: SignalStatus
): string {
  const prefix = horizon === "short" ? "단기" : "장기";
  return `${prefix} ${SIGNAL_LABEL[signal]}`;
}

/** 배지 아래에 붙일 맥락 힌트 — 단기 BUY/ADD 혼동 방지 우선. */
export function signalContextHint(
  short: SignalStatus,
  long: SignalStatus
): string | null {
  if (SHORT_SIGNAL_HINT[short]) return SHORT_SIGNAL_HINT[short]!;
  if (long === "BUY" || long === "ADD") {
    return LONG_SIGNAL_HINT[long] ?? null;
  }
  return null;
}
