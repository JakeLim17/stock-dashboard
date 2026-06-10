import { NextResponse } from "next/server";
import { kisEnabled } from "@/lib/providers/kis";
import { getIntradayCandlesCached } from "@/lib/providers/kisExtraCache";
import type { HistoricalPoint } from "@/lib/providers/yahoo";
import { isKrStock } from "@/lib/providers/naver";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Interval = "1m" | "5m" | "15m";
const ALLOWED: Interval[] = ["1m", "5m", "15m"];
const BUCKET_MIN: Record<Interval, number> = { "1m": 1, "5m": 5, "15m": 15 };

// 분봉 — KIS 1m 100건을 받아 5m/15m 은 클라이언트 가까운 곳에서 aggregation.
// 1h 이상은 분봉 데이터 부족(100분 한계)이라 지원 안 함. /api/history 일봉 사용.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code")?.trim();
    const intervalRaw = (url.searchParams.get("interval") ?? "1m") as Interval;
    const interval: Interval = ALLOWED.includes(intervalRaw)
      ? intervalRaw
      : "1m";
    if (!code) {
      return NextResponse.json(
        { error: "code 파라미터 필요" },
        { status: 400 }
      );
    }
    if (!kisEnabled() || !isKrStock(code)) {
      return NextResponse.json(
        { points: [], code, interval, error: "KIS 비활성 또는 비한국 종목" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const raw = (await getIntradayCandlesCached(code)) ?? [];
    const points = aggregate(raw, BUCKET_MIN[interval]);
    return NextResponse.json(
      { points, code, interval },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 1m 캔들 배열 → N분봉 OHLC 집계.
// bucketStart = floor(ts / bucketMs) * bucketMs.
function aggregate(points: HistoricalPoint[], bucketMin: number): HistoricalPoint[] {
  if (bucketMin <= 1) return points;
  const bucketMs = bucketMin * 60_000;
  const buckets = new Map<number, HistoricalPoint>();
  for (const p of points) {
    const bs = Math.floor(p.date / bucketMs) * bucketMs;
    const cur = buckets.get(bs);
    if (!cur) {
      buckets.set(bs, {
        date: bs,
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        volume: p.volume,
      });
    } else {
      cur.high = Math.max(cur.high, p.high);
      cur.low = Math.min(cur.low, p.low);
      cur.close = p.close;
      cur.volume += p.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.date - b.date);
}
