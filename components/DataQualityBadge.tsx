"use client";

import type { DataQualityInfo } from "@/lib/types";
import { Badge } from "./ui/Badge";

/** IPO·얇은 히스토리·해외 수급 미제공 등 데이터 품질 안내 배지. */
export function DataQualityBadge({
  dq,
  className,
}: {
  dq?: DataQualityInfo | null;
  className?: string;
}) {
  if (!dq) return null;

  const badges: Array<{
    key: string;
    label: string;
    variant: "warn" | "neutral";
    title?: string;
  }> = [];

  if (dq.overseasNoFlow) {
    badges.push({
      key: "overseas",
      label: "수급 미제공 (해외)",
      variant: "neutral",
      title: "한국 외 종목은 외인·기관 수급 API가 없습니다",
    });
  }

  if (dq.thinHistory) {
    badges.push({
      key: "thin",
      label: `데이터 축적 중 (${dq.historyDays}일)`,
      variant: "warn",
      title: `거래 이력 ${dq.historyDays}일 — 30일 미만이면 변동 구간·단기 신호를 보수 처리합니다`,
    });
  }

  if (badges.length === 0) return null;

  return (
    <span className={`inline-flex flex-wrap gap-1 ${className ?? ""}`}>
      {badges.map((b) => (
        <Badge key={b.key} variant={b.variant} size="sm" title={b.title}>
          {b.label}
        </Badge>
      ))}
    </span>
  );
}

/** modelConfidence·thinHistory 기반 짧은 힌트 문구. */
export function predictionQualityHint(input: {
  dq?: DataQualityInfo | null;
  modelConfidenceLabel?: "high" | "medium" | "low" | null;
}): string | null {
  if (input.dq?.thinHistory) {
    return `거래 이력 ${input.dq.historyDays}일 — 변동 참고 구간·단기 신호는 데이터 부족으로 제한됩니다.`;
  }
  if (input.modelConfidenceLabel === "low") {
    return "모델 신뢰도 낮음 — 변동 구간은 통계 참고용이며 방향 예측이 아닙니다.";
  }
  if (input.modelConfidenceLabel === "medium") {
    return "모델 신뢰도 보통 — 변동 구간은 참고용입니다.";
  }
  return null;
}
