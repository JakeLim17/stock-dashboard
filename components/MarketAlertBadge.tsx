"use client";

import type { MarketAlert, MarketAlertLevel } from "@/lib/types";
import { AlertOctagon, AlertTriangle, Ban, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// 한국거래소 시장경보 배지.
// Badge 컴포넌트의 표준 variant(buy/sell/watch 등)로는 주황·보라 색을 못 내서
// inline 색상 클래스를 직접 매핑한다. Tailwind JIT가 안전하게 픽업하도록
// 클래스 문자열을 정적 상수로 둔다.
//
// 색상 매핑 (요청서 §7):
//   caution → 노랑(amber)   투자주의
//   warning → 주황(orange)  투자경고
//   risk    → 빨강(red)     투자위험
//   halt    → 회색(zinc)    거래정지
//   admin   → 보라(purple)  관리종목

const LEVEL_CLASSES: Record<MarketAlertLevel, string> = {
  caution:
    "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  warning:
    "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/35",
  risk: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/35",
  halt: "bg-zinc-500/20 text-zinc-700 dark:text-zinc-300 border-zinc-500/40",
  admin:
    "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/35",
};

function LevelIcon({ level }: { level: MarketAlertLevel }) {
  switch (level) {
    case "caution":
      return <AlertTriangle className="h-3 w-3" aria-hidden />;
    case "warning":
      return <AlertOctagon className="h-3 w-3" aria-hidden />;
    case "risk":
      return <ShieldAlert className="h-3 w-3" aria-hidden />;
    case "halt":
      return <Ban className="h-3 w-3" aria-hidden />;
    case "admin":
      return <ShieldAlert className="h-3 w-3" aria-hidden />;
  }
}

const SIZE_CLASSES: Record<"sm" | "md" | "lg", string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-3 py-1 text-sm",
  lg: "px-3.5 py-1.5 text-base font-semibold",
};

const LEVEL_TOOLTIP: Record<MarketAlertLevel, string> = {
  caution: "투자주의: 단기 급등 — 1일 주의 단계",
  warning: "투자경고: 추가 상승 시 매매 거래정지 가능",
  risk: "투자위험: 더 오르면 즉시 1일 거래정지",
  halt: "거래정지: 매매 불가",
  admin: "관리종목: 상장 폐지 위험 단계",
};

export function MarketAlertBadge({
  alert,
  size = "sm",
  className,
}: {
  alert: MarketAlert | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (!alert) return null;
  return (
    <span
      title={LEVEL_TOOLTIP[alert.level]}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        SIZE_CLASSES[size],
        LEVEL_CLASSES[alert.level],
        className
      )}
    >
      <LevelIcon level={alert.level} />
      {alert.label}
    </span>
  );
}
