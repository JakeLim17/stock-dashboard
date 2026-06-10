import { NextResponse } from "next/server";
import {
  fetchKrAskingPrice,
  fetchKrExecutions,
  kisEnabled,
} from "@/lib/providers/kis";
import { isKrStock } from "@/lib/providers/naver";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// 선택 종목 한정 — 호가(10단계) + 실시간 체결 30건.
// 카드별로 호출하면 throttle 부담이 크므로 선택 종목만 클라이언트가 폴링하도록 별도 endpoint.
// KIS 미활성 또는 한국 종목 아니면 빈 응답.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code")?.trim();
    if (!code) {
      return NextResponse.json(
        { error: "code 파라미터 필요" },
        { status: 400 }
      );
    }
    if (!kisEnabled() || !isKrStock(code)) {
      return NextResponse.json(
        { asking: null, executions: null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 호가 + 체결 병렬. 각각 graceful null.
    const [asking, executions] = await Promise.all([
      fetchKrAskingPrice(code).catch(() => null),
      fetchKrExecutions(code, 30).catch(() => null),
    ]);

    return NextResponse.json(
      { asking, executions },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
