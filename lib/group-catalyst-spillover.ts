import { getGroupCatalystPeer } from "./symbol-groups";
import type {
  GroupLeaderContext,
  NewsOpportunityLevel,
  StockSnapshot,
} from "./types";

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** 리더 분석이 계열사 fair-value 매크로에 줄 bps (0.01% 단위) */
export function computeGroupLeaderSpilloverBps(
  ctx: GroupLeaderContext | null | undefined
): number {
  if (!ctx) return 0;
  let bps = 0;
  const share = ctx.catalystShare;
  if (ctx.leaderBuyScore >= 55) {
    bps += Math.round((ctx.leaderBuyScore - 50) * 3.5 * share);
  }
  if (ctx.leaderMomentum) bps += Math.round(16 * share);
  if (ctx.opportunityLevel === "high") bps += Math.round(20 * share);
  else if (ctx.opportunityLevel === "medium") bps += Math.round(9 * share);
  return Math.min(bps, 42);
}

function boostOpportunityLevel(
  current: NewsOpportunityLevel,
  leader: NewsOpportunityLevel
): NewsOpportunityLevel {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const next = Math.max(rank[current], rank[leader] - 1);
  return next >= 2 ? "high" : next >= 1 ? "medium" : "low";
}

/** 워치리스트 스냅샷 배열 — 리더→계열 buy/heat·호재·UI 컨텍스트 (추가 API 없음) */
export function applyGroupCatalystSpillover(primaries: StockSnapshot[]): void {
  const byCode = new Map(primaries.map((s) => [s.meta.code, s]));

  for (const snap of primaries) {
    const peer = getGroupCatalystPeer(snap.meta.code);
    if (!peer) continue;
    const leader = byCode.get(peer.leaderCode);
    if (!leader) continue;

    const leaderBuy = leader.analysis.buyScore;
    const leaderMom = !!leader.analysis.verdict.momentumOverride;
    const leaderOpp = leader.analysis.externalOpportunity?.level ?? "low";

    const ctx: GroupLeaderContext = {
      leaderCode: peer.leaderCode,
      leaderName: leader.meta.name,
      catalystShare: peer.catalystShare,
      label: peer.label,
      leaderBuyScore: leaderBuy,
      leaderMomentum: leaderMom,
      opportunityLevel: leaderOpp,
    };
    snap.groupLeaderContext = ctx;

    const buyDelta = Math.max(0, leaderBuy - 52) * 0.2 * peer.catalystShare;
    const heatDelta =
      leaderMom || leaderBuy >= 58
        ? -Math.round(6 * peer.catalystShare)
        : 0;
    const meaningful =
      buyDelta >= 2 || heatDelta !== 0 || leaderOpp !== "low" || leaderMom;
    if (!meaningful) continue;

    const buy = clamp(snap.analysis.buyScore + Math.round(buyDelta));
    const heat = clamp(snap.analysis.heatScore + heatDelta);
    const linkReason = `SK 계열 호재 연동 — ${peer.label}`;

    let externalOpportunity = snap.analysis.externalOpportunity;
    if (leaderOpp !== "low" && externalOpportunity) {
      const boosted = boostOpportunityLevel(
        externalOpportunity.level,
        leaderOpp
      );
      if (boosted !== externalOpportunity.level) {
        externalOpportunity = {
          ...externalOpportunity,
          level: boosted,
          drivers: [
            {
              label: linkReason,
              category: "group",
              headline: `${leader.meta.name} 호재 전이`,
              date: Date.now(),
              weight: 4,
              contribution: 4 * peer.catalystShare,
            },
            ...externalOpportunity.drivers,
          ].slice(0, 5),
        };
      }
    }

    const shortScore = clamp(50 + Math.round((buy - heat) / 2));
    const shortReasons = [
      `+ ${linkReason} (${leader.meta.name} 매수 ${leaderBuy})`,
      ...snap.analysis.shortTerm.reasons,
    ].slice(0, 3);

    snap.analysis = {
      ...snap.analysis,
      buyScore: buy,
      heatScore: heat,
      externalOpportunity,
      shortTerm: {
        ...snap.analysis.shortTerm,
        score: shortScore,
        reasons: shortReasons,
      },
      reasons: shortReasons,
    };
  }
}