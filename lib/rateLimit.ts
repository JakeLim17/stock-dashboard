// IP 기반 sliding-window 카운터 rate limiter — Edge runtime 호환.
//
// 우선순위
//  1) Vercel KV (Upstash REST) 가 설정돼 있으면 cross-instance 카운트 (정확).
//     INCR + EXPIRE pipeline 으로 atomic 에 가깝게 처리.
//  2) 실패하거나 미설정이면 모듈 글로벌 Map 으로 in-memory fallback (인스턴스별 격리, best-effort).
//
// 같은 키 패턴: `rl:{scope}:{ip}:{windowSec}:{epochBucket}`
// epochBucket = Math.floor(now/windowSec*1000) — 윈도우가 끝나면 자동 키 분리.
//
// 노출 함수
//  - checkRateLimit({ key, limit, windowSec }): { ok, remaining, retryAfterSec }
//  - getClientIp(req): NextRequest 또는 Headers 에서 클라이언트 IP 추출.

import type { NextRequest } from "next/server";

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  count: number;
  limit: number;
};

type WindowOpts = {
  scope: string; // "login" / "api" 등 카운터 네임스페이스
  ip: string;
  limit: number;
  windowSec: number;
};

// ─── KV (Upstash REST) ───────────────────────────────────────────

function getKvUrl(): string | null {
  return (
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? null
  );
}

function getKvToken(): string | null {
  return (
    process.env.KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    null
  );
}

function isKvConfigured(): boolean {
  return !!(getKvUrl() && getKvToken());
}

// pipeline 으로 INCR + EXPIRE 한 번에 — race 최소화.
// 응답 형식: [{ result: <count> }, { result: 1 }]
async function kvIncrWithExpire(
  key: string,
  ttlSec: number
): Promise<number | null> {
  const url = getKvUrl();
  const token = getKvToken();
  if (!url || !token) return null;

  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(ttlSec)],
      ]),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ result?: unknown }>;
    const first = json?.[0]?.result;
    if (typeof first === "number") return first;
    if (typeof first === "string") {
      const n = Number(first);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── in-memory fallback ─────────────────────────────────────────

type MemEntry = { count: number; expiresAt: number };
const memCounters = new Map<string, MemEntry>();

// 가끔 expired entry 정리 — 1/64 확률로 sweep.
function maybeSweepMem(now: number): void {
  if ((Math.random() * 64) | 0) return;
  let removed = 0;
  for (const [k, v] of memCounters) {
    if (v.expiresAt <= now) {
      memCounters.delete(k);
      if (++removed >= 256) break;
    }
  }
}

function memIncr(key: string, ttlSec: number, now: number): number {
  maybeSweepMem(now);
  const cur = memCounters.get(key);
  if (!cur || cur.expiresAt <= now) {
    const next: MemEntry = { count: 1, expiresAt: now + ttlSec * 1000 };
    memCounters.set(key, next);
    return 1;
  }
  cur.count += 1;
  return cur.count;
}

// ─── public ─────────────────────────────────────────────────────

function buildKey(scope: string, ip: string, windowSec: number, now: number): string {
  const bucket = Math.floor(now / (windowSec * 1000));
  return `rl:${scope}:${ip}:${windowSec}:${bucket}`;
}

export async function checkRateLimit(opts: WindowOpts): Promise<RateLimitResult> {
  const { scope, ip, limit, windowSec } = opts;
  const now = Date.now();
  const key = buildKey(scope, ip, windowSec, now);

  let count: number | null = null;
  if (isKvConfigured()) {
    // ttl 은 윈도우 길이 + 약간의 여유.
    count = await kvIncrWithExpire(key, windowSec + 5);
  }
  if (count == null) {
    count = memIncr(key, windowSec + 5, now);
  }

  const remaining = Math.max(0, limit - count);
  const ok = count <= limit;
  // 윈도우 끝까지 남은 초 — bucket 기반이라 가까운 다음 bucket 시작 시각 계산.
  const bucket = Math.floor(now / (windowSec * 1000));
  const nextBucketAt = (bucket + 1) * windowSec * 1000;
  const retryAfterSec = ok ? 0 : Math.max(1, Math.ceil((nextBucketAt - now) / 1000));

  return { ok, remaining, retryAfterSec, count, limit };
}

// 두 윈도우(예: 분당·시간당) 동시 체크 — 둘 중 하나라도 초과면 ok=false.
export async function checkRateLimitMulti(
  scope: string,
  ip: string,
  windows: Array<{ limit: number; windowSec: number }>
): Promise<RateLimitResult> {
  let worst: RateLimitResult | null = null;
  for (const w of windows) {
    const r = await checkRateLimit({ scope, ip, limit: w.limit, windowSec: w.windowSec });
    if (!r.ok) {
      // 최초 실패한 결과를 우선 반환 (retryAfter 가장 보수적인 쪽).
      if (!worst || r.retryAfterSec > worst.retryAfterSec) worst = r;
    }
  }
  if (worst) return worst;
  // 모두 통과 — 마지막 결과의 remaining/limit 만 의미 있음.
  return { ok: true, remaining: 0, retryAfterSec: 0, count: 0, limit: 0 };
}

// ─── client IP ──────────────────────────────────────────────────

export function getClientIp(reqOrHeaders: NextRequest | Headers): string {
  const headers: Headers =
    reqOrHeaders instanceof Headers ? reqOrHeaders : reqOrHeaders.headers;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // 첫 번째 항목이 origin client.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) return real;
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const first = vercel.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
