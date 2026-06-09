import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";
import { SummaryBarSkeleton } from "./SummaryBarSkeleton";
import { PredictionHeroSkeleton } from "./PredictionHeroSkeleton";
import { StockCardSkeleton } from "./StockCardSkeleton";
import { MarketPanelSkeleton } from "./MarketPanelSkeleton";
import { NewsPanelSkeleton } from "./NewsPanelSkeleton";
import { PanelSkeleton } from "./PanelSkeleton";

// 메인 대시보드 전체 윤곽 — DashboardClient가 마운트되기 전 Suspense fallback.
// 실제 페이지 레이아웃과 같은 순서·비율로 자리잡아 데이터 도착 후 화면 점프 최소화.
//
// "YouTube 홈 썸네일이 하나씩 채워지는 느낌" — 사용자가 첫 진입 시 빈 화면이 아닌
// 페이지 구조가 즉시 보이고, 데이터가 도착하면 부드럽게 채워진다.
//
// Phase 2A: marketPanelSlot / newsPanelSlot 을 옵션으로 받는다 — page.tsx 가 빠른
// 영역(market indicators · news)을 먼저 fetch 해 둔 경우, 해당 영역만 실제 컴포넌트를
// 끼워 넣어 streaming 효과를 준다. 안 넘기면 기존 skeleton 그대로.
interface DashboardSkeletonProps {
  marketPanelSlot?: ReactNode;
  newsPanelSlot?: ReactNode;
}

export function DashboardSkeleton({
  marketPanelSlot,
  newsPanelSlot,
}: DashboardSkeletonProps = {}) {
  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 space-y-6">
      {/* 헤더 (제목 + 도구 버튼들) */}
      <header className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48 rounded" />
          <Skeleton className="h-3 w-32 rounded" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
      </header>

      {/* SummaryBar */}
      <SummaryBarSkeleton />

      {/* 관심종목 도구바 */}
      <section className="flex items-center flex-wrap gap-2">
        <Skeleton className="h-3 w-16 rounded" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="ml-auto h-3 w-12 rounded" />
      </section>

      {/* 추천 패널 (접힘) */}
      <PanelSkeleton title height="h-14" />

      {/* 테마 그룹 (접힘) */}
      <PanelSkeleton title height="h-14" />

      {/* PredictionHero */}
      <PredictionHeroSkeleton />

      {/* StockDetailPanel — 탭 구조 */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-5 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="ml-auto h-7 w-16 rounded-md" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>

      {/* 종목 카드 grid */}
      <StockCardSkeleton />

      {/* 차트 + 마켓 패널 + 이벤트 캘린더
          marketPanelSlot 이 들어오면 실제 시장 신호 카드가 표시되어
          watchlist 대기 중에도 사용자가 시장 상태를 먼저 본다. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <PanelSkeleton title height="h-72" />
        </div>
        <div className="space-y-4">
          {marketPanelSlot ?? <MarketPanelSkeleton />}
          <PanelSkeleton title height="h-40" />
        </div>
      </div>

      {/* 뉴스 — newsPanelSlot 으로 실제 뉴스가 들어오면 streaming 효과 */}
      {newsPanelSlot ?? <NewsPanelSkeleton />}

      {/* 푸터 */}
      <div className="flex flex-col items-center gap-2 py-4">
        <Skeleton className="h-3 w-80 rounded" />
        <Skeleton className="h-3 w-64 rounded" />
      </div>
    </div>
  );
}
