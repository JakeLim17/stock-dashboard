"use client";

import type { CSSProperties } from "react";
import { useSpringValue } from "@/hooks/useSpringValue";
import type { SurgeKind } from "@/hooks/useSurgeFlash";

export interface AnimatedMeterProps {
  /** 0~100 */
  value: number;
  /** Tailwind fill 클래스 (예: bg-up, bg-accent) */
  fillClass: string;
  /** 트랙 높이 클래스 */
  heightClass?: string;
  /** 급등·급락 pulse/glow */
  surge?: SurgeKind;
  className?: string;
  title?: string;
}

/**
 * 스프링 fill 미터. 값이 바뀌면 튕기듯 따라가고,
 * surge 시 짧은 glow (globals.css meter-surge-*).
 */
export function AnimatedMeter({
  value,
  fillClass,
  heightClass = "h-1.5",
  surge = null,
  className = "",
  title,
}: AnimatedMeterProps) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const sprung = useSpringValue(safe);
  const width = Math.max(0, Math.min(100, sprung));

  const surgeClass =
    surge === "up"
      ? "meter-surge-up"
      : surge === "down"
        ? "meter-surge-down"
        : "";

  return (
    <div
      className={`${heightClass} w-full bg-muted rounded-full overflow-hidden ${surgeClass} ${className}`}
      title={title}
    >
      <div
        className={`h-full rounded-full ${fillClass}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/** 가로 범위 바의 마커 left% 스프링용 래퍼 */
export function AnimatedMarker({
  pct,
  className = "",
  title,
  style,
}: {
  pct: number;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  const safe = Math.max(0, Math.min(100, pct));
  const sprung = useSpringValue(safe);
  return (
    <div
      className={className}
      title={title}
      style={{
        ...style,
        left: `calc(${Math.max(0, Math.min(100, sprung))}% - 2px)`,
      }}
    />
  );
}
