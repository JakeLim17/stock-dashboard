import { getApprovalKey, kisApprovalEnabled } from "@/lib/providers/kisApproval";

// ─────────────────────────────────────────────────────────────────────
// /api/realtime/stream — KIS 실시간 SSE 엔드포인트
//
// 운영 모드 (KIS_WS_RELAY_URL 설정됨, **권장**):
//   클라이언트 EventSource
//     → 이 라우트(쿠키 인증 + Vercel)
//        → fetch streaming
//           → 한국 IP relay 서버 (relay/server.js)
//              → KIS wss://ops.koreainvestment.com:21000
//   목적: Vercel 함수가 한국 외 리전(sin1/hnd1)일 때 KIS 가 IP 차단해 1006 으로 끊는 문제 우회.
//   relay 호스팅 가이드는 `relay/README.md` 참고.
//
// 로컬/한국 IP 모드 (KIS_WS_RELAY_URL 미설정, fallback):
//   이 라우트가 직접 KIS WS 에 연결. 호스트 IP 가 한국이 아니면 1006 발생 → relay 필요.
//
// 두 모드 모두 클라이언트 SSE 이벤트 스키마는 동일 — `hooks/useRealtime.ts` 변경 불필요.
// ─────────────────────────────────────────────────────────────────────

// ─── 쿠키 인증 ───────────────────────────────────────────────────────
// middleware 가 /api/realtime/stream 을 PUBLIC_PATHS 로 통과시키므로
// (EventSource 가 307 리다이렉트를 못 따름) 라우트 내부에서 동일한 SHA-256 검증.
// 보호 비활성 환경(DASHBOARD_PASS 미설정)이면 통과.
const AUTH_COOKIE_VERSION = "v1";
const AUTH_COOKIE_RE = /(?:^|;\s*)dashboard_token=([^;]+)/;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isAuthorized(req: Request): Promise<boolean> {
  const pass = process.env.DASHBOARD_PASS;
  if (!pass) return true;
  const cookieHeader = req.headers.get("cookie") ?? "";
  const m = cookieHeader.match(AUTH_COOKIE_RE);
  if (!m) return false;
  const token = decodeURIComponent(m[1]);
  const expected = await sha256Hex(pass + AUTH_COOKIE_VERSION);
  return token === expected;
}

// ─── 런타임 — Node.js 필수 ───────────────────────────────────────────
// Vercel Edge 는 outbound WebSocket 클라이언트 미지원. fetch streaming 은 Edge 도 OK 지만
// fallback direct-WS 경로를 위해 Node 로 통일.
//
// maxDuration:
//   Vercel Hobby 함수 최대 60s, Pro 는 300s. 300 설정해 두면 Hobby 에선 자동 60 으로 clamp.
//   클라이언트(`hooks/useRealtime.ts`)는 stream 종료 시 자동 reconnect.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

// soft timeout — relay/직접 모드 공통. maxDuration 보다 10s 일찍 끊어 클라이언트 reconnect.
const EFFECTIVE_MAX_DURATION = Math.min(maxDuration, 60); // Hobby 안전선
const SOFT_TIMEOUT_MS = (EFFECTIVE_MAX_DURATION - 10) * 1000;

// ─── 공통 유틸 ───────────────────────────────────────────────────────

function normalizeRelayUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  const eq = s.indexOf("=");
  if (eq > -1 && /^[A-Z0-9_]+$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // 끝의 슬래시 제거
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function normalizeWsUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  const eq = s.indexOf("=");
  if (eq > -1 && /^[A-Z0-9_]+$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return null;
    return s;
  } catch {
    return null;
  }
}

function getDirectWsUrl(): string {
  const fromEnv = normalizeWsUrl(process.env.KIS_WS_URL);
  if (fromEnv) return fromEnv;
  const isVts = (process.env.KIS_BASE_URL ?? "").includes("openapivts");
  return isVts
    ? "wss://ops.koreainvestment.com:31000"
    : "wss://ops.koreainvestment.com:21000";
}

function toKisShortCode(code: string): string | null {
  const m = code.trim().match(/^(\d{6})/);
  return m ? m[1] : null;
}

function parseHHMMSS(s: string | undefined): number | null {
  if (!s) return null;
  const padded = s.padStart(6, "0").slice(0, 6);
  const hh = Number(padded.slice(0, 2));
  const mm = Number(padded.slice(2, 4));
  const ss = Number(padded.slice(4, 6));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kstNow.getUTCFullYear();
  const mo = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  return Date.UTC(y, mo, d, hh - 9, mm, ss);
}

