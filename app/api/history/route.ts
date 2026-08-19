import { NextResponse } from "next/server";
import { fetchHistorical } from "@/lib/providers";
import { cacheControl } from "@/lib/http-cache";

export const dynamic = "force-dynamic";

const RANGE_DAYS = {
  "1d": 2,
  "1w": 10,
  "1m": 35,
  "3m": 100,
} as const;

type RangeKey = keyof typeof RANGE_DAYS;

/** 일봉은 장중에도 천천히 변함 — 카드 FairValue 6종 동시 fetch 시 함수 재실행 완화 */
const HISTORY_CACHE = cacheControl(300, 600, 3600);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const range = (url.searchParams.get("range") ?? "1m") as RangeKey;
  if (!code) {
    return NextResponse.json({ error: "code 파라미터 필요" }, { status: 400 });
  }
  const days = RANGE_DAYS[range] ?? 35;
  try {
    const points = await fetchHistorical(code, days);
    return NextResponse.json(
      { code, range, points },
      { headers: { "Cache-Control": HISTORY_CACHE } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
