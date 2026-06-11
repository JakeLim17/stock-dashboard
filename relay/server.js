'use strict';

// ─────────────────────────────────────────────────────────────────────
// stock-dashboard relay 서버 (한국 IP 호스트용)
//
// 역할:
//   Vercel 함수(sin1/hnd1 등 한국 외 리전)에서 KIS WebSocket(ops.koreainvestment.com:21000)
//   에 연결하면 handshake 직후 1006 으로 끊긴다 (KIS 가 한국 외 IP 차단 추정).
//   이 서버를 한국 IP(Oracle Cloud Seoul / 집서버 / NAS 등) 에 띄워서:
//
//     [Browser] → [Vercel /api/realtime/stream] → fetch SSE → [이 서버 /sse] → ws → [KIS]
//
//   클라이언트가 받는 SSE 이벤트 스키마는 기존 Vercel 라우트(`app/api/realtime/stream/route.ts`)
//   와 100% 동일하게 유지 (price/trade/asp/open/closed/warn/error/reconnect).
//
// 엔드포인트:
//   GET /healthz                              → { ok, ts, wsBase }
//   GET /sse?symbols=A,B&topics=price,trade   → text/event-stream
//        Header `x-relay-secret` 또는 query `secret` 으로 인증.
//        없으면 401.
//
// 의존:
//   - KIS_APP_KEY / KIS_APP_SECRET / KIS_BASE_URL: KIS approval_key 발급용
//   - RELAY_SHARED_SECRET: Vercel ↔ relay 간 공유 비밀
//   - KIS_USE_MOCK=1 이면 모의(VTS) 엔드포인트 (:31000) 사용
//   - PORT (기본 8787)
//
// 보안:
//   - 인증은 단일 RELAY_SHARED_SECRET 으로 충분. (Vercel 함수만 호출하므로)
//   - 도메인·HTTPS 는 Cloudflare Tunnel / nginx + Let's Encrypt 등 외부 레이어 권장.
//   - 로그에 KIS_APP_SECRET / approval_key 노출 금지.
//
// 단순화:
//   - 클라이언트당 KIS WebSocket 1개 (multiplexing X). 동시 사용자 수가 매우 적은 개인용 가정.
//   - approval_key 는 24h KV 없이 메모리 + 디스크(/tmp) 캐시만.
// ─────────────────────────────────────────────────────────────────────

// .env.local 우선 로드(있으면), 없으면 .env
try {
  require('dotenv').config({ path: '.env.local' });
} catch (_) {
  // dotenv 미설치 시 무시 (npm install 전)
}
try {
  require('dotenv').config();
} catch (_) {
  // 동상
}

const express = require('express');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// ───────────────────────────── 설정 ─────────────────────────────

const PORT = Number(process.env.PORT) || 8787;
const RELAY_SHARED_SECRET = process.env.RELAY_SHARED_SECRET || '';
const KIS_APP_KEY = process.env.KIS_APP_KEY || '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET || '';
const KIS_USE_MOCK =
  process.env.KIS_USE_MOCK === '1' || process.env.KIS_USE_MOCK === 'true';

