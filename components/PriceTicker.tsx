"use client";

import { useEffect, useRef, useState } from "react";
import { usePriceFlash } from "@/hooks/usePriceFlash";

export interface PriceTickerProps {
  /** 표시할 숫자. null/undefined면 "—" 노출. */
  value: number | null | undefined;
  /** 소수 자리수. 가격은 0, 환율·지수는 2 권장. */
  decimals?: number;
  /** 카운트업 애니메이션 시간 (ms). 0이면 즉시 표시. */
  animateMs?: number;
  /** flash + pulse 효과를 끄고 싶을 때 (예: 작은 보조 표시). */
  noFlash?: boolean;
  /** "—" 등 빈 값 표기 (기본값: "—"). */
  emptyLabel?: string;
  className?: string;
}

// 가격 변동 시각화 컴포넌트
//   1. 값이 바뀌면 rAF 기반 easeOutCubic 카운트업 (기본 0.5s)
//   2. 동시에 상승/하락 방향에 따라 flash-up/down 배경 + pulse-up/down 살짝 흔들림 (0.6s/0.4s)
//   3. 폴링 간격(5s)보다 짧게 끝나도록 시간 튜닝 — 다음 업데이트와 겹치지 않게
//
// 다크/라이트 모드 둘 다에서 잘 보이도록 keyframe은 RGBA 직접 사용 (globals.css 참조).
export function PriceTicker({
  value,
  decimals = 0,
  animateMs = 500,
  noFlash = false,
  emptyLabel = "—",
  className = "",
}: PriceTickerProps) {
  const safeValue =
    value == null || Number.isNaN(value) ? null : value;
  const numericForFlash = safeValue ?? 0;
  const direction = usePriceFlash(safeValue);

  // display는 카운트업 진행 중 보이는 보간값. safeValue가 null이면 0을 두고 화면엔 emptyLabel.
  const [display, setDisplay] = useState<number>(safeValue ?? 0);
  const fromRef = useRef<number>(safeValue ?? 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (safeValue == null) {
      setDisplay(0);
      fromRef.current = 0;
      return;
    }
    if (animateMs <= 0) {
      setDisplay(safeValue);
      fromRef.current = safeValue;
      return;
    }
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const from = fromRef.current;
    const to = safeValue;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / animateMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const v = from + (to - from) * eased;
      setDisplay(v);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // animateMs가 바뀔 일은 거의 없지만 변경 시 재기동하기 위해 deps에 포함.
  }, [safeValue, animateMs]);

  const flashClass =
    noFlash || !direction
      ? ""
      : direction === "up"
        ? "flash-up pulse-up"
        : "flash-down pulse-down";

  if (safeValue == null) {
    return (
      <span
        className={`inline-block tabular ${className}`}
        aria-label={`${emptyLabel}`}
      >
        {emptyLabel}
      </span>
    );
  }

  return (
    <span
      className={`inline-block tabular px-1 -mx-1 rounded ${flashClass} ${className}`}
      // 스크린 리더는 보간값이 아닌 실제 값을 읽도록.
      aria-live="polite"
      aria-label={numericForFlash.toLocaleString("ko-KR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    >
      {display.toLocaleString("ko-KR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </span>
  );
}
