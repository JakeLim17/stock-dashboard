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
//   Hobby 안전선으로 기본 60 으로 설정. Pro 면 환경변수 REALTIME_MAX_DURATION 로 override.
//   클라이언트(`hooks/useRealtime.ts`)는 stream 종료 시 자동 reconnect 한다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Vercel 빌드 시 정적으로 읽히는 export — env 로 동적 조정은 불가하지만 60s 가 Hobby 한계라 안전.
export const maxDuration = 60;

// 클라이언트가 끊지 않아도 우리가 timeout 직전에 우아하게 닫고 reconnect 시킴.
// maxDuration 보다 10초 여유 — 갑작스러운 502 응답 방지.
const SOFT_TIMEOUT_MS = (maxDuration - 10) * 1000;

// KIS WebSocket 서버 — 실전 21000, 모의 31000.
function getWsUrl(): string {
  return (
    process.env.KIS_WS_URL ??
    "wss://ops.koreainvestment.com:21000/tryitout"
  );
}

// 한국 종목 코드(005930.KS) → 6자리 KIS short code. 미국 등 비한국은 null → 건너뜀.
function toKisShortCode(code: string): string | null {
  const m = code.trim().match(/^(\d{6})/);
  return m ? m[1] : null;
}

// "YYYYMMDD HHMMSS" 또는 "HHMMSS" → epoch ms (오늘 KST 기준).
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

// H0STCNT0 한 레코드 필드 수 — KIS 공식 명세 기준 46개.
// 한 PIPE 메시지에 여러 레코드가 묶여 오는 경우(count > 1) 슬라이스에 사용.
const H0STCNT0_FIELDS_PER_RECORD = 46;

interface PriceMsg {
  type: "price";
  code: string; // 6자리 단축 코드 (예: "005930")
  price: number;
  ts: number; // epoch ms
}

export async function GET(req: Request) {
  // 인증 — middleware 가 통과시켰으므로 라우트가 직접 확인.
  if (!(await isAuthorized(req))) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols") ?? "";
  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 41); // KIS WebSocket 동시 구독 최대 41건 (tr_id × tr_key 조합)

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

  // 한국 종목만 필터. 미국/지수 등은 KIS 국내주식 WS 가 지원 안 함.
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
          const payload =
            `event: ${event}\n` +
            `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // controller 가 이미 닫혔거나 backpressure 폭주 — 무시.
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

      // 클라이언트가 EventSource.close() 호출하거나 페이지 떠나면 즉시 정리.
      abortHandler = () => cleanup("client-abort");
      req.signal.addEventListener("abort", abortHandler);

      // 250s ≒ maxDuration - 10 시점에 우아하게 reconnect 이벤트 보내고 종료.
      // 클라이언트는 이 이벤트를 받으면 즉시 새 EventSource 를 연다 (downtime 거의 0).
      softTimer = setTimeout(() => {
        sse("reconnect", { reason: "soft-timeout", ts: Date.now() });
        cleanup("soft-timeout");
      }, SOFT_TIMEOUT_MS);

      try {
        ws = new WebSocket(getWsUrl());

        ws.addEventListener("open", () => {
          sse("open", { ts: Date.now(), count: krCodes.length });
          // H0STCNT0 = 주식 체결가 (실시간 tick)
          for (const { six } of krCodes) {
            const msg = {
              header: {
                approval_key: approvalKey,
                custtype: "P",
                tr_type: "1", // 1=subscribe, 2=unsubscribe
                "content-type": "utf-8",
              },
              body: {
                input: { tr_id: "H0STCNT0", tr_key: six },
              },
            };
            try {
              ws!.send(JSON.stringify(msg));
            } catch {
              // socket 닫힘 — close handler 가 정리.
            }
          }
        });

        ws.addEventListener("message", (ev) => {
          const raw = typeof ev.data === "string" ? ev.data : "";
          if (raw.length === 0) return;

          // JSON 컨트롤 메시지: subscribe ack, PINGPONG, error.
          if (raw.charCodeAt(0) === 0x7b /* '{' */) {
            try {
              const j = JSON.parse(raw) as {
                header?: { tr_id?: string };
                body?: { rt_cd?: string; msg_cd?: string; msg1?: string };
              };
              const trId = j.header?.tr_id;
              if (trId === "PINGPONG") {
                // KIS 측에서 보내오는 ping → 동일 payload 그대로 echo.
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
              // subscribe ack (rt_cd=0) 는 무시.
            } catch {
              // 파싱 실패 무시
            }
            return;
          }

          // PIPE 데이터 프레임: "0|H0STCNT0|count|f0^f1^...^fN"
          // - 첫 segment: 암호화 여부 (0=평문, 1=암호)
          // - 두 번째: tr_id
          // - 세 번째: 레코드 개수
          // - 네 번째: '^' 로 구분된 필드 묶음 (count 만큼 반복)
          const parts = raw.split("|");
          if (parts.length < 4) return;
          const trId = parts[1];
          if (trId !== "H0STCNT0") return;
          const recCount = Math.max(1, Number(parts[2]) || 1);
          const fields = parts[3].split("^");

          const out: PriceMsg[] = [];
          for (let i = 0; i < recCount; i++) {
            const start = i * H0STCNT0_FIELDS_PER_RECORD;
            if (fields.length < start + 3) break;
            const code = fields[start + 0];
            const hhmmss = fields[start + 1];
            const priceStr = fields[start + 2];
            const price = Number(priceStr);
            if (!code || !Number.isFinite(price) || price <= 0) continue;
            out.push({
              type: "price",
              code,
              price,
              ts: parseHHMMSS(hhmmss) ?? Date.now(),
            });
          }
          for (const m of out) {
            sse("price", m);
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
      // Vercel/Nginx proxy 버퍼링 비활성 — chunk 즉시 flush.
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
