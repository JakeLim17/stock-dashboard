import type { EventItem } from "./types";

/** SK 계열 — 하이닉스 호재·ADR·실적이 지주·투자지주에 전이되는 비율 */
export interface GroupCatalystPeer {
  leaderCode: string;
  /** 0~1 — 리더 일정 호재 bps에 곱할 비율 */
  catalystShare: number;
  label: string;
}

/** 종목 코드 → 리더(대장) 종목 연동 설정 */
export const GROUP_CATALYST_PEERS: Record<string, GroupCatalystPeer> = {
  "402340.KS": {
    leaderCode: "000660.KS",
    catalystShare: 0.88,
    label: "하이닉스 ADR·실적 연동",
  },
  "034730.KS": {
    leaderCode: "000660.KS",
    catalystShare: 0.72,
    label: "하이닉스 계열 호재",
  },
  "096770.KS": {
    leaderCode: "000660.KS",
    catalystShare: 0.35,
    label: "SK 계열 반도체",
  },
  "017670.KS": {
    leaderCode: "000660.KS",
    catalystShare: 0.25,
    label: "SK 그룹",
  },
};

export function getGroupCatalystPeer(symbolCode: string): GroupCatalystPeer | null {
  return GROUP_CATALYST_PEERS[symbolCode] ?? null;
}

/** 리더 종목 일정이 계열사 예측에도 반영될지 판별 */
export function isGroupSpilloverEvent(e: EventItem): boolean {
  const text = `${e.label} ${e.detail ?? ""}`;
  return (
    /ADR|예탁증권|나스닥|NASDAQ|상장|실적|어닝|earnings|HBM|메모리|반도체|분할|분영|지분|재평가/i.test(
      text
    ) || e.importance === "high"
  );
}

/** 리더 일정을 계열사용 이벤트로 복제 (symbolCode만 교체) */
export function spilloverLeaderEvents(
  symbolCode: string,
  leaderEvents: EventItem[]
): EventItem[] {
  const peer = getGroupCatalystPeer(symbolCode);
  if (!peer) return [];
  return leaderEvents
    .filter((e) => e.symbolCode === peer.leaderCode && isGroupSpilloverEvent(e))
    .map((e) => ({
      ...e,
      symbolCode,
      detail: [e.detail, peer.label].filter(Boolean).join(" · "),
      importance:
        e.importance === "high"
          ? ("medium" as const)
          : e.importance === "medium"
            ? ("low" as const)
            : e.importance,
    }));
}
