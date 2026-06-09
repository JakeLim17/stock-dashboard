"use client";

import type { VolatilityAssessment } from "@/lib/types";
import { Badge } from "./ui/Badge";
import { Activity, AlertTriangle } from "lucide-react";

// 변동성("사팔사팔") 배지.
// stable이면 null — 자리 차지 없음.
// moderate는 회색, high는 watch 톤, gambling은 sell 톤 + 강한 라벨.
//
// StockCard / StockDetailPanel 헤더 배지 라인에 RiskBadge / OpportunityBadge 와 함께 노출.
// title(툴팁)에 상위 driver 3개를 한 줄씩 노출.
export function VolatilityBadge({
  assessment,
  size = "sm",
}: {
  assessment: VolatilityAssessment | undefined | null;
  size?: "sm" | "md";
}) {
  if (!assessment) return null;
  if (assessment.level === "stable") return null;

  const variant =
    assessment.level === "gambling"
      ? "sell"
      : assessment.level === "high"
        ? "watch"
        : "neutral";

  const label =
    assessment.level === "gambling"
      ? `도박장 ⚠ ${assessment.score}`
      : assessment.level === "high"
        ? `고변동 ${assessment.score}`
        : `변동성 ${assessment.score}`;

  const Icon = assessment.level === "gambling" ? AlertTriangle : Activity;

  const title = [
    `변동성 점수 ${assessment.score}/100`,
    ...assessment.drivers
      .slice(0, 4)
      .map((d) => `· ${d.label} (+${d.contribution.toFixed(1)})`),
    assessment.intradayUsed ? "분봉 가중 적용" : "일봉 기반",
  ].join("\n");

  // 도박장 등급은 살짝 흔들림으로 시각적 경고 강화. (prefers-reduced-motion 시 자동 무효)
  const className = assessment.level === "gambling" ? "shake-soft" : undefined;

  return (
    <Badge variant={variant} size={size} title={title} className={className}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}
