import { getApprovalKey, kisApprovalEnabled } from "@/lib/providers/kisApproval";

// ─── 쿠키 인증 (middleware bypass 대체) ─────────────────────────────
// middleware 는 /api/realtime/stream 을 PUBLIC_PATHS 로 통과시키므로
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
  if (!pass) return true; // 로컬 등 보호 비활성
  const cookieHeader = req.headers.get("cookie") ?? "";
  const m = cookieHeader.match(AUTH_COOKIE_RE);
  if (!m) return false;
  const token = decodeURIComponent(m[1]);
  const expected = await sha256Hex(pass + AUTH_COOKIE_VERSION);
  return token === expected;
}

// ─── 런타임 선택 — Node.js (Edge 아님!) ────────────────────────────────
// Vercel Edge Runtime 은 `new WebSocket(...)` 으로 **외부 서버에 연결하는** 클라이언트
// API 를 지원하지 않는다. (WebSocketPair 같은 인바운드 server-side WebSocket 만 지원.)
// 그래서 KIS WebSocket(ops.koreainvestment.com) 에 outbound 연결하려면 Node.js runtime
// 이 필수. Node 22+ 부터 globalThis.WebSocket 이 native 로 들어와 별도 패키지 불필요.
//
// maxDuration:
//   Vercel Hobby Node function 최대 60s, Pro 는 300s 까지 가능.
//   Hobby 안전선으로 기본 60 으로 설정.
//   클라이언트(`hooks/useRealtime.ts`)는 stream 종료 시 자동 reconnect 한다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const SOFT_TIMEOUT_MS = (maxDuration - 10) * 1000;

// KIS WebSocket 서버 URL 결정 — 견고하게 정규화.
//   1) KIS_WS_URL env 값이 valid `ws://` / `wss://` 면 그대로
//   2) 아니면 KIS_BASE_URL 이 모의(`openapivts`) 면 :31000, 실전이면 :21000 자동 분기
//
// 직전 사고 방지: Vercel env 에 사용자가 `KIS_WS_URL=KIS_WS_URL=wss://...` 같이 `KEY=value`
// 통째로 박은 경우, REST URL 풀 경로를 박은 경우 모두 흡수 → 잘못된 값이면 자동 기본값 사용.
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

function getWsUrl(): string {
  const fromEnv = normalizeWsUrl(process.env.KIS_WS_URL);
  if (fromEnv) return fromEnv;
  // 자동 분기 — REST URL 이 openapivts 면 모의(VTS), 아니면 실전.
  const isVts = (process.env.KIS_BASE_URL ?? "").includes("openapivts");
  return isVts
    ? "wss://ops.koreainvestment.com:31000"
    : "wss://ops.koreainvestment.com:21000";
}

// 한국 종목 코드(005930.KS) → 6자리 KIS short code.
function toKisShortCode(code: string): string | null {
  const m = code.trim().match(/^(\d{6})/);
  return m ? m[1] : null;
}

// "HHMMSS" → epoch ms (오늘 KST 기준).
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

// ─── KIS pipe schema 상수 ────────────────────────────────────────────
// 두 TR 모두 종목당 1 레코드/메시지가 일반적이지만 KIS 가 count > 1 로 묶어 보낼 수 있어
// FIELDS_PER_RECORD 로 슬라이스. 명세는 KIS 공식 docs (open-trading-api Python sample) 기준.

// H0STCNT0 = 국내주식 실시간 체결가. 46 필드. 핵심 인덱스:
//   0=종목코드, 1=체결시간(HHMMSS), 2=현재가, 13=누적거래량(주), 14=누적거래대금(원)
const H0STCNT0_FIELDS_PER_RECORD = 46;
const H0STCNT0_IDX = {
  code: 0,
  hhmmss: 1,
  price: 2,
  cumVolume: 13,
  cumTradeValue: 14,
} as const;

// H0STASP0 = 국내주식 실시간 호가. ~59 필드. 핵심 인덱스:
//   0=종목코드, 1=영업시간(HHMMSS),
//   3..12=매도호가1..10, 13..22=매수호가1..10,
//   23..32=매도잔량1..10, 33..42=매수잔량1..10,
//   43=총매도잔량, 44=총매수잔량,
//   47=예상체결가, 48=예상체결량
const H0STASP0_FIELDS_PER_RECORD = 59;
const H0STASP0_IDX = {
  code: 0,
  hhmmss: 1,
  askPriceBase: 3, // ASKP1..ASKP10 = idx 3..12
  bidPriceBase: 13, // BIDP1..BIDP10 = idx 13..22
  askQtyBase: 23, // ASKP_RSQN1..10 = idx 23..32
  bidQtyBase: 33, // BIDP_RSQN1..10 = idx 33..42
  totalAskQty: 43,
  totalBidQty: 44,
  expectedPrice: 47,
  expectedVolume: 48,
} as const;

// ─── 출력 메시지 타입 ────────────────────────────────────────────────
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
  asks: AspLevel[]; // 1..10
  bids: AspLevel[]; // 1..10
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
  if (out.size === 0) out.add("price"); // Phase 1 호환 — topics 미지정 = price만
  return out;
}

function numOrZero(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols") ?? "";
  const topics = parseTopics(url.searchParams.get("topics"));

  // 구독할 KIS TR — price/trade 는 H0STCNT0 한 번으로 동시 추출.
  const trIds: string[] = [];
  if (topics.has("price") || topics.has("trade")) trIds.push("H0STCNT0");
  if (topics.has("asp")) trIds.push("H0STASP0");

  // KIS WS 동시 구독 41건 한도 (tr_id × tr_key). 종목 수 × trIds 수.
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

      // maxDuration - 10 시점에 우아하게 reconnect 이벤트 보내고 종료.
      softTimer = setTimeout(() => {
        sse("reconnect", { reason: "soft-timeout", ts: Date.now() });
        cleanup("soft-timeout");
      }, SOFT_TIMEOUT_MS);

      try {
        ws = new WebSocket(getWsUrl());

        ws.addEventListener("open", () => {
          sse("open", {
            ts: Date.now(),
            symbolCount: krCodes.length,
            trIds,
            topics: Array.from(topics),
          });
          // 각 종목 × 각 TR 조합으로 subscribe 메시지 전송.
          for (const { six } of krCodes) {
            for (const trId of trIds) {
              const msg = {
                header: {
                  approval_key: approvalKey,
                  custtype: "P",
                  tr_type: "1", // 1=subscribe
                  "content-type": "utf-8",
                },
                body: {
                  input: { tr_id: trId, tr_key: six },
                },
              };
              try {
                ws!.send(JSON.stringify(msg));
              } catch {
                // socket 닫힘 — close handler 가 정리
              }
            }
          }
        });

        ws.addEventListener("message", (ev) => {
          const raw = typeof ev.data === "string" ? ev.data : "";
          if (raw.length === 0) return;

          // JSON 컨트롤 메시지: subscribe ack / PINGPONG / error
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
              // 파싱 실패 — 무시
            }
            return;
          }

          // PIPE 데이터 프레임: "0|H0STCNT0|count|f0^f1^..." 또는 "0|H0STASP0|count|..."
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
                const cumVolume = numOrZero(fields[o + H0STCNT0_IDX.cumVolume]);
                const cumTradeValue = numOrZero(
                  fields[o + H0STCNT0_IDX.cumTradeValue]
                );
                const m: TradeMsg = {
                  type: "trade",
                  code,
                  cumVolume,
                  cumTradeValue,
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
