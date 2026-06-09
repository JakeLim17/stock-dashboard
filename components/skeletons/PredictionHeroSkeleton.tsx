import { Skeleton } from "./Skeleton";

// PredictionHero 영역의 큰 hero 카드 (좌: 종목명/가격, 중: 예측 막대, 우: 게이지).
// 3-col 그리드 비율을 미리 잡아 hydration 시점 점프를 막는다.
export function PredictionHeroSkeleton() {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm p-5 md:p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-8 items-start">
        {/* 좌: 종목명 + 현재가 + verdict */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-9 w-40 rounded" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
        {/* 중: 1일/7일 예측 막대 */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-12 rounded" />
            <Skeleton className="h-3 w-full rounded-full" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-12 rounded" />
            <Skeleton className="h-3 w-full rounded-full" />
          </div>
        </div>
        {/* 우: 매수/매도 강도 + R-R */}
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-2">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-12 w-12 rounded-full" />
          </div>
          <Skeleton className="h-3 w-24 rounded" />
        </div>
      </div>
    </section>
  );
}
