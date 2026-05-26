import { NextResponse } from "next/server";
import { buildSnapshot } from "@/lib/snapshot";

// snapshot과 동일하지만 의도가 다른 endpoint (수동 새로고침 버튼용)
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const snap = await buildSnapshot();
    return NextResponse.json(snap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
