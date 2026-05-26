import { NextRequest, NextResponse } from "next/server";

// 단순 Basic Auth 게이트.
// env에 DASHBOARD_USER / DASHBOARD_PASS 가 둘 다 설정되어 있을 때만 활성화.
// 둘 중 하나라도 비어있으면 미들웨어는 그냥 통과 (로컬 개발 편의용).
export function middleware(req: NextRequest) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASS;
  if (!user || !pass) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(":");
      const u = decoded.slice(0, idx);
      const p = decoded.slice(idx + 1);
      if (u === user && p === pass) {
        return NextResponse.next();
      }
    } catch {
      // 잘못된 base64 → 인증 실패 처리
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Stock Dashboard", charset="UTF-8"',
    },
  });
}

// 정적 자원과 파비콘은 보호 대상에서 제외
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
