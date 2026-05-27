import { NextRequest, NextResponse } from "next/server";

// 미들웨어와 동일한 Edge Runtime 으로 실행해 cold start 를 줄이고
// 환경 차이로 인한 모바일 이상 동작을 예방한다.
export const runtime = "edge";

// 로그인 토큰을 발급한다. 한 번 통과하면 30일 동안 비번을 다시 묻지 않는다.
// JS fetch(JSON) 와 일반 form POST(application/x-www-form-urlencoded) 둘 다 받는다.
//  - fetch 호출 → JSON 응답 (UX 빠름)
//  - 일반 form 제출 → 302 redirect 응답 (JS 불필요, 모바일 호환성 최대)

const COOKIE_NAME = "dashboard_token";
const COOKIE_VERSION = "v1";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30일

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function setAuthCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

function clearAuthCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

async function parseBody(
  req: NextRequest
): Promise<{ password?: string; next?: string }> {
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("application/json")) {
    try {
      const j = (await req.json()) as { password?: unknown; next?: unknown };
      return {
        password: typeof j.password === "string" ? j.password : undefined,
        next: typeof j.next === "string" ? j.next : undefined,
      };
    } catch {
      return {};
    }
  }

  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    return {
      password: params.get("password") ?? undefined,
      next: params.get("next") ?? undefined,
    };
  }

  if (ct.includes("multipart/form-data")) {
    try {
      const fd = await req.formData();
      return {
        password: (fd.get("password") as string | null) ?? undefined,
        next: (fd.get("next") as string | null) ?? undefined,
      };
    } catch {
      return {};
    }
  }

  return {};
}

function wantsJson(req: NextRequest): boolean {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return true;
  const accept = req.headers.get("accept") ?? "";
  return (
    accept.includes("application/json") && !accept.includes("text/html")
  );
}

function safeNext(value: string | undefined | null): string {
  // open redirect 방지: 내부 경로(/로 시작 + //로 시작하지 않음)만 허용
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function POST(req: NextRequest) {
  const pass = process.env.DASHBOARD_PASS;
  const body = await parseBody(req);
  const json = wantsJson(req);
  const nextPath = safeNext(body.next ?? req.nextUrl.searchParams.get("next"));

  // 보호 비활성 환경 (env 미설정) — 그냥 통과
  if (!pass) {
    return json
      ? NextResponse.json({ ok: true, protected: false })
      : NextResponse.redirect(new URL(nextPath, req.url), { status: 303 });
  }

  if (body.password !== pass) {
    if (json) {
      return NextResponse.json(
        { ok: false, error: "비밀번호가 틀렸습니다" },
        { status: 401 }
      );
    }
    // form 제출 경로: /login?error=... 로 보내 다시 입력하게
    const back = req.nextUrl.clone();
    back.pathname = "/login";
    back.search = "";
    back.searchParams.set("error", "비밀번호가 틀렸습니다");
    if (nextPath !== "/") back.searchParams.set("next", nextPath);
    return NextResponse.redirect(back, { status: 303 });
  }

  const token = await sha256Hex(pass + COOKIE_VERSION);
  const res = json
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL(nextPath, req.url), { status: 303 });
  setAuthCookie(res, token);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
