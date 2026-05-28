import { NextResponse } from "next/server";
import { buildSnapshot } from "@/lib/snapshot";

// snapshot과 동일하지만 의도가 다른 endpoint (수동 새로고침 버튼용)
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    let symbols: string[] = [];
    let includeOverseasNight = false;
    try {
      const body = (await req.json()) as {
        symbols?: string[];
        includeOverseasNight?: boolean;
      };
      symbols = Array.isArray(body.symbols) ? body.symbols : [];
      includeOverseasNight = body.includeOverseasNight === true;
    } catch {
      // empty body 허용
    }

    const snap = await buildSnapshot(symbols, { includeOverseasNight });
    return NextResponse.json(snap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
