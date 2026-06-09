import { Suspense } from "react";
import { DashboardClient } from "@/components/DashboardClient";
import { LoadingScreen } from "@/components/LoadingScreen";
import { DashboardSkeleton } from "@/components/skeletons/DashboardSkeleton";
import { MarketPanel } from "@/components/MarketPanel";
import { NewsPanel } from "@/components/NewsPanel";
import {
  buildMarketMood,
  cachedMarketIndicators,
  cachedNewsItems,
  fetchMacroEvents,
  fetchWatchlistSnapshots,
  type MarketIndicatorsResult,
} from "@/lib/snapshot";
import type { DashboardSnapshot, NewsItem } from "@/lib/types";

// 매 요청마다 새로 (라이브 데이터)
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Phase 2A — 2 단계 Suspense streaming SSR 구조.
//
//   외부 Suspense (fallback: LoadingScreen)
//     첫 진입 즉시 풀스크린 단계 메시지·카운트다운·progress bar 가 stream 된다.
//     로그인 직후 form POST→303 redirect 흐름에선 app/loading.tsx 가 안 트리거되므로
//     이 fallback 이 첫 로딩 UX 의 단독 책임자다 — 절대 회귀시키지 말 것.
//
//   DashboardLoader  (빠른 영역 ~1-2초)
//     market indicators · news 만 await. 둘이 도착하면 곧바로 내부 Suspense 트리를 반환.
//     이 시점에 외부 LoadingScreen 이 사라지고 사용자는 페이지 윤곽 + 실제 시장 신호 +
//     실제 뉴스 패널을 본다 (DashboardSkeleton 의 marketPanelSlot · newsPanelSlot).
//
//   내부 Suspense (fallback: DashboardSkeleton + fast-paint slots)
//     watchlist 분석을 기다리는 동안에도 사용자는 빈 화면이 아닌 시장 신호 + 뉴스를 본다.
//
//   WatchlistLoader  (전체 데이터 ~3-5초)
//     watchlist · 컨센서스 · 시장경보 등 무거운 분석 완료 후 DashboardClient 마운트.
//     DashboardClient 가 polling 통합 관리 (변경 없음) — 회귀 위험 0.
//
// React.cache 로 cachedMarketIndicators · cachedNewsItems 가 같은 SSR request 내에서
// DashboardLoader · WatchlistLoader 둘 다 호출되어도 외부 fetch 는 1 회만 일어난다.
export default function HomePage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DashboardLoader />
    </Suspense>
  );
}

async function DashboardLoader() {
  // 빠른 두 영역 병렬 fetch. cachedNewsItems 는 실패해도 빈 배열로 계속 — 뉴스가
  // 잠시 비어도 SummaryBar/StockGrid 는 동작하므로 치명적이지 않다.
  const [indicatorResult, news] = await Promise.all([
    cachedMarketIndicators(),
    cachedNewsItems().catch(() => [] as NewsItem[]),
  ]);

  // fast-paint slot — DashboardSkeleton(내부 Suspense fallback) 안에 직접 끼워 넣어
  // watchlist 도착 전이라도 사용자가 실제 시장 신호·뉴스 카드를 볼 수 있게 한다.
  // selectedSymbol 은 watchlist 도착 전이라 null — 필터 버튼만 잠시 숨겨진다.
  const marketPanelSlot = <MarketPanel indicators={indicatorResult.indicators} />;
  const newsPanelSlot = <NewsPanel items={news} selectedSymbol={null} />;

  return (
    <Suspense
      fallback={
        <DashboardSkeleton
          marketPanelSlot={marketPanelSlot}
          newsPanelSlot={newsPanelSlot}
        />
      }
    >
      <WatchlistLoader indicatorResult={indicatorResult} news={news} />
    </Suspense>
  );
}

async function WatchlistLoader({
  indicatorResult,
  news,
}: {
  indicatorResult: MarketIndicatorsResult;
  news: NewsItem[];
}) {
  let initial: DashboardSnapshot;
  try {
    const watchResult = await fetchWatchlistSnapshots(undefined, {
      indicators: indicatorResult.indicators,
      news,
      context: indicatorResult.context,
      usdKrw: indicatorResult.usdKrw,
    });
    initial = {
      generatedAt: Date.now(),
      primaries: watchResult.primaries,
      indicators: indicatorResult.indicators,
      marketMood: buildMarketMood(
        indicatorResult.indicators,
        news,
        indicatorResult.context.semiHeat
      ),
      news,
      errors: { ...indicatorResult.errors, ...watchResult.errors },
      macroEvents: fetchMacroEvents(),
    };
  } catch (e) {
    // watchlist 분석이 통째로 실패해도 indicators · news 는 살아 있으므로 그것만이라도
    // 표시. 클라이언트가 곧 polling 으로 재시도한다.
    initial = {
      generatedAt: Date.now(),
      primaries: [],
      indicators: indicatorResult.indicators,
      marketMood: buildMarketMood(
        indicatorResult.indicators,
        news,
        indicatorResult.context.semiHeat
      ),
      news,
      errors: {
        ...indicatorResult.errors,
        watchlist: e instanceof Error ? e.message : String(e),
      },
      macroEvents: fetchMacroEvents(),
    };
  }
  return <DashboardClient initial={initial} />;
}