function normalizeHttpsBase(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const eq = s.indexOf('=');
  if (eq > -1 && /^[A-Z0-9_]+$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.host}`;
  } catch (_) {
    return null;
  }
}

function getKisRestBase() {
  return (
    normalizeHttpsBase(process.env.KIS_BASE_URL) ||
    (KIS_USE_MOCK
      ? 'https://openapivts.koreainvestment.com:29443'
      : 'https://openapi.koreainvestment.com:9443')
  );
}

function getKisWsUrl() {
  // 명시 env 우선
  const raw = (process.env.KIS_WS_URL || '').trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'ws:' || u.protocol === 'wss:') return raw;
    } catch (_) {
      // 무시 → 기본값
    }
  }
  return KIS_USE_MOCK
    ? 'wss://ops.koreainvestment.com:31000'
    : 'wss://ops.koreainvestment.com:21000';
}

function log(...args) {
  console.log('[relay]', new Date().toISOString(), ...args);
}

function logErr(...args) {
  console.error('[relay]', new Date().toISOString(), ...args);
}

// ────────────────────── KIS approval_key 캐시 ──────────────────────
//
// 매우 단순화: 메모리 + /tmp 디스크. KV 의존 X (relay 는 단일 인스턴스 가정).
// approval_key TTL = 23h (실제 KIS 정책 24h - 1h 안전 마진).

const APPROVAL_FILE = path.join(
  process.env.HOME || '/tmp',
  '.stock-dashboard-relay-approval.json',
);

let approvalCache = null; // { approvalKey, expiresAt, fingerprint }
let approvalInflight = null;
let approvalCooldownUntil = 0;

function keyFingerprint() {
  return `${KIS_APP_KEY.slice(0, 8)}:${KIS_APP_KEY.length}`;
}

function loadApprovalFromDisk() {
  try {
    const raw = fs.readFileSync(APPROVAL_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.approvalKey === 'string' &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > Date.now() &&
      parsed.fingerprint === keyFingerprint()
    ) {
      approvalCache = parsed;
      log(
        'approval cache loaded from disk, expires in',
        Math.round((parsed.expiresAt - Date.now()) / 1000),
        's',
      );
    }
  } catch (_) {
    // 파일 없음/파싱 실패 → 무시
  }
}

function saveApprovalToDisk(cache) {
  try {
    fs.writeFileSync(APPROVAL_FILE, JSON.stringify(cache), 'utf8');
  } catch (e) {
    logErr('approval cache disk write failed:', e.message);
  }
}

async function requestNewApproval(reason) {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) return null;
  log(`requesting new approval_key (reason=${reason}, fp=${keyFingerprint()})`);
  try {
    const res = await fetch(`${getKisRestBase()}/oauth2/Approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: KIS_APP_KEY,
        // ⚠ REST 토큰은 `appsecret`, WebSocket approval 은 `secretkey` — KIS 규격.
        secretkey: KIS_APP_SECRET,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      approvalCooldownUntil = Date.now() + 60_000;
      logErr(`approval_key 발급 실패 (${res.status}): ${txt.slice(0, 200)}`);
      return null;
    }
    const json = await res.json();
    if (!json || !json.approval_key) {
      approvalCooldownUntil = Date.now() + 60_000;
      logErr('approval_key 응답에 approval_key 없음');
      return null;
    }
    const cache = {
      approvalKey: json.approval_key,
      expiresAt: Date.now() + 23 * 60 * 60 * 1000,
      fingerprint: keyFingerprint(),
    };
    approvalCache = cache;
    saveApprovalToDisk(cache);
    log('approval_key 신규 발급 완료, 24h 캐시');
    return cache.approvalKey;
  } catch (e) {
    approvalCooldownUntil = Date.now() + 60_000;
    logErr('approval_key 발급 throw:', e.message);
    return null;
  }
}

async function getApprovalKey() {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) return null;
  if (!approvalCache) loadApprovalFromDisk();
  if (approvalCache && approvalCache.expiresAt > Date.now()) {
    return approvalCache.approvalKey;
  }
  if (approvalCooldownUntil > Date.now()) return null;
  if (approvalInflight) return approvalInflight;
  const reason = approvalCache ? 'cache-expired' : 'no-cache';
  approvalInflight = requestNewApproval(reason).finally(() => {
    approvalInflight = null;
  });
  return approvalInflight;
}

// ───────────────────────── KIS pipe 스키마 ─────────────────────────

const H0STCNT0_FIELDS_PER_RECORD = 46;
const H0STCNT0_IDX = {
  code: 0,
  hhmmss: 1,
  price: 2,
  cumVolume: 13,
  cumTradeValue: 14,
};

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
};

const VALID_TOPICS = new Set(['price', 'trade', 'asp']);

function parseTopics(raw) {
  const out = new Set();
  if (raw) {
    for (const t of String(raw).split(',').map((s) => s.trim().toLowerCase())) {
      if (VALID_TOPICS.has(t)) out.add(t);
    }
  }
  if (out.size === 0) out.add('price');
  return out;
}

function toKisShortCode(code) {
  const m = String(code).trim().match(/^(\d{6})/);
  return m ? m[1] : null;
}

