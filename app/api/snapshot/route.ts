import { NextResponse } from "next/server";
import {
  buildSnapshot,
  buildSnapshotShared,
  invalidateSnapshotCache,
} from "@/lib/snapshot";
import { invalidateConsensusCache } from "@/lib/providers/consensusCache";
import { invalidateMarketAlertCache } from "@/lib/providers/marketAlertCache";
import { invalidateEventCalendarCache } from "@/lib/providers/eventCalendar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbolsParam = url.searchParams.get("symbols") ?? "";
    const symbols = symbolsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
    const includeOverseasNight = url.searchParams.get("night") === "1";

    // ?refresh=1 또는 ?refresh=true → 해당 종목들의 컨센서스/시장경보 캐시를 비우고 새로 fetch.
    // (시세·뉴스는 항상 fresh 호출이라 캐시 무관. 캐시 대상은 consensus + marketAlert 두 in-memory 맵.)
    // symbols가 비어있으면 전체 캐시를 비운다 (수동 강제 갱신).
    const refreshParam = url.searchParams.get("refresh");
    const forceRefresh = refreshParam === "1" || refreshParam === "true";
    if (forceRefresh) {
      if (symbols.length > 0) {
        for (const code of symbols) {
          invalidateConsensusCache(code);
          invalidateMarketAlertCache(code);
          invalidateEventCalendarCache(code);
        }
      } else {
        invalidateConsensusCache();
        invalidateMarketAlertCache();
        // 매크로 이벤트 캐시(global)도 비워 새 발표 일정이 즉시 반영되게 함.
        invalidateEventCalendarCache();
      }
      // 스냅샷 + 시장지표 soft TTL 캐시도 함께 비움 — refresh 의도와 일치.
      invalidateSnapshotCache();
    }

    // 평상시는 in-flight dedup + 2s soft TTL 로 동시 호출 압축.
    // refresh=1 은 분석/컨센서스 캐시도 비웠으니 신선한 호출이 가도록 직접 buildSnapshot.
    const snap = forceRefresh
      ? await buildSnapshot(symbols, { includeOverseasNight })
      : await buildSnapshotShared(symbols, { includeOverseasNight });
    return NextResponse.json(snap, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
