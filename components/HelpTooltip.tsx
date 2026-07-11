"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

/**
 * 전역 도움말 툴팁 — hover(데스크탑) + tap(모바일) 지원.
 * prefers-reduced-motion 시 즉시 표시/숨김.
 */
export function HelpTooltip({
  content,
  label = "도움말",
  side = "top",
  className = "",
}: {
  content: string;
  label?: string;
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const posClass =
    side === "bottom"
      ? "top-full mt-1.5 left-1/2 -translate-x-1/2"
      : "bottom-full mb-1.5 left-1/2 -translate-x-1/2";

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className="inline-flex items-center justify-center h-4 w-4 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute z-50 ${posClass} w-max max-w-[min(280px,calc(100vw-2rem))] px-2.5 py-2 text-[11px] leading-snug text-foreground bg-popover border border-border rounded-lg shadow-md ${
            reducedMotion ? "" : "animate-in fade-in zoom-in-95 duration-150"
          }`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
