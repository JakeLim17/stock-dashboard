import { NextResponse } from "next/server";
import { fetchHistorical } from "@/lib/providers";

export const dynamic = "force-dynamic";

const RANGE_DAYS = {
  "1d": 2,
  "1w": 10,
  "1m": 35,
  "3m": 100,
} as const;

type RangeKey = keyof typeof RANGE_DAYS;

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
    return NextResponse.json({ code, range, points });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
