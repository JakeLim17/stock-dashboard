import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type Variant = "buy" | "add" | "hold" | "watch" | "sell" | "neutral" | "warn" | "good" | "bad";

const STYLES: Record<Variant, string> = {
  buy: "bg-up/15 text-up border-up/30",
  add: "bg-up/10 text-up border-up/20",
  hold: "bg-muted text-muted-foreground border-border",
  watch: "bg-warn/15 text-warn border-warn/30",
  sell: "bg-down/15 text-down border-down/30",
  neutral: "bg-muted text-muted-foreground border-border",
  warn: "bg-warn/15 text-warn border-warn/30",
  good: "bg-up/10 text-up border-up/20",
  bad: "bg-down/10 text-down border-down/20",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  size?: "sm" | "md";
}

export function Badge({ variant = "neutral", size = "sm", className, ...props }: BadgeProps) {
  const sizing = size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        sizing,
        STYLES[variant],
        className
      )}
      {...props}
    />
  );
}
