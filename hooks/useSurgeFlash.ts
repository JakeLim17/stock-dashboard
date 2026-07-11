"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

export type SurgeKind = "up" | "down" | null;

/** 등락률 |rate| ≥ threshold 일 때 짧은 pulse 방향. 가격 틱마다 재트리거. */
export function useSurgeFlash(
  changeRate: number | null | undefined,
  opts?: { threshold?: number; durationMs?: number; priceTick?: number | null },
): SurgeKind {
  const threshold = opts?.threshold ?? 0.03;
  const durationMs = opts?.durationMs ?? 700;
  const priceTick = opts?.priceTick;
  const reduced = useReducedMotion();
  const [surge, setSurge] = useState<SurgeKind>(null);
  const prevTick = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced) {
      setSurge(null);
      return;
    }
    if (changeRate == null || !Number.isFinite(changeRate)) return;
    if (Math.abs(changeRate) < threshold) return;

    const tick = priceTick ?? changeRate;
    const prev = prevTick.current;
    prevTick.current = tick;
    // 첫 마운트도 급등이면 한 번 보여 주기 (카드 진입 재미)
    if (prev === tick && prev != null) return;

    setSurge(changeRate > 0 ? "up" : "down");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSurge(null), durationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [changeRate, threshold, durationMs, priceTick, reduced]);

  return surge;
}
