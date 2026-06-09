import { Skeleton } from "./Skeleton";

// 펼침/접힘 패널(RecommendationsPanel, ThemeGroupView, EventCalendar, StockDetailPanel,
// PriceChart 등)의 기본 자리. 헤더 + 본문 placeholder만 잡아 화면 점프를 막는다.
// height는 props로 조절 가능.
export function PanelSkeleton({
  title = true,
  height = "h-24",
  className = "",
}: {
  title?: boolean;
  height?: string;
  className?: string;
}) {
  return (
    <div
      className={`bg-card text-card-foreground rounded-2xl border border-border shadow-sm overflow-hidden ${className}`}
    >
      {title && (
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <Skeleton className="h-4 w-28 rounded" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      )}
      <div className="px-5 pb-5">
        <Skeleton className={`w-full ${height} rounded-xl`} />
      </div>
    </div>
  );
}