function numOrZero(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ─── KIS pipe schema (direct 모드용) ─────────────────────────────────
const H0STCNT0_FIELDS_PER_RECORD = 46;
const H0STCNT0_IDX = {
  code: 0,
  hhmmss: 1,
  price: 2,
  cumVolume: 13,
  cumTradeValue: 14,
} as const;

const H0STASP0_FIELDS_PER_RECORD = 59;
const H0STASP0_IDX = {
  code: 0,
  hhmmss: 1,
  askPriceBase: 3,
  bidPriceBase: 13,
  askQtyBase: 23,
  bidQtyBase: 33,
  totalAskQty: 43,
  totalBidQty: 44,
  expectedPrice: 47,
  expectedVolume: 48,
} as const;

interface PriceMsg {
  type: "price";
  code: string;
  price: number;
  ts: number;
}
interface TradeMsg {
  type: "trade";
  code: string;
  cumVolume: number;
  cumTradeValue: number;
  ts: number;
}
interface AspLevel {
  price: number;
  qty: number;
}
interface AspMsg {
  type: "asp";
  code: string;
  asks: AspLevel[];
  bids: AspLevel[];
  totalAskQty: number;
  totalBidQty: number;
  expectedPrice: number | null;
  expectedVolume: number | null;
  ts: number;
}

type Topic = "price" | "trade" | "asp";
const VALID_TOPICS: ReadonlySet<Topic> = new Set(["price", "trade", "asp"]);

function parseTopics(raw: string | null): Set<Topic> {
  const out = new Set<Topic>();
  if (raw) {
    for (const t of raw.split(",").map((s) => s.trim().toLowerCase())) {
      if (VALID_TOPICS.has(t as Topic)) out.add(t as Topic);
    }
  }
  if (out.size === 0) out.add("price");
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// GET 핸들러
// ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols") ?? "";
  const topicsRaw = url.searchParams.get("topics");
  const topics = parseTopics(topicsRaw);

  // 구독 한도 — KIS WS 41건 (tr_id × tr_key)
  const trIds: string[] = [];
  if (topics.has("price") || topics.has("trade")) trIds.push("H0STCNT0");
  if (topics.has("asp")) trIds.push("H0STASP0");
  const MAX_SUBSCRIPTIONS = 41;
  const maxSymbolsByLimit = Math.max(
    1,
    Math.floor(MAX_SUBSCRIPTIONS / Math.max(1, trIds.length))
  );

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxSymbolsByLimit);

  if (symbols.length === 0) {
    return new Response(
      JSON.stringify({ error: "symbols 파라미터 필요" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ─── 1순위: relay 모드 ─────────────────────────────────────────────
  const relayBase = normalizeRelayUrl(process.env.KIS_WS_RELAY_URL);
  const relaySecret = process.env.KIS_WS_RELAY_SECRET ?? "";

  if (relayBase) {
    return handleRelayMode(req, relayBase, relaySecret, symbolsParam, topicsRaw);
  }

  // ─── 2순위: 직접 WS 모드 (로컬·한국 IP 호스트 전용 fallback) ─────
  return handleDirectMode(req, symbols, topics, trIds);
}

// ─────────────────────────────────────────────────────────────────────
// Relay 모드 — fetch streaming SSE proxy
// ─────────────────────────────────────────────────────────────────────

async function handleRelayMode(
  req: Request,
  relayBase: string,
  relaySecret: string,
  symbolsParam: string,
  topicsRaw: string | null
): Promise<Response> {
  const qs = new URLSearchParams();
  qs.set("symbols", symbolsParam);
  if (topicsRaw) qs.set("topics", topicsRaw);

  const upstreamUrl = `${relayBase}/sse?${qs.toString()}`;

  // 클라이언트가 abort 하면 upstream 도 abort.
  const upstreamAbort = new AbortController();
  const clientAbortHandler = () => {
    try {
      upstreamAbort.abort();
    } catch {
      // ignore
    }
  };
  req.signal.addEventListener("abort", clientAbortHandler);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: relaySecret
        ? { "x-relay-secret": relaySecret, accept: "text/event-stream" }
        : { accept: "text/event-stream" },
      signal: upstreamAbort.signal,
      // Next.js fetch cache 끄기
      cache: "no-store",
      // @ts-expect-error -- Node fetch streaming
      duplex: "half",
    });
  } catch (e) {
    req.signal.removeEventListener("abort", clientAbortHandler);
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "unknown";
    const body =
      `event: error\ndata: ${JSON.stringify({
        reason: "relay-unreachable",
        message,
        ts: Date.now(),
      })}\n\n`;
    return new Response(body, {
      status: 503,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  if (!upstream.ok || !upstream.body) {
    req.signal.removeEventListener("abort", clientAbortHandler);
    let text = "";
    try {
      text = (await upstream.text()).slice(0, 500);
    } catch {
      // ignore
    }
    const body =
      `event: error\ndata: ${JSON.stringify({
        reason: "relay-bad-response",
        status: upstream.status,
        body: text,
        ts: Date.now(),
      })}\n\n`;
    return new Response(body, {
      status: upstream.status >= 400 ? upstream.status : 502,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  // soft-timeout: maxDuration 임박 전 reconnect 이벤트 한 번 보내고 종료
  const upstreamReader = upstream.body.getReader();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        try {
          upstreamAbort.abort();
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
        req.signal.removeEventListener("abort", clientAbortHandler);
      };

      const softTimer = setTimeout(() => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: reconnect\ndata: ${JSON.stringify({
                reason: "soft-timeout",
                ts: Date.now(),
              })}\n\n`
            )
          );
        } catch {
          // ignore
        }
        cleanup();
      }, SOFT_TIMEOUT_MS);

      try {
        for (;;) {
          const { value, done } = await upstreamReader.read();
          if (done) break;
          if (value && !closed) {
            try {
              controller.enqueue(value);
            } catch {
              break;
            }
          }
        }
      } catch {
        // upstream abort / network error — fallthrough cleanup
      } finally {
        clearTimeout(softTimer);
        try {
          upstreamReader.releaseLock();
        } catch {
          // ignore
        }
        cleanup();
      }
    },
    cancel() {
      try {
        upstreamAbort.abort();
      } catch {
        // ignore
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Direct 모드 — Vercel 함수가 직접 KIS WS 연결 (로컬·한국 IP 호스트용)
// ─────────────────────────────────────────────────────────────────────

async function handleDirectMode(
  req: Request,
  symbols: string[],
  topics: Set<Topic>,
  trIds: string[]
): Promise<Response> {
  if (!kisApprovalEnabled()) {
    return new Response(
      JSON.stringify({ error: "KIS_APP_KEY/SECRET 미설정 — 실시간 비활성" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const krCodes = symbols
    .map((c) => ({ orig: c, six: toKisShortCode(c) }))
    .filter((x): x is { orig: string; six: string } => x.six != null);

  if (krCodes.length === 0) {
    return new Response(
      JSON.stringify({ error: "한국 종목 코드 없음 (6자리)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const approvalKey = await getApprovalKey();
  if (!approvalKey) {
    return new Response(
      JSON.stringify({ error: "approval_key 발급 실패 — KIS 응답 오류 또는 cooldown" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let ws: WebSocket | null = null;
      let softTimer: ReturnType<typeof setTimeout> | null = null;
      let abortHandler: (() => void) | null = null;
      let closed = false;

      const sse = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // controller 닫힘 — 무시
        }
      };

      const cleanup = (reason: string) => {
        if (closed) return;
        closed = true;
        if (softTimer) clearTimeout(softTimer);
        if (abortHandler) req.signal.removeEventListener("abort", abortHandler);
        if (ws) {
          try {
            ws.close(1000, reason);
          } catch {
            // ignore
          }
          ws = null;
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      abortHandler = () => cleanup("client-abort");
      req.signal.addEventListener("abort", abortHandler);

      softTimer = setTimeout(() => {
        sse("reconnect", { reason: "soft-timeout", ts: Date.now() });
        cleanup("soft-timeout");
      }, SOFT_TIMEOUT_MS);

      try {
        ws = new WebSocket(getDirectWsUrl());

        ws.addEventListener("open", () => {
          sse("open", {
            ts: Date.now(),
            symbolCount: krCodes.length,
            trIds,
            topics: Array.from(topics),
            relay: false,
          });
          for (const { six } of krCodes) {
            for (const trId of trIds) {
              const msg = {
                header: {
                  approval_key: approvalKey,
                  custtype: "P",
                  tr_type: "1",
                  "content-type": "utf-8",
                },
                body: { input: { tr_id: trId, tr_key: six } },
              };
              try {
                ws!.send(JSON.stringify(msg));
              } catch {
                // ignore
              }
            }
          }
        });

        ws.addEventListener("message", (ev) => {
          const raw = typeof ev.data === "string" ? ev.data : "";
          if (raw.length === 0) return;

          if (raw.charCodeAt(0) === 0x7b /* '{' */) {
            try {
              const j = JSON.parse(raw) as {
                header?: { tr_id?: string };
                body?: { rt_cd?: string; msg_cd?: string; msg1?: string };
              };
              if (j.header?.tr_id === "PINGPONG") {
                try {
                  ws!.send(raw);
                } catch {
                  // ignore
                }
                return;
              }
              if (j.body?.rt_cd && j.body.rt_cd !== "0") {
                sse("warn", {
                  rt_cd: j.body.rt_cd,
                  msg_cd: j.body.msg_cd,
                  msg: j.body.msg1,
                });
              }
            } catch {
              // ignore
            }
            return;
          }

          const parts = raw.split("|");
          if (parts.length < 4) return;
          const trId = parts[1];
          const recCount = Math.max(1, Number(parts[2]) || 1);
          const fields = parts[3].split("^");

          if (trId === "H0STCNT0") {
            for (let i = 0; i < recCount; i++) {
              const o = i * H0STCNT0_FIELDS_PER_RECORD;
              if (fields.length < o + 15) break;
              const code = fields[o + H0STCNT0_IDX.code];
              const hhmmss = fields[o + H0STCNT0_IDX.hhmmss];
              const price = Number(fields[o + H0STCNT0_IDX.price]);
              if (!code || !Number.isFinite(price) || price <= 0) continue;
              const ts = parseHHMMSS(hhmmss) ?? Date.now();

              if (topics.has("price")) {
                const m: PriceMsg = { type: "price", code, price, ts };
                sse("price", m);
              }
              if (topics.has("trade")) {
                const m: TradeMsg = {
                  type: "trade",
                  code,
                  cumVolume: numOrZero(fields[o + H0STCNT0_IDX.cumVolume]),
                  cumTradeValue: numOrZero(fields[o + H0STCNT0_IDX.cumTradeValue]),
                  ts,
                };
                sse("trade", m);
              }
            }
            return;
          }

          if (trId === "H0STASP0" && topics.has("asp")) {
            for (let i = 0; i < recCount; i++) {
              const o = i * H0STASP0_FIELDS_PER_RECORD;
              if (fields.length < o + 45) break;
              const code = fields[o + H0STASP0_IDX.code];
              const hhmmss = fields[o + H0STASP0_IDX.hhmmss];
              if (!code) continue;

              const asks: AspLevel[] = [];
              const bids: AspLevel[] = [];
              for (let k = 0; k < 10; k++) {
                const ap = Number(fields[o + H0STASP0_IDX.askPriceBase + k]);
                const aq = Number(fields[o + H0STASP0_IDX.askQtyBase + k]);
                const bp = Number(fields[o + H0STASP0_IDX.bidPriceBase + k]);
                const bq = Number(fields[o + H0STASP0_IDX.bidQtyBase + k]);
                asks.push({
                  price: Number.isFinite(ap) ? ap : 0,
                  qty: Number.isFinite(aq) ? aq : 0,
                });
                bids.push({
                  price: Number.isFinite(bp) ? bp : 0,
                  qty: Number.isFinite(bq) ? bq : 0,
                });
              }
              const expectedPriceRaw = Number(
                fields[o + H0STASP0_IDX.expectedPrice]
              );
              const expectedVolumeRaw = Number(
                fields[o + H0STASP0_IDX.expectedVolume]
              );

              const m: AspMsg = {
                type: "asp",
                code,
                asks,
                bids,
                totalAskQty: numOrZero(fields[o + H0STASP0_IDX.totalAskQty]),
                totalBidQty: numOrZero(fields[o + H0STASP0_IDX.totalBidQty]),
                expectedPrice:
                  Number.isFinite(expectedPriceRaw) && expectedPriceRaw > 0
                    ? expectedPriceRaw
                    : null,
                expectedVolume:
                  Number.isFinite(expectedVolumeRaw) && expectedVolumeRaw > 0
                    ? expectedVolumeRaw
                    : null,
                ts: parseHHMMSS(hhmmss) ?? Date.now(),
              };
              sse("asp", m);
            }
            return;
          }
        });

        ws.addEventListener("error", () => {
          sse("error", { reason: "websocket-error", ts: Date.now() });
        });

        ws.addEventListener("close", (ev) => {
          sse("closed", {
            code: ev.code,
            reason: ev.reason || null,
            ts: Date.now(),
          });
          cleanup("ws-close");
        });
      } catch (e) {
        sse("error", {
          reason: e instanceof Error ? e.message : String(e),
          ts: Date.now(),
        });
        cleanup("setup-error");
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
