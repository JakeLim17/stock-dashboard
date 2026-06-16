import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

// 쿠키 기반 로그인 게이트 + IP 기반 일반 API rate-limit.
// env DASHBOARD_PASS 가 설정돼 있을 때만 로그인 게이트 활성화.
// 비어 있으면 로그인 검증은 통과 (로컬 개발 편의). API rate-limit 은 항상 적용.
//
// 동작 흐름
//  1. /login, /api/login, /api/realtime/stream(SSE), 정적 자원: 게이트 면제
//  2. /api/* 일부 데이터 엔드포인트: IP 별 분당 120회 제한 (초과 시 429)
//  3. 쿠키 dashboard_token 이 SHA-256(PASS + COOKIE_VERSION) 과 일치하면 통과
//  4. 아니면 /login?next=원래경로 로 리다이렉트
//
// 쿠키 versioning: PASS 가 바뀌면 자동으로 기존 토큰이 무효화된다.

const COOKIE_NAME = "dashboard_token";
const COOKIE_VERSION = "v1";

// 게이트·rate-limit 둘 다 면제 (login API 자체는 별도 brute-force 보호).
//   /api/realtime/stream 은 SSE (text/event-stream) — EventSource 가 307 리다이렉트를
//   따라가지 못해 middleware 는 통과시키고 라우트 핸들러 내부에서 쿠키 검증 수행.
//   /api/realtime/health 는 useRealtime hook 의 사전 503 점검용 — 인증 redirect 가
//   걸리면 hook 이 status 를 잘못 해석하므로 PUBLIC_PATHS 로 통과시킴 (시크릿 없음).
const PUBLIC_PATHS = [
  "/login",
  "/api/login",
  "/api/realtime/stream",
  "/api/realtime/health",
];

// rate-limit 대상: 외부에서 빈번히 호출 가능한 데이터 API.
//   너무 빡빡하면 정상 사용자 폴링이 깨질 수 있어 분당 120회로 여유 있게.
//   /api/realtime/stream 은 PUBLIC_PATHS 에서 이미 제외 — 장시간 연결이라 카운트 의미 없음.
const API_RATE_PREFIXES = [
  "/api/snapshot",
  "/api/intraday",
  "/api/intraday-chart",
  "/api/news",
  "/api/history",
  "/api/leaders",
  "/api/sparkline",
  "/api/recommendations",
  "/api/refresh",
];
const API_RATE_LIMIT = 120; // requests
const API_RATE_WINDOW_SEC = 60;

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

function isRateLimitedApi(pathname: string): boolean {
  return API_RATE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) 공개 경로 — 그대로 통과.
  if (isPublic(pathname)) return NextResponse.next();

  // 2) 일반 API rate-limit (인증 여부와 무관하게 적용 — 불특정 IP 보호).
  if (isRateLimitedApi(pathname)) {
    const ip = getClientIp(req);
    const rl = await checkRateLimit({
      scope: "api",
      ip,
      limit: API_RATE_LIMIT,
      windowSec: API_RATE_WINDOW_SEC,
    });
    if (!rl.ok) {
      return new NextResponse(
        JSON.stringify({ ok: false, error: "요청이 너무 많습니다" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Retry-After": String(rl.retryAfterSec),
            "X-RateLimit-Limit": String(API_RATE_LIMIT),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }
  }

  // 3) 로그인 게이트 (DASHBOARD_PASS 미설정이면 면제).
  const pass = process.env.DASHBOARD_PASS;
  if (!pass) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    const expected = await sha256Hex(pass + COOKIE_VERSION);
    if (token === expected) return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  if (pathname !== "/login") {
    url.searchParams.set("next", pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
