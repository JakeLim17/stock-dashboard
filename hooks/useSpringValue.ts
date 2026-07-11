"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * 목표값으로 스프링 보간. 미터 fill·마커 위치용.
 * reduced-motion 이면 즉시 스냅.
 */
export function useSpringValue(
  target: number,
  opts?: { stiffness?: number; damping?: number; precision?: number },
): number {
  const stiffness = opts?.stiffness ?? 180;
  const damping = opts?.damping ?? 22;
  const precision = opts?.precision ?? 0.05;
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  const stateRef = useRef({ x: target, v: 0 });

  useEffect(() => {
    if (reduced) {
      stateRef.current = { x: target, v: 0 };
      setValue(target);
      return;
    }

    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const { x, v } = stateRef.current;
      const spring = -stiffness * (x - target);
      const damp = -damping * v;
      const nextV = v + (spring + damp) * dt;
      const nextX = x + nextV * dt;
      stateRef.current = { x: nextX, v: nextV };
      setValue(nextX);
      if (Math.abs(nextX - target) > precision || Math.abs(nextV) > precision) {
        raf = requestAnimationFrame(step);
      } else {
        stateRef.current = { x: target, v: 0 };
        setValue(target);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, stiffness, damping, precision, reduced]);

  return value;
}
