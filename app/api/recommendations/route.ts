import { NextResponse } from "next/server";
import { getOrBuildRecommendations } from "@/lib/recommendations";

// 종목 추천 — RECOMMENDATION_SCREEN_POOL(섹터 대장+대표)을 분석해 카테고리별로 정렬해 반환.
//
// 캐시 정책:
//   - KST 거래일 키(YYYY-MM-DD)로 SQLite daily_picks 테이블에 고정 저장 (SSOT)
//   - 동일 인스턴스 30min 인메모리 보조 캐시
//   - Vercel :memory: DB — cold start마다 재빌드 가능 (로컬 file DB는 영구)
//   - ?refresh=1 쿼리로 강제 재빌드
//
// 처리 시간: 첫 호출 수초~수분 (consensus/marketAlert 미캐시). 그 뒤 30min TTL 캐시 즉시.
// better-sqlite3 등 native 모듈을 쓰지 않으므로 edge 도 가능하지만, 명시적으로 nodejs runtime 유지.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const result = await getOrBuildRecommendations({ forceRefresh });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
