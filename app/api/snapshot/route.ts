import { NextResponse } from "next/server";
import {
  buildSnapshot,
  buildSnapshotCore,
  buildSnapshotLite,
  buildSnapshotShared,
  invalidateSnapshotCache,
} from "@/lib/snapshot";
import { invalidateConsensusCache } from "@/lib/providers/consensusCache";
import { invalidateMarketAlertCache } from "@/lib/providers/marketAlertCache";
import { invalidateEventCalendarCache } from "@/lib/providers/eventCalendar";
import { invalidateKisExtraCache } from "@/lib/providers/kisExtraCache";
import {
  NO_STORE,
  SNAPSHOT_CORE_CACHE,
  SNAPSHOT_FULL_CACHE,
  SNAPSHOT_LITE_CACHE,
} from "@/lib/http-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;
/** Vercel/Node 상한 — 클라이언트 28s 타임아웃보다 짧게 서버에서 끊음 */
export const maxDuration = 30;

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
    const liteMode =
      url.searchParams.get("lite") === "1" ||
      url.searchParams.get("phase") === "quotes";
    const coreMode =
      url.searchParams.get("core") === "1" ||
      url.searchParams.get("phase") === "core";

    const refreshParam = url.searchParams.get("refresh");
    const forceRefresh = refreshParam === "1" || refreshParam === "true";
    if (forceRefresh) {
      if (symbols.length > 0) {
        for (const code of symbols) {
          invalidateConsensusCache(code);
          invalidateMarketAlertCache(code);
          invalidateEventCalendarCache(code);
          invalidateKisExtraCache(code);
        }
      } else {
        invalidateConsensusCache();
        invalidateMarketAlertCache();
        invalidateEventCalendarCache();
        invalidateKisExtraCache();
      }
      invalidateSnapshotCache();
    }

    if (liteMode) {
      const snap = await buildSnapshotLite(symbols, { includeOverseasNight });
      return NextResponse.json(snap, {
        headers: {
          "Cache-Control": forceRefresh ? NO_STORE : SNAPSHOT_LITE_CACHE,
        },
      });
    }

    if (coreMode) {
      const snap = await buildSnapshotCore(symbols, { includeOverseasNight });
      return NextResponse.json(snap, {
        headers: {
          "Cache-Control": forceRefresh ? NO_STORE : SNAPSHOT_CORE_CACHE,
        },
      });
    }

    const snap = forceRefresh
      ? await buildSnapshot(symbols, { includeOverseasNight })
      : await buildSnapshotShared(symbols, { includeOverseasNight });
    return NextResponse.json(snap, {
      headers: {
        "Cache-Control": forceRefresh ? NO_STORE : SNAPSHOT_FULL_CACHE,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