function parseHHMMSS(s) {
  if (!s) return null;
  const padded = String(s).padStart(6, '0').slice(0, 6);
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

function numOrZero(s) {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ───────────────────────────── Express ─────────────────────────────

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    wsBase: getKisWsUrl(),
    restBase: getKisRestBase(),
    secretConfigured: !!RELAY_SHARED_SECRET,
    kisKeyConfigured: !!KIS_APP_KEY && !!KIS_APP_SECRET,
  });
});

function checkSecret(req) {
  if (!RELAY_SHARED_SECRET) return true; // 비활성(로컬 테스트용). 운영에선 반드시 설정.
  const fromHeader = req.headers['x-relay-secret'];
  const fromQuery = req.query.secret;
  return fromHeader === RELAY_SHARED_SECRET || fromQuery === RELAY_SHARED_SECRET;
}

app.get('/sse', async (req, res) => {
  if (!checkSecret(req)) {
    return res
      .status(401)
      .json({ error: 'unauthorized', hint: 'x-relay-secret header 필요' });
  }
  if (!KIS_APP_KEY || !KIS_APP_SECRET) {
    return res
      .status(503)
      .json({ error: 'KIS_APP_KEY/SECRET 미설정 — relay 환경변수 확인' });
  }

  const symbolsParam = String(req.query.symbols || '');
  const topics = parseTopics(req.query.topics);

  const trIds = [];
  if (topics.has('price') || topics.has('trade')) trIds.push('H0STCNT0');
  if (topics.has('asp')) trIds.push('H0STASP0');

  const MAX_SUBSCRIPTIONS = 41;
  const maxSymbols = Math.max(
    1,
    Math.floor(MAX_SUBSCRIPTIONS / Math.max(1, trIds.length)),
  );

  const symbols = symbolsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxSymbols);

  if (symbols.length === 0) {
    return res.status(400).json({ error: 'symbols 파라미터 필요' });
  }

  const krCodes = symbols
    .map((c) => ({ orig: c, six: toKisShortCode(c) }))
    .filter((x) => x.six);

  if (krCodes.length === 0) {
    return res.status(400).json({ error: '한국 종목 6자리 코드 없음' });
  }

  const approvalKey = await getApprovalKey();
  if (!approvalKey) {
    return res.status(503).json({
      error: 'approval_key 발급 실패 또는 cooldown 중',
    });
  }

  // ─── SSE 응답 헤더 ───
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  // Vercel 함수가 SSR fetch 로 받을 때 CORS 불필요(서버→서버) 이지만 직접 EventSource 테스트 편의용.
  res.setHeader('Access-Control-Allow-Origin', '*');
  // flush headers 즉시
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  let ws = null;
  let pingTimer = null;

  const sse = (event, data) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {
      // 이미 닫힘
    }
  };

  const cleanup = (reason) => {
    if (closed) return;
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    if (ws) {
      try {
        ws.close(1000, reason);
      } catch (_) {
        // ignore
      }
      ws = null;
    }
    try {
      res.end();
    } catch (_) {
      // ignore
    }
  };

  req.on('close', () => cleanup('client-close'));
  req.on('aborted', () => cleanup('client-aborted'));

  // KIS WebSocket 연결
  try {
    const wsUrl = getKisWsUrl();
    log(`/sse open: symbols=${krCodes.length} topics=${Array.from(topics).join(',')} ws=${wsUrl}`);
    ws = new WebSocket(wsUrl, {
      handshakeTimeout: 10_000,
    });

    ws.on('open', () => {
      sse('open', {
        ts: Date.now(),
        symbolCount: krCodes.length,
        trIds,
        topics: Array.from(topics),
        relay: true,
      });

      for (const { six } of krCodes) {
        for (const trId of trIds) {
          const msg = {
            header: {
              approval_key: approvalKey,
              custtype: 'P',
              tr_type: '1',
              'content-type': 'utf-8',
            },
            body: {
              input: { tr_id: trId, tr_key: six },
            },
          };
          try {
            ws.send(JSON.stringify(msg));
          } catch (_) {
            // close 핸들러가 정리
          }
        }
      }

      // 클라이언트(Vercel) 측 keepalive — 30s 마다 SSE comment.
      pingTimer = setInterval(() => {
        if (closed) return;
        try {
          res.write(': keepalive\n\n');
        } catch (_) {
          // ignore
        }
      }, 30_000);
    });

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      if (!text) return;

      // JSON 컨트롤 메시지
      if (text.charCodeAt(0) === 0x7b /* '{' */) {
        try {
          const j = JSON.parse(text);
          if (j.header && j.header.tr_id === 'PINGPONG') {
            try {
              ws.send(text);
            } catch (_) {
              // ignore
            }
            return;
          }
          if (j.body && j.body.rt_cd && j.body.rt_cd !== '0') {
            sse('warn', {
              rt_cd: j.body.rt_cd,
              msg_cd: j.body.msg_cd,
              msg: j.body.msg1,
            });
          }
        } catch (_) {
          // 파싱 실패 무시
        }
        return;
      }

      // PIPE 데이터 프레임: "0|H0STCNT0|count|f0^f1^..."
      const parts = text.split('|');
      if (parts.length < 4) return;
      const trId = parts[1];
      const recCount = Math.max(1, Number(parts[2]) || 1);
      const fields = parts[3].split('^');

      if (trId === 'H0STCNT0') {
        for (let i = 0; i < recCount; i++) {
          const o = i * H0STCNT0_FIELDS_PER_RECORD;
          if (fields.length < o + 15) break;
          const code = fields[o + H0STCNT0_IDX.code];
          const hhmmss = fields[o + H0STCNT0_IDX.hhmmss];
          const price = Number(fields[o + H0STCNT0_IDX.price]);
          if (!code || !Number.isFinite(price) || price <= 0) continue;
          const ts = parseHHMMSS(hhmmss) || Date.now();

          if (topics.has('price')) {
            sse('price', { type: 'price', code, price, ts });
          }
          if (topics.has('trade')) {
            sse('trade', {
              type: 'trade',
              code,
              cumVolume: numOrZero(fields[o + H0STCNT0_IDX.cumVolume]),
              cumTradeValue: numOrZero(fields[o + H0STCNT0_IDX.cumTradeValue]),
              ts,
            });
          }
        }
        return;
      }

      if (trId === 'H0STASP0' && topics.has('asp')) {
        for (let i = 0; i < recCount; i++) {
          const o = i * H0STASP0_FIELDS_PER_RECORD;
          if (fields.length < o + 45) break;
          const code = fields[o + H0STASP0_IDX.code];
          const hhmmss = fields[o + H0STASP0_IDX.hhmmss];
          if (!code) continue;

          const asks = [];
          const bids = [];
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
          const expectedPriceRaw = Number(fields[o + H0STASP0_IDX.expectedPrice]);
          const expectedVolumeRaw = Number(fields[o + H0STASP0_IDX.expectedVolume]);

          sse('asp', {
            type: 'asp',
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
            ts: parseHHMMSS(hhmmss) || Date.now(),
          });
        }
      }
    });

    ws.on('error', (e) => {
      logErr('ws error:', e && e.message);
      sse('error', { reason: 'websocket-error', message: e && e.message, ts: Date.now() });
    });

    ws.on('close', (code, reasonBuf) => {
      const reason = reasonBuf && reasonBuf.toString ? reasonBuf.toString('utf8') : '';
      log(`ws close code=${code} reason=${reason || '(none)'}`);
      sse('closed', { code, reason: reason || null, ts: Date.now() });
      cleanup('ws-close');
    });
  } catch (e) {
    logErr('setup error:', e && e.message);
    sse('error', { reason: e && e.message ? e.message : String(e), ts: Date.now() });
    cleanup('setup-error');
  }
});

// ───────────────────────────── 부팅 ─────────────────────────────

const server = app.listen(PORT, () => {
  log(`relay listening on :${PORT}`);
  log(`KIS REST base: ${getKisRestBase()}`);
  log(`KIS WS base:   ${getKisWsUrl()}`);
  log(`shared secret: ${RELAY_SHARED_SECRET ? 'configured' : 'NOT SET (open mode — dev only!)'}`);
  if (!KIS_APP_KEY || !KIS_APP_SECRET) {
    logErr('KIS_APP_KEY / KIS_APP_SECRET 미설정 — /sse 호출 시 503 응답');
  }
});

// graceful shutdown
function shutdown(sig) {
  log(`received ${sig}, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
