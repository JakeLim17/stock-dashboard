"use client";

import { Crown } from "lucide-react";
import type { SymbolMeta } from "@/lib/types";

// 분야 "대장주" 표시 배지 (재미 요소).
// SymbolMeta.isSectorLeader === true 일 때만 노출.
// amber/gold 톤 — 다른 배지(신호/리스크) 색과 충돌 없이 fun 강조.
//
// size:
//   "sm" : StockCard 헤더 옆, 일반 카드 등 작은 위치
//   "xs" : RecommendationsPanel 카드 등 작은 카드 안
export function SectorLeaderBadge({
  meta,
  size = "sm",
}: {
  meta?: Pick<SymbolMeta, "isSectorLeader" | "sectorLeaderLabel"> | null;
  size?: "xs" | "sm";
}) {
  if (!meta?.isSectorLeader) return null;
  const label = meta.sectorLeaderLabel ?? "분야 대장";
  const sizeClass =
    size === "xs"
      ? "px-1.5 py-0 text-[10px] gap-0.5"
      : "px-2 py-0.5 text-xs gap-1";
  const iconClass = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium tabular bg-amber-500/15 text-amber-600 border-amber-500/40 dark:text-amber-400 dark:bg-amber-400/15 dark:border-amber-400/40 ${sizeClass}`}
      title={`${label} — 분야 시총·영향력 1위`}
    >
      <Crown className={iconClass} aria-hidden />
      <span>{label}</span>
    </span>
  );
}
