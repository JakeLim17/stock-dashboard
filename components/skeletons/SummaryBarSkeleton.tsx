import { Skeleton } from "./Skeleton";

// SummaryBar는 가로로 흩어진 라벨+값 stat 6~7개. 실제 컴포넌트 비율을 흉내내
// 첫 화면에서 레이아웃이 튀지 않게 한다.
export function SummaryBarSkeleton() {
  return (
    <div className="bg-card border border-border rounded-2xl px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3 shadow-sm">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-14 rounded" />
          <Skeleton className="h-5 w-20 rounded" />
        </div>
      ))}
      <div className="ml-auto">
        <Skeleton className="h-3 w-32 rounded" />
      </div>
    </div>
  );
}
