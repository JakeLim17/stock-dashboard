import { NextResponse } from "next/server";
import { kisEnabled } from "@/lib/providers/kis";
import { getMarketLeadersCached } from "@/lib/providers/kisExtraCache";
import type {
  MarketLeadersKind,
  MarketLeadersMarket,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_KIND: MarketLeadersKind[] = ["volume", "rising", "falling"];
const ALLOWED_MARKET: MarketLeadersMarket[] = ["all", "kospi", "kosdaq"];

// 시장 순위 — 거래량/상승/하락 TOP. 30s 캐시 (kisExtraCache).
// KIS 미활성 시 null 반환 (UI 미노출).
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawKind = url.searchParams.get("kind") ?? "volume";
    const rawMarket = url.searchParams.get("market") ?? "all";
    const rawCount = Number(url.searchParams.get("count") ?? "10");

    const kind: MarketLeadersKind = (
      ALLOWED_KIND as readonly string[]
    ).includes(rawKind)
      ? (rawKind as MarketLeadersKind)
      : "volume";
    const market: MarketLeadersMarket = (
      ALLOWED_MARKET as readonly string[]
    ).includes(rawMarket)
      ? (rawMarket as MarketLeadersMarket)
      : "all";
    const count =
      Number.isFinite(rawCount) && rawCount > 0 && rawCount <= 30
        ? Math.floor(rawCount)
        : 10;

    if (!kisEnabled()) {
      return NextResponse.json(
        { data: null, error: "KIS 비활성" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const data = await getMarketLeadersCached(kind, market, count);
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
