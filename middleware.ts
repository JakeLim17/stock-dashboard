import { NextRequest, NextResponse } from "next/server";

// 쿠키 기반 로그인 게이트.
// env DASHBOARD_PASS 가 설정돼 있을 때만 활성화.
// 비어 있으면 무조건 통과 (로컬 개발 편의).
//
// 동작 흐름
//  1. /login, /api/login, /favicon 등 공개 경로는 통과
//  2. 쿠키 dashboard_token 이 SHA-256(PASS + COOKIE_VERSION) 과 일치하면 통과
//  3. 아니면 /login?next=원래경로 로 리다이렉트
//
// 쿠키 versioning: PASS 가 바뀌면 자동으로 기존 토큰이 무효화된다.

const COOKIE_NAME = "dashboard_token";
const COOKIE_VERSION = "v1";
// /api/realtime/stream 은 SSE (text/event-stream) 라 브라우저 EventSource 가 307 리다이렉트를
// 따라가지 못한다. middleware 는 통과시키고, 라우트 핸들러 내부에서 동일한 쿠키 검증 수행.
const PUBLIC_PATHS = ["/login", "/api/login", "/api/realtime/stream"];

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function middleware(req: NextRequest) {
  const pass = process.env.DASHBOARD_PASS;
  if (!pass) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    const expected = await sha256Hex(pass + COOKIE_VERSION);
    if (token === expected) return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // API 요청이 직접 보호 경로를 호출하다 막힌 경우 next 없이 /login만 안내
  if (pathname !== "/login") {
    url.searchParams.set("next", pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
