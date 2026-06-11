import type { NextConfig } from "next";
import path from "node:path";

// CSP — Tailwind v4(JIT, 런타임 JS 없음)·Next 내장 inline style·Vercel Analytics 호환.
// 'unsafe-inline' 은 styled-jsx/Next 내장 inline 스타일 때문에 일시 허용.
//   → 추후 nonce 기반(Next 내장 nonce middleware) 으로 전환할 수 있게 한 줄로 분리.
// 'unsafe-eval' 은 Next dev(React Fast Refresh) 가 eval 을 사용하므로 dev 한정 허용,
//   production 에선 제외해 strictness 강화.
//
// connect-src
//   - 'self': /api/* 자체 호출
//   - https://*.vercel-insights.com / https://va.vercel-scripts.com:
//       Vercel Analytics(스크립트 호스트 + insights endpoint)
//   - https://api.upstash.io: Upstash REST(KV) — 클라이언트에서 직접 호출하진 않지만
//     SSR 응답이 fetch 한 결과를 echo 하는 케이스 보호용으로 화이트리스트.
//
// img-src https: 는 외부 차트·뉴스 썸네일·소셜 OG 이미지 호환.
// frame-ancestors 'none' + X-Frame-Options DENY 로 클릭재킹 차단(중복 OK).
const isDev = process.env.NODE_ENV !== "production";
const SCRIPT_SRC = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com"
  : "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  SCRIPT_SRC,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.vercel-insights.com https://va.vercel-scripts.com https://api.upstash.io",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  // 브라우저 강제 HTTPS 캐시 — Vercel 도메인은 HTTPS 전용이라 안전.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
];

const nextConfig: NextConfig = {
  // better-sqlite3는 native binding이라 서버 외부 패키지로 둬야 번들 깨짐 방지
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    // 상위 디렉토리에 다른 lockfile이 있어도 이 프로젝트 루트를 명시
    root: path.join(__dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
