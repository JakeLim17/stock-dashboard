"use client";

import type { OpportunityAssessment } from "@/lib/types";
import { Badge } from "./ui/Badge";
import { Sparkles } from "lucide-react";

// 외부 호재 점수 배지 (RiskBadge 미러).
// low면 null 반환 — 자리 차지 없음.
// medium/high면 초록 배지 + 대표 driver 라벨.
export function OpportunityBadge({
  assessment,
  size = "sm",
}: {
  assessment: OpportunityAssessment | undefined | null;
  size?: "sm" | "md";
}) {
  if (!assessment || assessment.level === "low") return null;

  // good = 초록 계열 (bg-up/10). high면 buy 톤(더 진함), medium은 good.
  const variant = assessment.level === "high" ? "buy" : "good";
  const top = assessment.drivers[0]?.label;
  const title =
    assessment.drivers
      .slice(0, 3)
      .map((d) => `· ${d.label} (${d.category})`)
      .join("\n") || `외부 호재 점수 ${assessment.score}`;

  return (
    <Badge variant={variant} size={size} title={title}>
      <Sparkles className="h-3 w-3" />
      {assessment.level === "high"
        ? `호재 ↑ ${assessment.matchCount}건`
        : `호재 ${assessment.matchCount}건`}
      {top && <span className="opacity-80">· {top}</span>}
    </Badge>
  );
}
