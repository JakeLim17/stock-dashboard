import { Skeleton } from "./Skeleton";

// NewsPanel 큰 카드 — 헤더(필터 칩) + 뉴스 리스트 N개.
export function NewsPanelSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="bg-card text-card-foreground rounded-2xl border border-border shadow-sm">
      <div className="px-5 pt-5 pb-3 flex items-center justify-between flex-wrap gap-2">
        <Skeleton className="h-4 w-24 rounded" />
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-12 rounded-md" />
          <Skeleton className="h-6 w-12 rounded-md" />
          <Skeleton className="h-6 w-12 rounded-md" />
        </div>
      </div>
      <div className="px-5 pb-5">
        <ul className="space-y-3">
          {Array.from({ length: count }).map((_, i) => (
            <li
              key={i}
              className="border-b border-border pb-3 last:border-0 flex items-start gap-2"
            >
              <Skeleton className="mt-1.5 h-2 w-2 rounded-full shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-[88%] rounded" />
                <Skeleton className="h-4 w-[64%] rounded" />
                <div className="flex items-center gap-2 mt-1.5">
                  <Skeleton className="h-3 w-16 rounded" />
                  <Skeleton className="h-3 w-12 rounded" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
