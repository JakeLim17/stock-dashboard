import { NextRequest, NextResponse } from "next/server";

// 로그인 토큰을 발급한다. 한 번 통과하면 30일 동안 비번을 다시 묻지 않는다.
// middleware.ts 의 SHA-256(PASS + COOKIE_VERSION) 와 동일한 토큰을 쿠키에 심는다.

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

export async function POST(req: NextRequest) {
  const pass = process.env.DASHBOARD_PASS;
  // 보호가 비활성화된 환경 (env 미설정) — 굳이 막을 필요 없으니 통과 신호만 준다.
  if (!pass) return NextResponse.json({ ok: true, protected: false });

  let body: { password?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // 잘못된 JSON → 아래에서 비번 불일치로 처리
  }

  if (typeof body.password !== "string" || body.password !== pass) {
    return NextResponse.json(
      { ok: false, error: "비밀번호가 틀렸습니다" },
      { status: 401 }
    );
  }

  const token = await sha256Hex(pass + COOKIE_VERSION);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return res;
}

// 로그아웃: 같은 쿠키를 즉시 만료 처리
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
