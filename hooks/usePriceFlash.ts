"use client";

import { useEffect, useRef, useState } from "react";

export type FlashDirection = "up" | "down" | null;

// 값 변경을 감지해 "up" | "down" 방향을 잠시 반환하는 훅.
// 첫 마운트는 무시(prev가 null) — 페이지 진입과 동시에 모든 카드가 깜빡이는 걸 방지한다.
// durationMs 후 자동으로 null로 돌아가 부모 컴포넌트가 애니메이션 클래스를 떼낸다.
export function usePriceFlash(
  value: number | null | undefined,
  durationMs = 600,
): FlashDirection {
  const prev = useRef<number | null>(null);
  const [direction, setDirection] = useState<FlashDirection>(null);

  useEffect(() => {
    if (value == null || Number.isNaN(value)) {
      prev.current = null;
      return;
    }
    const previous = prev.current;
    prev.current = value;
    if (previous != null && value !== previous) {
      setDirection(value > previous ? "up" : "down");
      const t = setTimeout(() => setDirection(null), durationMs);
      return () => clearTimeout(t);
    }
  }, [value, durationMs]);

  return direction;
}
