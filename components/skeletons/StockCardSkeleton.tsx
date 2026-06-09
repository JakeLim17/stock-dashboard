import { Skeleton } from "./Skeleton";

// 개별 종목 카드 스켈레톤 — 헤더 + 가격 + 시그널 배지 라인 + 작은 메트릭 3개.
function SingleCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
        </div>
        <Skeleton className="h-6 w-14 rounded-full" />
      </div>
      <div className="flex items-end gap-2">
        <Skeleton className="h-7 w-28 rounded" />
        <Skeleton className="h-4 w-16 rounded" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Skeleton className="h-5 w-12 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-10 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
        <Skeleton className="h-8 rounded" />
        <Skeleton className="h-8 rounded" />
        <Skeleton className="h-8 rounded" />
      </div>
    </div>
  );
}

// StockCard grid — watchlist 개수만큼 카드 자리를 미리 잡아둔다.
// 기본 6개 (모바일/태블릿/데스크탑 1·2·3-col 어디서나 자연스러움).
export function StockCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SingleCardSkeleton key={i} />
      ))}
    </div>
  );
}
