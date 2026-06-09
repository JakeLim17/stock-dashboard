import { Skeleton } from "./Skeleton";

// MarketPanel 측면 카드 — 시장 지표(나스닥/SOX/NVDA/환율/VIX) 5~6줄.
export function MarketPanelSkeleton() {
  return (
    <div className="bg-card text-card-foreground rounded-2xl border border-border shadow-sm">
      <div className="px-5 pt-5 pb-3">
        <Skeleton className="h-4 w-20 rounded" />
      </div>
      <div className="px-5 pb-5">
        <ul className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-2 w-2 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-20 rounded" />
                  <Skeleton className="h-2.5 w-14 rounded" />
                </div>
              </div>
              <div className="text-right space-y-1.5">
                <Skeleton className="h-3.5 w-16 rounded ml-auto" />
                <Skeleton className="h-2.5 w-12 rounded ml-auto" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
