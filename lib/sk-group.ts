import type { EventItem, StockSnapshot } from "./types";
import { dedupeEventItems } from "./schedule-dedup";

/** SK하이닉스 — SK 계열 가격·호재 리더 */
export const SK_HYNIX_CODE = "000660.KS";

/** SK 계열 종목 → 하이닉스 연동 강도 (0~1, 역사적 동조 상관 근사) */
export const SK_GROUP_LINK: Record<
  string,
  { beta: number; spilloverShare: number }
> = {
  "402340.KS": { beta: 0.55, spilloverShare: 0.5 }, // SK스퀘어
  "034730.KS": { beta: 0.42, spilloverShare: 0.45 }, // SK(주)
  "096770.KS": { beta: 0.25, spilloverShare: 0.3 }, // SK이노
  "017670.KS": { beta: 0.15, spilloverShare: 0.2 }, // SK텔레콤
  "361610.KQ": { beta: 0.2, spilloverShare: 0.25 }, // SK아이이테크
};

export function getSkGroupLink(
  code: string
): { beta: number; spilloverShare: number } | null {
  return SK_GROUP_LINK[code] ?? null;
}

export function isSkGroupMember(code: string): boolean {
  return code in SK_GROUP_LINK;
}

const LEADER_EVENT_RE =
  /ADR|예탁|나스닥|NASDAQ|하이닉스|Hynix|HBM|실적|어닝|earnings|ipo/i;

/** 하이닉스 호재 일정을 SK 계열 종목 이벤트에 병합 */
export function inheritSkLeaderEvents(
  memberCode: string,
  memberEvents: EventItem[],
  leaderEvents: EventItem[]
): EventItem[] {
  const link = getSkGroupLink(memberCode);
  if (!link || leaderEvents.length === 0) return memberEvents;

  const inherited = leaderEvents
    .filter(
      (e) =>
        (!e.symbolCode || e.symbolCode === SK_HYNIX_CODE) &&
        LEADER_EVENT_RE.test(`${e.label} ${e.detail ?? ""}`)
    )
    .map((e) => ({
      ...e,
      symbolCode: memberCode,
      label: `하이닉스 연동 · ${e.label}`,
      importance:
        e.importance === "high"
          ? ("high" as const)
          : e.importance === "medium"
            ? ("medium" as const)
            : ("low" as const),
      detail: [e.detail, `하이닉스 β${link.beta.toFixed(2)} 연동`]
        .filter(Boolean)
        .join(" · "),
    }));

  return [...memberEvents, ...inherited];
}

/** 리더(하이닉스) 예상 수익률을 계열사에 전달 — 장기 시계에서 더 반영 */
export function skGroupSpilloverRate(
  memberCode: string,
  leaderVsSettlementRate: number,
  horizon: "today" | "tomorrow" | "week" | "month"
): number {
  const link = getSkGroupLink(memberCode);
  if (!link || !Number.isFinite(leaderVsSettlementRate)) return 0;

  const horizonMult =
    horizon === "month" ? 1.2 : horizon === "week" ? 0.9 : 0.65;
  const raw =
    leaderVsSettlementRate * link.beta * link.spilloverShare * horizonMult;
  const cap =
    horizon === "month" ? 0.04 : horizon === "week" ? 0.025 : 0.018;
  return Math.max(-cap, Math.min(cap, raw));
}

/** 스냅샷 배열에서 SK 계열 종목에 하이닉스 일정·호재 병합 */
export function enrichSkGroupSnapshots(snaps: StockSnapshot[]): void {
  const leader = snaps.find((s) => s.meta.code === SK_HYNIX_CODE);
  if (!leader?.upcomingEvents?.length) return;

  for (const snap of snaps) {
    if (!isSkGroupMember(snap.meta.code)) continue;
    snap.upcomingEvents = dedupeEventItems(
      inheritSkLeaderEvents(
        snap.meta.code,
        snap.upcomingEvents ?? [],
        leader.upcomingEvents
      )
    );
  }
}
