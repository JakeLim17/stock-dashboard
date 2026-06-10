import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// 호가/체결 폴링 비활성화.
//
// 이전 클라이언트 번들이 남아 있으면 이 라우트를 1.5초마다 계속 호출할 수 있다.
// KIS 토큰 발급 알림(카톡/SMS) 폭주를 막기 위해 서버에서 KIS 호출을 완전히 차단한다.
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

    return NextResponse.json(
      {
        asking: null,
        executions: null,
        disabled: true,
        reason: "호가/체결 폴링 비활성화",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
