import { DashboardClient } from "@/components/DashboardClient";
import { buildSnapshot } from "@/lib/snapshot";

// 매 요청마다 새로 (라이브 데이터)
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  // 초기 스냅샷은 서버에서 1회 빌드 → 첫 화면이 비어 보이지 않게.
  // 실패하면 빈 스냅샷으로 fallback (클라이언트가 곧 polling).
  let initial;
  try {
    initial = await buildSnapshot();
  } catch (e) {
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
