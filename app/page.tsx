import { Suspense } from "react";
import { DashboardClient } from "@/components/DashboardClient";
import { DashboardSkeleton } from "@/components/skeletons/DashboardSkeleton";
import { buildSnapshot } from "@/lib/snapshot";

// 매 요청마다 새로 (라이브 데이터)
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Suspense streaming SSR 구조.
//
//  1. 페이지 진입 즉시 layout.tsx + Suspense fallback(DashboardSkeleton) 이 HTML로 stream → 1초 이내 화면 윤곽 표시.
//  2. DashboardLoader가 buildSnapshot()을 await하는 동안 사용자는 스켈레톤을 본다.
//  3. 데이터가 도착하면 동일 HTTP 응답의 다음 청크로 진짜 컨텐츠가 stream되어 fallback 자리에 자동 교체.
//
// 페이지 전환 시점에는 app/loading.tsx가 먼저 보이고, 페이지 RSC가 시작되면
// 이 페이지의 Suspense fallback이 이어받는다 — 두 단계 모두 빈 화면을 피한다.
//
// 영역별(SummaryBar/StockGrid/News) Suspense 분리는 DashboardClient가 단일 state로
// polling을 통합 관리하는 구조라 별도 Phase에서 진행한다. (lib/snapshot.ts 의
// fetchMarketIndicators / fetchWatchlistSnapshots / fetchNewsItems 가 이미 영역별로
// 호출 가능한 형태로 준비되어 있음.)
export default function HomePage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardLoader />
    </Suspense>
  );
}

async function DashboardLoader() {
  let initial;
  try {
    initial = await buildSnapshot();
  } catch (e) {
    // 실패해도 빈 스냅샷으로 fallback — 클라이언트가 곧 polling으로 재시도한다.
    initial = {
      generatedAt: Date.now(),
      primaries: [],
      indicators: [],
      marketMood: { label: "중립" as const, semiHeat: 50, riskKeywords: [] },
      news: [],
      errors: { boot: e instanceof Error ? e.message : String(e) },
    };
  }
  return <DashboardClient initial={initial} />;
}
