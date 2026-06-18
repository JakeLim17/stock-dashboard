"use client";

import type { StockSnapshot } from "@/lib/types";
import { collectVerdictBullets } from "@/lib/prediction-display";

/** ActionVerdict 옆·아래 — 왜 이 verdict인지 근거 2~3줄 (접기/펼치기) */
export function VerdictReasonBullets({
  snap,
  marketSemiHeat,
  className,
}: {
  snap: StockSnapshot;
  /** DashboardSnapshot.marketMood.semiHeat — 시장 전체 반도체 과열 */
  marketSemiHeat?: number | null;
  className?: string;
}) {
  const bullets = collectVerdictBullets(snap, marketSemiHeat);
  if (bullets.length === 0) return null;

  return (
    <details
      className={`group text-left [&_summary::-webkit-details-marker]:hidden ${className ?? ""}`}
    >
      <summary
        className="cursor-pointer list-none text-[10px] text-muted-foreground hover:text-foreground select-none inline-flex items-center gap-1"
      >
        <span className="group-open:hidden">왜 이 결론? ▾</span>
        <span className="hidden group-open:inline">근거 닫기 ▴</span>
      </summary>
      <ul className="mt-1 space-y-0.5 text-[10px] text-muted-foreground leading-snug pl-0.5">
        {bullets.map((b) => (
          <li key={b} className="flex gap-1">
            <span className="shrink-0">·</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
