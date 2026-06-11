import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AskingPriceData,
  AskingPriceLevel,
  ExecutionTick,
  FlowData,
  IndexQuote,
  MarketLeader,
  MarketLeadersData,
  MarketLeadersKind,
  MarketLeadersMarket,
  ProgramTradeData,
  Quote,
  ShortBalanceData,
} from "../types";
import { toKisCode } from "../symbols";
import type { HistoricalPoint } from "./yahoo";

// 한국투자증권(KIS) Open API provider.
// - 토큰: 메모리 캐싱 + 만료 5분 전 자동 갱신, 동시 호출 시 단일 in-flight 공유.
// - 엔드포인트(7): 토큰 / 국내시세 / 국내일별 / 국내수급 / 해외시세 / 해외일별
// - 응답 키는 KIS 공식 명세(stck_prpr 등)를 그대로 따른다.

// ────────────────────────────────────────────────────────────────────
// 기본 설정
// ────────────────────────────────────────────────────────────────────

// `kisApproval.ts` 와 동일한 정규화 — Vercel env 에 사용자가 `KIS_BASE_URL=https://...`
// 통째로 또는 path 가 붙은 URL 을 박은 사고를 흡수한다. (REST 경로는 path 결합 시
// 잘못된 URL 이 만들어져 모든 호출이 throw 로 떨어진다.)
//   - 정상 origin (https://host:port) 이면 그대로
//   - "KEY=value" 같은 prefix 가 있으면 잘라냄
//   - path 가 붙어 있어도 protocol+host(+port) 만 남김
// 위 어느 것도 통과 못 하면 모의(VTS) 기본값.
function normalizeHttpsBase(raw: string | undefined | null): string | null {
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
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function getBaseUrl(): string {
  return (
    normalizeHttpsBase(process.env.KIS_BASE_URL) ??
    "https://openapivts.koreainvestment.com:29443"
  );
}

function getAppKey(): string | null {
  return process.env.KIS_APP_KEY ?? null;
}

function getAppSecret(): string | null {
  return process.env.KIS_APP_SECRET ?? null;
}

export function kisEnabled(): boolean {
  return !!(getAppKey() && getAppSecret());
}

// 디버그 로그 — DEBUG_KIS=1 일 때만 활성화. 평소엔 조용히.
function dbg(...args: unknown[]): void {
  if (process.env.DEBUG_KIS === "1" || process.env.DEBUG_KIS === "true") {
    console.log("[kis]", ...args);
  }
}

// ────────────────────────────────────────────────────────────────────
// OAuth 토큰
// ────────────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms — 실제 expires_in 보다 5분 일찍 만료 취급
  // 어떤 키로 발급된 토큰인지 — 키가 바뀌면 캐시 무효화
  keyFingerprint: string;
}

// 메모리 캐시 — 같은 lambda 인스턴스 내 hot reuse. cold start 마다 사라짐.
let cachedToken: TokenCache | null = null;
let inflightTokenPromise: Promise<string> | null = null;
// 토큰 발급 1분당 1회(EGW00133) lockout 회피용 cooldown.
// 발급 실패 시 일정 시간 추가 요청을 즉시 throw → 같은 시간 내 호출자는 빠르게 fallback 가도록.
// KIS는 토큰 신규 발급 시 카톡 알림(1일 1회 정책)을 보내므로 cooldown 을 보수적으로 길게.
let tokenCooldownUntil = 0;
// 영속 저장소(KV/디스크) 조회 최근 시각 — 너무 자주 KV 호출 안 하도록 throttle.
// 메모리 캐시가 유효한 동안은 영속 저장소 안 봄. 만료/미스 시에만 throttle 안에서 재조회.
let lastStoreCheckAt = 0;
const STORE_RECHECK_INTERVAL_MS = 30_000;

function tokenCooldownMs(): number {
  const fromEnv = Number(process.env.KIS_TOKEN_COOLDOWN_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 300_000; // 기본 5분 — 카톡 폭주 방지. 정상이면 토큰 1일 1회만 발급.
}

// ─── 토큰 영속 저장소 ──────────────────────────────────────────────────
// 우선순위: 1) Vercel KV (cross-instance) → 2) /tmp 파일 (instance hot reuse)
// → 3) 메모리 캐시 (cachedToken).
//
// Vercel serverless 환경은 `node_modules/.cache` 가 read-only 라 기존 디스크
// 캐시가 무용지물이었음. 결과적으로 lambda cold start 마다 토큰 신규 발급 →
// KIS 카톡 알림 폭주. KV (Upstash) 가 설정되면 모든 인스턴스가 같은 토큰을
// 공유해 발급은 24h 에 1회만 발생한다.
//
// KV REST API 직접 호출 — `@vercel/kv`/`@upstash/redis` 패키지 추가 없이도 동작.

const KV_TOKEN_KEY = "kis:token:v1";

function getKvUrl(): string | null {
  return (
    process.env.KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    null
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

async function kvGet(key: string): Promise<string | null> {
  const url = getKvUrl();
  const token = getKvToken();
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string | null };
    return json.result ?? null;
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: string, ttlSec: number): Promise<boolean> {
  const url = getKvUrl();
  const token = getKvToken();
  if (!url || !token) return false;
  try {
    // Upstash REST: POST /set/{key}/{value}?EX={ttl}
    const res = await fetch(
      `${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSec}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// /tmp 는 Vercel serverless 인스턴스 내 쓰기 가능 (인스턴스 격리되긴 함).
// 로컬/일반 Node 환경에서는 .cache/ 폴더로 폴백 (node_modules 가 아니라 프로젝트 루트).
function tokenDiskPath(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return "/tmp/kis-token.json";
  }
  return path.join(process.cwd(), ".cache", "kis-token.json");
}

function keyFingerprint(): string {
  const k = getAppKey() ?? "";
  // 앞 8자만 fingerprint로 — 키가 같은 환경인지 확인용 (전체 키는 디스크 평문 저장 안 함을 흉내)
  return `${k.slice(0, 8)}:${k.length}`;
}

function isValidStoredToken(parsed: Partial<TokenCache> | null | undefined): parsed is TokenCache {
  return !!(
    parsed?.token &&
    typeof parsed.expiresAt === "number" &&
    parsed.expiresAt > Date.now() &&
    parsed.keyFingerprint === keyFingerprint()
  );
}

async function loadTokenFromStore(): Promise<void> {
  // 메모리 캐시가 유효하면 영속 저장소 안 봄.
  if (cachedToken && cachedToken.expiresAt > Date.now()) return;
  // 너무 자주 KV/디스크 조회 안 하도록 30초 throttle.
  // (단, 처음 한 번은 무조건 조회되도록 lastStoreCheckAt = 0 으로 시작.)
  if (lastStoreCheckAt > 0 && Date.now() - lastStoreCheckAt < STORE_RECHECK_INTERVAL_MS) return;
  lastStoreCheckAt = Date.now();

  // 1) Vercel KV / Upstash 우선 (cross-instance 공유) — 다른 인스턴스가 갱신한 토큰을 본다.
  if (isKvConfigured()) {
    try {
      const raw = await kvGet(KV_TOKEN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TokenCache>;
        if (isValidStoredToken(parsed)) {
          cachedToken = parsed;
          dbg("[token] loaded from KV (cross-instance), expires in",
            Math.round((parsed.expiresAt - Date.now()) / 1000), "s");
          return;
        }
      }
    } catch {
      // KV 실패 — 파일 폴백
    }
  }

  // 2) /tmp (또는 .cache/) 파일 폴백 — 같은 인스턴스 hot reuse.
  try {
    const raw = await fs.readFile(tokenDiskPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<TokenCache>;
    if (isValidStoredToken(parsed)) {
      cachedToken = parsed;
      dbg("[token] loaded from disk", tokenDiskPath());
    }
  } catch {
    // 파일 없음/파싱 실패 — 무시 (메모리 캐시만으로 동작)
  }
}

async function saveTokenToStore(tc: TokenCache): Promise<void> {
  const json = JSON.stringify(tc);
  // KV TTL — 만료까지 남은 시간(최소 60초, 최대 24시간).
  const ttlSec = Math.max(
    60,
    Math.min(86_400, Math.floor((tc.expiresAt - Date.now()) / 1000))
  );

  // 1) Vercel KV 저장 (cross-instance 공유). 실패해도 디스크/메모리로 동작 가능.
  if (isKvConfigured()) {
    const ok = await kvSet(KV_TOKEN_KEY, json, ttlSec);
    if (ok) dbg("[token] saved to KV, ttl=", ttlSec, "s");
  }

  // 2) /tmp 파일 저장 (KV 없을 때 같은 인스턴스 hot reuse).
  try {
    const filePath = tokenDiskPath();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, json, "utf8");
    await fs.rename(tmp, filePath);
  } catch {
    // 쓰기 실패는 치명적이지 않음 — 메모리 캐시로 동작 가능
  }
}

interface KisTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number; // sec
  access_token_token_expired?: string; // "YYYY-MM-DD HH:mm:ss"
}

async function requestNewToken(reason: string): Promise<string> {
  const appkey = getAppKey();
  const appsecret = getAppSecret();
  if (!appkey || !appsecret) {
    throw new Error("KIS_APP_KEY / KIS_APP_SECRET 가 설정되지 않음");
  }

  // KIS 신규 토큰 발급은 카톡 알림(1일 1회 정책) 트리거. Vercel 로그에서 빈도 추적 가능하도록
  // 디버그 플래그 무관하게 항상 한 줄 남긴다 (시크릿은 노출 안 함 — fingerprint만).
  console.warn(
    `[kis] requesting new token (reason=${reason}, fingerprint=${keyFingerprint()}, kvConfigured=${isKvConfigured()})`
  );

  const res = await fetch(`${getBaseUrl()}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey,
      appsecret,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // EGW00133 = 1분당 1회 제한. cooldown (기본 5분) 걸어 추가 호출 차단.
    // 60초가 너무 짧아 폴링 사이클 안에서 다시 요청 → 카톡 폭주 사고가 있었음.
    if (res.status === 403 && /EGW00133|1분당 1회/.test(text)) {
      tokenCooldownUntil = Date.now() + tokenCooldownMs();
    }
    throw new Error(`KIS 토큰 발급 실패 (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as KisTokenResponse;
  if (!json.access_token) {
    throw new Error("KIS 토큰 응답에 access_token 없음");
  }

  const expiresInSec = typeof json.expires_in === "number" ? json.expires_in : 86_400;
  const safeWindowMs = 5 * 60 * 1000;
  const expiresAt = Date.now() + expiresInSec * 1000 - safeWindowMs;

  const tc: TokenCache = {
    token: json.access_token,
    expiresAt,
    keyFingerprint: keyFingerprint(),
  };
  cachedToken = tc;
  // 비동기 영속 저장 — 실패해도 무시 (메모리 캐시로 계속 동작)
  void saveTokenToStore(tc);
  return json.access_token;
}

async function getToken(forceRefresh = false): Promise<string> {
  await loadTokenFromStore();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  // 발급 cooldown — 토큰 새로 못 받으므로 즉시 throw (호출자는 naver/yahoo로 fallback).
  if (tokenCooldownUntil > Date.now()) {
    const sec = Math.ceil((tokenCooldownUntil - Date.now()) / 1000);
    throw new Error(`KIS 토큰 cooldown 중 (${sec}초 남음) — naver/yahoo로 fallback`);
  }
  if (inflightTokenPromise) return inflightTokenPromise;

  const reason = forceRefresh
    ? "force-refresh (401/403 응답)"
    : cachedToken
      ? "cache-expired"
      : "no-cache (cold start)";

  inflightTokenPromise = requestNewToken(reason).finally(() => {
    inflightTokenPromise = null;
  });
  return inflightTokenPromise;
}

// ────────────────────────────────────────────────────────────────────
// 공통 GET 헬퍼 — 401 시 토큰 1회 재발급 후 재시도
// ────────────────────────────────────────────────────────────────────

interface KisGetParams {
  path: string;
  trId: string;
  query: Record<string, string>;
  custType?: "P" | "B"; // 개인/법인. 기본 P
}

// KIS 초당 호출 한도(EGW00201) 대응 throttle.
// 모의투자(openapivts)는 초당 ~1건, 실전은 키별 한도가 달라 보수적으로 직렬화.
// 실전 환경에서도 EGW00201이 자주 발생해서 (단일 키 동시 호출 제한) — 안전 마진 크게.
function isVtsMode(): boolean {
  return (process.env.KIS_BASE_URL ?? "").includes("openapivts");
}
function kisMinIntervalMs(): number {
  // 환경 변수로 override 가능 — 실전 키 한도 여유 있으면 낮춰 사용.
  const fromEnv = Number(process.env.KIS_MIN_INTERVAL_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return isVtsMode() ? 1100 : 250; // 실전 초당 ~4건 (안전 마진)
}
function kisMaxConcurrency(): number {
  return 1; // 직렬화 — EGW00201 회피 우선
}

let kisActiveCount = 0;
let kisLastSendAt = 0;
const kisWaiters: Array<() => void> = [];

async function acquireKisSlot(): Promise<void> {
  const maxC = kisMaxConcurrency();
  const minInterval = kisMinIntervalMs();
  while (true) {
    if (kisActiveCount < maxC) {
      const since = Date.now() - kisLastSendAt;
      if (since >= minInterval) {
        kisActiveCount += 1;
        kisLastSendAt = Date.now();
        return;
      }
      await new Promise((r) => setTimeout(r, minInterval - since));
      continue;
    }
    await new Promise<void>((resolve) => kisWaiters.push(resolve));
  }
}


function releaseKisSlot(): void {
  kisActiveCount = Math.max(0, kisActiveCount - 1);
  const next = kisWaiters.shift();
  if (next) next();
}

async function kisGet<T>(params: KisGetParams): Promise<T> {
  const appkey = getAppKey();
  const appsecret = getAppSecret();
  if (!appkey || !appsecret) {
    throw new Error("KIS 인증 정보 없음");
  }

  const url = new URL(`${getBaseUrl()}${params.path}`);
  for (const [k, v] of Object.entries(params.query)) {
    url.searchParams.set(k, v);
  }

  const key = appkey as string;
  const secret = appsecret as string;

  async function call(token: string): Promise<Response> {
    return fetch(url.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        appkey: key,
        appsecret: secret,
        tr_id: params.trId,
        custtype: params.custType ?? "P",
        "content-type": "application/json; charset=utf-8",
      },
      cache: "no-store",
    });
  }

  await acquireKisSlot();
  try {
    let token = await getToken();
    let res = await call(token);
    if (res.status === 401 || res.status === 403) {
      token = await getToken(true);
      res = await call(token);
    }
    // EGW00201 (초당 거래건수 초과) — 1초 대기 후 1회 재시도. 보통 회복됨.
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 500 && /EGW00201|초당 거래건수/.test(text)) {
        await new Promise((r) => setTimeout(r, 1100));
        res = await call(token);
        if (res.ok) return (await res.json()) as T;
        const t2 = await res.text().catch(() => "");
        throw new Error(
          `KIS GET ${params.path} ${res.status} (retry 후): ${t2.slice(0, 200)}`
        );
      }
      throw new Error(`KIS GET ${params.path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    releaseKisSlot();
  }
}

// ────────────────────────────────────────────────────────────────────
// 파서 유틸
// ────────────────────────────────────────────────────────────────────

function n(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "").trim();
    if (cleaned === "" || cleaned === "-") return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

// "YYYYMMDD" → epoch ms (KST 자정)
function parseYyyymmdd(s: string | undefined | null): number | null {
  if (!s || s.length !== 8) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  // KIS 일자는 KST 기준. UTC로 박지 않고 그 날 00:00 KST → UTC 변환.
  return Date.UTC(y, m - 1, d) - 9 * 60 * 60 * 1000;
}

function todayYyyymmdd(): string {
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kst = new Date(now.getTime() + kstOffsetMs);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function daysAgoYyyymmdd(days: number): string {
  const now = new Date();
  const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const kst = new Date(past.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ────────────────────────────────────────────────────────────────────
// 국내 시세 — /uapi/domestic-stock/v1/quotations/inquire-price
// ────────────────────────────────────────────────────────────────────

interface KisDomesticPriceResponse {
  rt_cd?: string; // "0" = success
  msg1?: string;
  output?: {
    stck_prpr?: string; // 현재가
    prdy_vrss?: string; // 전일 대비
    prdy_vrss_sign?: string; // "1"~"5" — 1상한,2상승,3보합,4하한,5하락
    prdy_ctrt?: string; // 전일 대비율(%)
    stck_oprc?: string; // 시가
    stck_hgpr?: string; // 고가
    stck_lwpr?: string; // 저가
    stck_sdpr?: string; // 전일 종가
    acml_vol?: string; // 누적 거래량
    acml_tr_pbmn?: string; // 누적 거래대금
    hts_avls?: string; // 시가총액 (백만원)
    per?: string;
    pbr?: string;
    eps?: string;
    bps?: string;
  };
}

function applySign(value: number | null, sign: string | undefined): number | null {
  if (value == null) return null;
  const s = (sign ?? "").trim();
  // 4(하한), 5(하락) = 음수. 그 외(1,2,3)는 양수/보합 유지.
  if (s === "4" || s === "5") return -Math.abs(value);
  return Math.abs(value);
}

// 한국 종목 현재가 — Yahoo 코드(005930.KS) 받음. 실패 시 null.
export async function fetchKrQuote(code: string, name: string): Promise<Quote | null> {
  const six = toKisCode(code);
  if (!six) return null;
  if (!kisEnabled()) return null;

  try {
    const json = await kisGet<KisDomesticPriceResponse>({
      path: "/uapi/domestic-stock/v1/quotations/inquire-price",
      trId: "FHKST01010100",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: six,
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const o = json.output;
    if (!o) return null;

    const price = n(o.stck_prpr);
    if (price == null) return null;

    const prevClose = n(o.stck_sdpr) ?? price;
    const sign = o.prdy_vrss_sign;
    const changeAbs = applySign(n(o.prdy_vrss), sign) ?? price - prevClose;
    const rateRaw = applySign(n(o.prdy_ctrt), sign);
    const changeRate =
      rateRaw != null ? rateRaw / 100 : prevClose ? changeAbs / prevClose : 0;

    const marketCapMillionKrw = n(o.hts_avls);
    const marketCap =
      marketCapMillionKrw != null ? marketCapMillionKrw * 1_000_000 : null;

    return {
      code,
      name,
      price,
      prevClose,
      changeAbs,
      changeRate,
      volume: n(o.acml_vol),
      high: n(o.stck_hgpr),
      low: n(o.stck_lwpr),
      open: n(o.stck_oprc),
      marketCap,
      currency: "KRW",
      valuation: {
        per: n(o.per),
        pbr: n(o.pbr),
        eps: n(o.eps),
        bps: n(o.bps),
      },
      fetchedAt: Date.now(),
      // KIS inquire-price는 시장 상태를 직접 안 줘서 비워두고, 호출자(라우팅)에서
      // 네이버/Yahoo와 머지하거나 별도 판정에 맡긴다.
      marketState: undefined,
      priceTime: null,
      extendedHours: null,
    };
  } catch (e) {
    dbg("[quote] throw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 국내 일별 차트 — /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice
// ────────────────────────────────────────────────────────────────────

interface KisDomesticChartItem {
  stck_bsop_date?: string; // YYYYMMDD
  stck_clpr?: string;
  stck_oprc?: string;
  stck_hgpr?: string;
  stck_lwpr?: string;
  acml_vol?: string;
}

interface KisDomesticChartResponse {
  rt_cd?: string;
  output2?: KisDomesticChartItem[];
}

export async function fetchKrHistorical(
  code: string,
  days = 60
): Promise<HistoricalPoint[] | null> {
  const six = toKisCode(code);
  if (!six) return null;
  if (!kisEnabled()) return null;

  try {
    // 영업일 60개 ≒ 약 90 일력일. 안전 마진 1.6배.
    const lookbackDays = Math.max(Math.ceil(days * 1.6), 30);
    const json = await kisGet<KisDomesticChartResponse>({
      path: "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      trId: "FHKST03010100",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: six,
        FID_INPUT_DATE_1: daysAgoYyyymmdd(lookbackDays),
        FID_INPUT_DATE_2: todayYyyymmdd(),
        FID_PERIOD_DIV_CODE: "D",
        FID_ORG_ADJ_PRC: "0",
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const list = json.output2 ?? [];
    if (list.length === 0) return null;

    // KIS는 최신일이 앞에 옴. 오래된 → 최신 순으로 정렬.
    const points: HistoricalPoint[] = list
      .map((it) => {
        const close = n(it.stck_clpr);
        const date = parseYyyymmdd(it.stck_bsop_date);
        if (close == null || date == null) return null;
        return {
          date,
          open: n(it.stck_oprc) ?? close,
          high: n(it.stck_hgpr) ?? close,
          low: n(it.stck_lwpr) ?? close,
          close,
          volume: n(it.acml_vol) ?? 0,
        } satisfies HistoricalPoint;
      })
      .filter((p): p is HistoricalPoint => p != null)
      .sort((a, b) => a.date - b.date)
      .slice(-days);

    return points;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 국내 외인/기관/개인 수급 — /uapi/domestic-stock/v1/quotations/inquire-investor
// ────────────────────────────────────────────────────────────────────

interface KisInvestorItem {
  stck_bsop_date?: string;
  // KIS는 외국인 순매수 수량을 frgn_ntby_qty, 기관 합계를 orgn_ntby_qty,
  // 개인을 prsn_ntby_qty로 준다. 일부 응답에서는 *_tr_pbmn(거래대금) 키도 함께 옴.
  frgn_ntby_qty?: string;
  orgn_ntby_qty?: string;
  prsn_ntby_qty?: string;
  frgn_ntby_tr_pbmn?: string;
  orgn_ntby_tr_pbmn?: string;
  prsn_ntby_tr_pbmn?: string;
  stck_clpr?: string;
}

interface KisInvestorResponse {
  rt_cd?: string;
  msg_cd?: string;
  msg1?: string;
  output?: KisInvestorItem[];
}

// `[kis-flow] OK ...` 샘플은 한 번만(=처음 성공한 종목만) 찍어 노이즈 방지.
// lambda hot reuse 동안 유지, cold start 마다 재설정.
let kisFlowSampleLogged = false;

// kisGet throw 메시지(`KIS GET <path> <status>: <body>`) 에서 HTTP status 추출 시도.
// non-2xx 응답일 때만 kisGet 이 throw 하므로 catch 경로에서 사용.
function extractHttpStatus(message: string): number | null {
  const m = message.match(/\s(\d{3})(?:\s|:)/);
  if (!m) return null;
  const code = Number(m[1]);
  return Number.isFinite(code) ? code : null;
}

// 수량×종가 → 원화 환산.
// KIS inquire-investor 의 *_tr_pbmn 필드는 **백만원 단위**.
// 수량(*_ntby_qty, 주) × 종가(원/주) = 원이라 수량 경로가 가장 직관적.
// qty 우선, 없으면 tradeValue × 1,000,000 폴백.
function toKrwNet(
  qty: number | null,
  tradeValue: number | null,
  closePrice: number | null
): number | null {
  const px = closePrice ?? 0;
  if (qty != null && px > 0) return qty * px;
  if (tradeValue != null) return tradeValue * 1_000_000;
  return null;
}

export async function fetchKrFlow(code: string): Promise<FlowData | null> {
  const six = toKisCode(code);
  if (!six) {
    dbg("[flow] skip — toKisCode null", code);
    return null;
  }
  if (!kisEnabled()) {
    dbg("[flow] skip — kisEnabled false");
    return null;
  }

  try {
    dbg("[flow] call inquire-investor", six);
    // kisGet 은 2xx 응답일 때만 json 을 반환. non-2xx 는 throw → catch 경로로.
    const json = await kisGet<KisInvestorResponse>({
      path: "/uapi/domestic-stock/v1/quotations/inquire-investor",
      trId: "FHKST01010900",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: six,
      },
    });

    const rtCd = json.rt_cd;
    const msgCd = json.msg_cd;
    const msg1 = json.msg1;
    const list = json.output ?? [];
    const outputLength = list.length;

    // rt_cd != "0" — KIS 응답 자체가 거부. 권한·구독·tr_id·파라미터 문제 가능성.
    if (rtCd && rtCd !== "0") {
      console.warn(
        `[kis-flow] ${code} status=200 rt_cd=${rtCd} msg_cd=${msgCd ?? "?"} msg1=${msg1 ?? "?"} output_length=${outputLength}`
      );
      return null;
    }
    // 200 OK + rt_cd=0 인데 output 이 비었을 때 — tr_id/query 가 잘못됐을 가능성 시그널.
    if (outputLength === 0) {
      console.warn(
        `[kis-flow] ${code} status=200 rt_cd=${rtCd ?? "0"} msg_cd=${msgCd ?? "?"} msg1=${msg1 ?? "?"} output_length=0`
      );
      return null;
    }

    const today = list[0];
    const todayClose = n(today.stck_clpr);

    const foreignNet = toKrwNet(
      n(today.frgn_ntby_qty),
      n(today.frgn_ntby_tr_pbmn),
      todayClose
    );
    const institutionNet = toKrwNet(
      n(today.orgn_ntby_qty),
      n(today.orgn_ntby_tr_pbmn),
      todayClose
    );
    const individualNet = toKrwNet(
      n(today.prsn_ntby_qty),
      n(today.prsn_ntby_tr_pbmn),
      todayClose
    );

    // 5일 누적 — 각 거래일 종가 × 해당일 순매수 수량 (또는 거래대금)
    const days = Math.min(list.length, 5);
    let foreign5d = 0;
    let institution5d = 0;
    let individual5d = 0;
    let any5d = false;
    for (let i = 0; i < days; i++) {
      const it = list[i];
      const close = n(it.stck_clpr) ?? todayClose;
      const f = toKrwNet(n(it.frgn_ntby_qty), n(it.frgn_ntby_tr_pbmn), close);
      const o = toKrwNet(n(it.orgn_ntby_qty), n(it.orgn_ntby_tr_pbmn), close);
      const p = toKrwNet(n(it.prsn_ntby_qty), n(it.prsn_ntby_tr_pbmn), close);
      if (f != null) {
        foreign5d += f;
        any5d = true;
      }
      if (o != null) {
        institution5d += o;
        any5d = true;
      }
      if (p != null) {
        individual5d += p;
        any5d = true;
      }
    }

    // 성공 sample — lambda 인스턴스당 한 번만. 응답 구조 확인용.
    if (!kisFlowSampleLogged) {
      kisFlowSampleLogged = true;
      console.warn(
        `[kis-flow] OK ${code} bizdate=${today.stck_bsop_date ?? "?"} 외인순매수=${foreignNet ?? "null"} 기관순매수=${institutionNet ?? "null"} 개인순매수=${individualNet ?? "null"} output_length=${outputLength}`
      );
    }

    return {
      foreignNet,
      institutionNet,
      individualNet,
      foreignNet5d: any5d ? foreign5d : null,
      institutionNet5d: any5d ? institution5d : null,
      individualNet5d: any5d ? individual5d : null,
      source: "kis",
      fetchedAt: Date.now(),
    };
  } catch (e) {
    // non-2xx 응답·네트워크·파싱 에러 모두 여기로. message 에서 status 추출.
    const msg = e instanceof Error ? e.message : String(e);
    const httpStatus = extractHttpStatus(msg);
    console.warn(
      `[kis-flow] ${code} status=${httpStatus ?? "?"} rt_cd=? msg_cd=? msg1=? output_length=null err=${msg.slice(0, 200)}`
    );
    return null;
  }
}

// 백워드 호환 — 기존 provider/index.ts 가 fetchFlow 라는 이름으로 import 중.
export async function fetchFlow(code: string): Promise<FlowData> {
  const res = await fetchKrFlow(code);
  if (res) return res;
  return {
    foreignNet: null,
    institutionNet: null,
    individualNet: null,
    foreignNet5d: null,
    institutionNet5d: null,
    individualNet5d: null,
  };
}

// ────────────────────────────────────────────────────────────────────
// 해외 시세 — /uapi/overseas-price/v1/quotations/price
// ────────────────────────────────────────────────────────────────────

// 야후 티커 → KIS 해외거래소 코드. 알 수 없는 종목은 NASDAQ(NAS)으로 기본 가정.
// NYS=뉴욕, NAS=나스닥, AMS=아멕스, HKS=홍콩, TSE=도쿄, SHS=상해, SZS=심천 등.
const NYSE_TICKERS = new Set([
  "TSM",
  "V",
  "MA",
  "UNH",
  "XOM",
  "CVX",
  "ORCL",
  "HD",
  "WMT",
  "LLY",
  "BABA",
  "CRM",
  "NOW",
  "ADBE",
]);

const AMEX_TICKERS = new Set<string>([]);

function yahooToKisExchange(ticker: string): string | null {
  if (!/^[A-Z][A-Z0-9.\-]*$/.test(ticker)) return null;
  if (NYSE_TICKERS.has(ticker)) return "NYS";
  if (AMEX_TICKERS.has(ticker)) return "AMS";
  return "NAS";
}

interface KisOverseasPriceResponse {
  rt_cd?: string;
  output?: {
    last?: string; // 현재가
    base?: string; // 전일 종가
    pvol?: string; // 전일 거래량
    tvol?: string; // 당일 거래량
    tamt?: string; // 당일 거래대금
    diff?: string; // 전일 대비
    rate?: string; // 등락률 (%)
    sign?: string; // "1"~"5"
    open?: string;
    high?: string;
    low?: string;
    tomv?: string; // 시가총액
    curr?: string; // 통화
    // ── HHDFS76200200 (price-detail) 전용 추가 필드 ──────────────
    perx?: string; // PER
    pbrx?: string; // PBR
    epsx?: string; // EPS
    bpsx?: string; // BPS
    h52p?: string; // 52주 최고가
    l52p?: string; // 52주 최저가
  };
}

export async function fetchUsQuote(
  code: string,
  name: string
): Promise<Quote | null> {
  if (!kisEnabled()) return null;
  const exchange = yahooToKisExchange(code);
  if (!exchange) return null;

  try {
    // HHDFS00000300(price)는 last/base/diff/rate만 반환해 high/low/open 가 비어 카드 우측 컬럼이
    // 항상 "—" 로 표시되는 사고가 있었다. HHDFS76200200(price-detail)은 동일 응답 비용으로
    // open/high/low + PER/PBR/EPS/BPS + 시총까지 같이 주므로 이걸 1차로 사용한다.
    const json = await kisGet<KisOverseasPriceResponse>({
      path: "/uapi/overseas-price/v1/quotations/price-detail",
      trId: "HHDFS76200200",
      query: {
        AUTH: "",
        EXCD: exchange,
        SYMB: code,
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const o = json.output;
    if (!o) return null;

    const price = n(o.last);
    if (price == null || price === 0) return null;

    const prevClose = n(o.base) ?? price;
    const sign = o.sign;
    const changeAbs = applySign(n(o.diff), sign) ?? price - prevClose;
    const rateRaw = applySign(n(o.rate), sign);
    const changeRate =
      rateRaw != null ? rateRaw / 100 : prevClose ? changeAbs / prevClose : 0;

    const marketCap = n(o.tomv);

    return {
      code,
      name,
      price,
      prevClose,
      changeAbs,
      changeRate,
      // pvol=전일 거래량, tvol=당일 거래량 — 당일 기준이 맞다.
      volume: n(o.tvol),
      high: n(o.high),
      low: n(o.low),
      open: n(o.open),
      marketCap,
      currency: o.curr ?? "USD",
      valuation: {
        per: n(o.perx),
        pbr: n(o.pbrx),
        eps: n(o.epsx),
        bps: n(o.bpsx),
      },
      fetchedAt: Date.now(),
      marketState: "REGULAR",
      // KIS HHDFS76200200 도 ~100ms 안에 실시간 last 를 주므로 priceTime = fetch 시각.
      priceTime: Date.now(),
      extendedHours: null,
    };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 해외 일별 차트 — /uapi/overseas-price/v1/quotations/dailyprice
// ────────────────────────────────────────────────────────────────────

interface KisOverseasChartItem {
  xymd?: string; // YYYYMMDD
  clos?: string;
  open?: string;
  high?: string;
  low?: string;
  tvol?: string;
}

interface KisOverseasChartResponse {
  rt_cd?: string;
  output2?: KisOverseasChartItem[];
}

export async function fetchUsHistorical(
  code: string,
  days = 30
): Promise<HistoricalPoint[] | null> {
  if (!kisEnabled()) return null;
  const exchange = yahooToKisExchange(code);
  if (!exchange) return null;

  try {
    const json = await kisGet<KisOverseasChartResponse>({
      path: "/uapi/overseas-price/v1/quotations/dailyprice",
      trId: "HHDFS76240000",
      query: {
        AUTH: "",
        EXCD: exchange,
        SYMB: code,
        GUBN: "0", // 0=일, 1=주, 2=월
        BYMD: todayYyyymmdd(),
        MODP: "1", // 1=수정주가
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const list = json.output2 ?? [];
    if (list.length === 0) return null;

    const points: HistoricalPoint[] = list
      .map((it) => {
        const close = n(it.clos);
        const date = parseYyyymmdd(it.xymd);
        if (close == null || date == null) return null;
        return {
          date,
          open: n(it.open) ?? close,
          high: n(it.high) ?? close,
          low: n(it.low) ?? close,
          close,
          volume: n(it.tvol) ?? 0,
        } satisfies HistoricalPoint;
      })
      .filter((p): p is HistoricalPoint => p != null)
      .sort((a, b) => a.date - b.date)
      .slice(-days);

    return points;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 분봉 (1분) — /uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice
// TR_ID: FHKST03010200. 가장 최근 시각 기준 100건 반환 (1m × 100 ≒ 100분).
// 5m/15m 봉이 필요하면 라우트(/api/intraday-chart) 에서 aggregation.
// ────────────────────────────────────────────────────────────────────

interface KisIntradayCandle {
  stck_bsop_date?: string; // YYYYMMDD
  stck_cntg_hour?: string; // HHMMSS
  stck_prpr?: string;
  stck_oprc?: string;
  stck_hgpr?: string;
  stck_lwpr?: string;
  cntg_vol?: string;
  acml_tr_pbmn?: string;
}

interface KisIntradayResponse {
  rt_cd?: string;
  msg1?: string;
  output1?: Record<string, string | undefined>;
  output2?: KisIntradayCandle[];
}

// "YYYYMMDD" + "HHMMSS" (KST) → epoch ms
function parseYyyymmddHhmmss(
  date: string | undefined,
  time: string | undefined
): number | null {
  if (!date || date.length !== 8 || !time) return null;
  const padded = time.padStart(6, "0");
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  const hh = Number(padded.slice(0, 2));
  const mm = Number(padded.slice(2, 4));
  const ss = Number(padded.slice(4, 6));
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(ss)
  )
    return null;
  return Date.UTC(y, m - 1, d, hh - 9, mm, ss);
}

export async function fetchKrIntradayCandles(
  code: string,
  startHHMMSS = "153000"
): Promise<HistoricalPoint[] | null> {
  const six = toKisCode(code);
  if (!six) return null;
  if (!kisEnabled()) return null;

  try {
    const json = await kisGet<KisIntradayResponse>({
      path: "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
      trId: "FHKST03010200",
      query: {
        FID_ETC_CLS_CODE: "",
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: six,
        FID_INPUT_HOUR_1: startHHMMSS,
        FID_PW_DATA_INCU_YN: "Y",
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const list = json.output2 ?? [];
    if (list.length === 0) return null;

    const points: HistoricalPoint[] = [];
    for (const it of list) {
      const t = parseYyyymmddHhmmss(it.stck_bsop_date, it.stck_cntg_hour);
      const close = n(it.stck_prpr);
      if (t == null || close == null) continue;
      points.push({
        date: t,
        open: n(it.stck_oprc) ?? close,
        high: n(it.stck_hgpr) ?? close,
        low: n(it.stck_lwpr) ?? close,
        close,
        volume: n(it.cntg_vol) ?? 0,
      });
    }
    if (points.length === 0) return null;
    points.sort((a, b) => a.date - b.date);
    return points;
  } catch (e) {
    dbg("[intraday-chart] throw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 프로그램 매매 — /uapi/domestic-stock/v1/quotations/program-trade-by-stock
// TR_ID: FHPST04540000 (당일 누적, 종목별)
// 응답 키는 KIS 공식 명세: arbt_smtn_*, nabt_smtn_*, whol_smtn_*.
// ────────────────────────────────────────────────────────────────────

interface KisProgramTradeItem {
  arbt_smtn_seln_vol?: string;
  arbt_smtn_shnu_vol?: string;
  arbt_smtn_ntby_qty?: string;
  arbt_smtn_seln_tr_pbmn?: string;
  arbt_smtn_shnu_tr_pbmn?: string;
  arbt_smtn_ntby_tr_pbmn?: string;
  nabt_smtn_seln_vol?: string;
  nabt_smtn_shnu_vol?: string;
  nabt_smtn_ntby_qty?: string;
  nabt_smtn_seln_tr_pbmn?: string;
  nabt_smtn_shnu_tr_pbmn?: string;
  nabt_smtn_ntby_tr_pbmn?: string;
  whol_smtn_seln_vol?: string;
  whol_smtn_shnu_vol?: string;
  whol_smtn_ntby_qty?: string;
  whol_smtn_seln_tr_pbmn?: string;
  whol_smtn_shnu_tr_pbmn?: string;
  whol_smtn_ntby_tr_pbmn?: string;
  stck_cntg_hour?: string;
  stck_prpr?: string;
}

interface KisProgramTradeResponse {
  rt_cd?: string;
  msg1?: string;
  output?: KisProgramTradeItem[] | KisProgramTradeItem;
}

// KIS 거래대금(*_tr_pbmn) 은 일관되게 **백만원 단위**.
// 수량 × 현재가가 가장 직관적이므로 그 경로 우선, 거래대금은 ×1,000,000 폴백.
function programNet(
  qty: number | null,
  tradeValue: number | null,
  price: number | null
): number | null {
  const px = price ?? 0;
  if (qty != null && px > 0) return qty * px;
  if (tradeValue != null) return tradeValue * 1_000_000;
  return null;
}

export async function fetchKrProgramTrade(
  code: string
): Promise<ProgramTradeData | null> {
  const six = toKisCode(code);
  if (!six) return null;
  if (!kisEnabled()) return null;

  try {
    const json = await kisGet<KisProgramTradeResponse>({
      path: "/uapi/domestic-stock/v1/quotations/program-trade-by-stock",
      trId: "FHPST04540000",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: six,
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const raw = Array.isArray(json.output) ? json.output[0] : json.output;
    if (!raw) return null;

    const price = n(raw.stck_prpr);

    const arbBuy = programNet(
      n(raw.arbt_smtn_shnu_vol),
      n(raw.arbt_smtn_shnu_tr_pbmn),
      price
    );
    const arbSell = programNet(
      n(raw.arbt_smtn_seln_vol),
      n(raw.arbt_smtn_seln_tr_pbmn),
      price
    );
    const arbNet = programNet(
      n(raw.arbt_smtn_ntby_qty),
      n(raw.arbt_smtn_ntby_tr_pbmn),
      price
    );

    const nabBuy = programNet(
      n(raw.nabt_smtn_shnu_vol),
      n(raw.nabt_smtn_shnu_tr_pbmn),
      price
    );
    const nabSell = programNet(
      n(raw.nabt_smtn_seln_vol),
      n(raw.nabt_smtn_seln_tr_pbmn),
      price
    );
    const nabNet = programNet(
      n(raw.nabt_smtn_ntby_qty),
      n(raw.nabt_smtn_ntby_tr_pbmn),
      price
    );

    const totalNet =
      programNet(
        n(raw.whol_smtn_ntby_qty),
        n(raw.whol_smtn_ntby_tr_pbmn),
        price
      ) ??
      (arbNet != null && nabNet != null ? arbNet + nabNet : (arbNet ?? nabNet));

    if (
      arbBuy == null &&
      arbSell == null &&
      arbNet == null &&
      nabBuy == null &&
      nabSell == null &&
      nabNet == null &&
      totalNet == null
    ) {
      return null;
    }

    return {
      arbitrageBuy: arbBuy,
      arbitrageSell: arbSell,
      arbitrageNet: arbNet,
      nonArbitrageBuy: nabBuy,
      nonArbitrageSell: nabSell,
      nonArbitrageNet: nabNet,
      totalNet,
      fetchedAt: Date.now(),
    };
  } catch (e) {
    dbg("[program] throw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 10단계 호가 + 체결강도 — /uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn
// TR_ID: FHKST01010200
// ────────────────────────────────────────────────────────────────────

type KisAskingOutput1 = Record<string, string | undefined>;
type KisAskingOutput2 = Record<string, string | undefined>;

interface KisAskingResponse {
  rt_cd?: string;
  msg1?: string;
  output1?: KisAskingOutput1;
  output2?: KisAskingOutput2;
}

export async function fetchKrAskingPrice(
  code: string
): Promise<AskingPriceData | null> {
  const six = toKisCode(code);
  if (!six) return null;
  if (!kisEnabled()) return null;

  try {
    const json = await kisGet<KisAskingResponse>({
      path: "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
      trId: "FHKST01010200",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: six,
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const o1 = json.output1;
    if (!o1) return null;

    const levels: AskingPriceLevel[] = [];
    for (let i = 1; i <= 10; i++) {
      const askPrice = n(o1[`askp${i}`]);
      const askQty = n(o1[`askp_rsqn${i}`]);
      const bidPrice = n(o1[`bidp${i}`]);
      const bidQty = n(o1[`bidp_rsqn${i}`]);
      if (askPrice == null && bidPrice == null) continue;
      levels.push({
        askPrice: askPrice ?? 0,
        askQty: askQty ?? 0,
        bidPrice: bidPrice ?? 0,
        bidQty: bidQty ?? 0,
      });
    }
    if (levels.length === 0) return null;

    const totalAskQty =
      n(o1.total_askp_rsqn) ??
      levels.reduce((acc, l) => acc + (l.askQty || 0), 0);
    const totalBidQty =
      n(o1.total_bidp_rsqn) ??
      levels.reduce((acc, l) => acc + (l.bidQty || 0), 0);

    // 체결강도 — KIS 일부 응답에 tday_rltv(체결강도)가 있고, 없으면 잔량 비율 폴백.
    let ccldStrength: number | null = null;
    const o2 = json.output2;
    if (o2) {
      const cttr = n(o2.tday_rltv);
      if (cttr != null) ccldStrength = cttr;
    }
    if (ccldStrength == null) {
      ccldStrength = totalAskQty > 0 ? (totalBidQty / totalAskQty) * 100 : null;
    }

    const expectedPrice = o2 ? n(o2.antc_cnpr) : null;
    const expectedVolume = o2 ? n(o2.antc_vol) : null;

    return {
      levels,
      totalAskQty,
      totalBidQty,
      ccldStrength,
      expectedPrice,
      expectedVolume,
      fetchedAt: Date.now(),
    };
  } catch (e) {
    dbg("[asking] throw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 국내 지수 — /uapi/domestic-stock/v1/quotations/inquire-index-price
// TR_ID: FHPUP02100000 (KOSPI=0001, KOSDAQ=1001, KOSPI200=2001 등)
// ────────────────────────────────────────────────────────────────────

interface KisIndexResponse {
  rt_cd?: string;
  msg1?: string;
  output?: {
    bstp_nmix_prpr?: string;
    bstp_nmix_prdy_vrss?: string;
    prdy_vrss_sign?: string;
    bstp_nmix_prdy_ctrt?: string;
    acml_vol?: string;
    acml_tr_pbmn?: string;
    bstp_nmix_oprc?: string;
    bstp_nmix_hgpr?: string;
    bstp_nmix_lwpr?: string;
  };
}

// 야후 지수 코드(^KS11, ^KQ11) → KIS 지수 코드(0001, 1001).
export function yahooIndexToKisCode(code: string): string | null {
  if (code === "^KS11") return "0001";
  if (code === "^KQ11") return "1001";
  if (code === "^KS200") return "2001";
  return null;
}

export async function fetchKrIndex(
  yahooCode: string,
  name: string
): Promise<IndexQuote | null> {
  if (!kisEnabled()) return null;
  const kisCode = yahooIndexToKisCode(yahooCode);
  if (!kisCode) return null;

  try {
    const json = await kisGet<KisIndexResponse>({
      path: "/uapi/domestic-stock/v1/quotations/inquire-index-price",
      trId: "FHPUP02100000",
      query: {
        FID_COND_MRKT_DIV_CODE: "U",
        FID_INPUT_ISCD: kisCode,
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const o = json.output;
    if (!o) return null;

    const value = n(o.bstp_nmix_prpr);
    if (value == null) return null;
    const sign = o.prdy_vrss_sign;
    const changeAbs = applySign(n(o.bstp_nmix_prdy_vrss), sign) ?? 0;
    const rateRaw = applySign(n(o.bstp_nmix_prdy_ctrt), sign);
    const changeRate = rateRaw != null ? rateRaw / 100 : 0;

    return {
      code: kisCode,
      name,
      value,
      changeAbs,
      changeRate,
      volume: n(o.acml_vol),
      source: "kis",
      fetchedAt: Date.now(),
    };
  } catch (e) {
    dbg("[index] throw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 시장 순위 — 등락률 / 거래량
// 등락률: /uapi/domestic-stock/v1/ranking/fluctuation (FHPST01700000)
// 거래량: /uapi/domestic-stock/v1/ranking/volume-rank (FHPST01710000)
// ────────────────────────────────────────────────────────────────────

interface KisRankingItem {
  data_rank?: string;
  hts_kor_isnm?: string;
  // 거래량 랭킹은 mksc_shrn_iscd, 등락률(fluctuation)은 stck_shrn_iscd 로 키가 다르다.
  mksc_shrn_iscd?: string;
  stck_shrn_iscd?: string;
  stck_prpr?: string;
  prdy_vrss?: string;
  prdy_vrss_sign?: string;
  prdy_ctrt?: string;
  acml_vol?: string;
}

interface KisRankingResponse {
  rt_cd?: string;
  msg1?: string;
  output?: KisRankingItem[];
}

// "all"→"0000", "kospi"→"0001", "kosdaq"→"1001"
function marketToKisCode(market: MarketLeadersMarket): string {
  if (market === "kospi") return "0001";
  if (market === "kosdaq") return "1001";
  return "0000";
}

export async function fetchKrMarketLeaders(
  kind: MarketLeadersKind,
  market: MarketLeadersMarket = "all",
  count = 20
): Promise<MarketLeadersData | null> {
  if (!kisEnabled()) return null;
  const isVolume = kind === "volume";
  // KIS 공식 endpoint — 거래량은 /quotations/volume-rank, 등락률은 /ranking/fluctuation.
  // (이전엔 거래량 path를 /ranking/volume-rank 로 잘못 적어 404 → UI에 빈 카드만 노출됐음.)
  const apiPath = isVolume
    ? "/uapi/domestic-stock/v1/quotations/volume-rank"
    : "/uapi/domestic-stock/v1/ranking/fluctuation";
  const trId = isVolume ? "FHPST01710000" : "FHPST01700000";
  const mktCode = marketToKisCode(market);

  const query: Record<string, string> = isVolume
    ? {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_COND_SCR_DIV_CODE: "20171",
        FID_INPUT_ISCD: mktCode,
        FID_DIV_CLS_CODE: "0",
        FID_BLNG_CLS_CODE: "0",
        FID_TRGT_CLS_CODE: "111111111",
        FID_TRGT_EXLS_CLS_CODE: "0000000000",
        FID_INPUT_PRICE_1: "0",
        FID_INPUT_PRICE_2: "0",
        FID_VOL_CNT: "0",
        FID_INPUT_DATE_1: "0",
      }
    : {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_COND_SCR_DIV_CODE: "20170",
        FID_INPUT_ISCD: mktCode,
        FID_RANK_SORT_CLS_CODE: kind === "rising" ? "0" : "1",
        FID_INPUT_CNT_1: "0",
        // 보통주만(="1") 보냄. "0"(전체)으로 보내면 우선주가 섞여 들어올 뿐 아니라,
        // KIS 내부 정렬이 망가져서 +/- 가 뒤섞인 30건이 옴. "1"로 보내면 정상 등락률 내림순.
        FID_PRC_CLS_CODE: "1",
        FID_INPUT_PRICE_1: "",
        FID_INPUT_PRICE_2: "",
        FID_VOL_CNT: "",
        FID_TRGT_CLS_CODE: "0",
        FID_TRGT_EXLS_CLS_CODE: "0",
        FID_DIV_CLS_CODE: "1",
        FID_RSFL_RATE1: "",
        FID_RSFL_RATE2: "",
      };

  try {
    const json = await kisGet<KisRankingResponse>({
      path: apiPath,
      trId,
      query,
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const list = json.output ?? [];
    if (list.length === 0) return null;

    // 1) 응답 row 를 정규화 (부호 적용 · 우선주 가드).
    const all: MarketLeader[] = [];
    for (const it of list) {
      const code = (it.mksc_shrn_iscd ?? it.stck_shrn_iscd ?? "").trim();
      const name = (it.hts_kor_isnm ?? "").trim();
      const price = n(it.stck_prpr);
      if (!code || !name || price == null) continue;
      // 우선주/관리종목 안전망 — KIS 필터가 새 종목을 빠뜨리는 경우 마지막 가드.
      // 종목명 suffix("우", "1우", "2우B" 등) 패턴은 가장 신뢰도 높음.
      if (/(?:d?우[A-Z]?|우선)$/u.test(name)) continue;
      const sign = it.prdy_vrss_sign;
      const changeAbs = applySign(n(it.prdy_vrss), sign) ?? 0;
      const rateRaw = applySign(n(it.prdy_ctrt), sign);
      all.push({
        rank: n(it.data_rank) ?? all.length + 1,
        code,
        name,
        price,
        changeAbs,
        changeRate: rateRaw != null ? rateRaw / 100 : 0,
        volume: n(it.acml_vol),
      });
    }

    // 2) 클라이언트 정렬·필터 — KIS 응답 정렬을 그대로 믿지 않고 우리 의도대로 재정렬.
    //    rising  : 상승률 큰 순 (양수만)
    //    falling : 하락률 큰 순 (음수만, 가장 작은(가장 큰 하락) 순)
    //    volume  : 거래량 큰 순 — KIS 응답 그대로지만 안전하게 재정렬
    let sorted: MarketLeader[];
    if (kind === "rising") {
      sorted = all
        .filter((x) => x.changeRate > 0)
        .sort((a, b) => b.changeRate - a.changeRate);
    } else if (kind === "falling") {
      sorted = all
        .filter((x) => x.changeRate < 0)
        .sort((a, b) => a.changeRate - b.changeRate);
    } else {
      sorted = all.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    }

    // 3) rank 재부여 + top N.
    const items = sorted.slice(0, count).map((it, i) => ({ ...it, rank: i + 1 }));
    if (items.length === 0) return null;

    return {
      kind,
      market,
      items,
      fetchedAt: Date.now(),
    };
  } catch (e) {
    dbg("[leaders] throw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 실시간 체결 내역 — /uapi/domestic-stock/v1/quotations/inquire-ccnl
// TR_ID: FHKST01010300 (최근 체결 30건)
// ────────────────────────────────────────────────────────────────────

interface KisCcnlItem {
  stck_cntg_hour?: string;
  stck_prpr?: string;
  prdy_vrss?: string;
  prdy_vrss_sign?: string;
  prdy_ctrt?: string;
  cntg_vol?: string;
  tday_rltv?: string;
}

interface KisCcnlResponse {
  rt_cd?: string;
  msg1?: string;
  output?: KisCcnlItem[];
}

// "HHMMSS" → epoch ms (오늘 KST 기준).
function parseKisHHMMSS(s: string | undefined): number | null {
  if (!s || s.length < 4) return null;
  const padded = s.padStart(6, "0");
  const hh = Number(padded.slice(0, 2));
  const mm = Number(padded.slice(2, 4));
  const ss = Number(padded.slice(4, 6));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss))
    return null;
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  return Date.UTC(y, m, d, hh - 9, mm, ss);
}

export async function fetchKrExecutions(
  code: string,
  limit = 30
): Promise<ExecutionTick[] | null> {
  const six = toKisCode(code);
  if (!six) return null;
  if (!kisEnabled()) return null;

  try {
    const json = await kisGet<KisCcnlResponse>({
      path: "/uapi/domestic-stock/v1/quotations/inquire-ccnl",
      trId: "FHKST01010300",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: six,
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;
    const list = json.output ?? [];
    if (list.length === 0) return null;

    const ticks: ExecutionTick[] = [];
    for (const it of list.slice(0, limit)) {
      const time = parseKisHHMMSS(it.stck_cntg_hour) ?? Date.now();
      const price = n(it.stck_prpr);
      if (price == null) continue;
      const sign = it.prdy_vrss_sign;
      const changeAbs = applySign(n(it.prdy_vrss), sign);
      const rateRaw = applySign(n(it.prdy_ctrt), sign);
      ticks.push({
        time,
        price,
        volume: n(it.cntg_vol) ?? 0,
        // KIS inquire-ccnl 은 매수/매도 체결 구분이 명시적이지 않다.
        // sign 으로만 추정: 상승(1,2)→매수, 하락(4,5)→매도, 보합(3)→neutral.
        side:
          sign === "1" || sign === "2"
            ? "buy"
            : sign === "4" || sign === "5"
              ? "sell"
              : "neutral",
        changeAbs,
        changeRate: rateRaw != null ? rateRaw / 100 : null,
      });
    }
    if (ticks.length === 0) return null;
    return ticks;
  } catch (e) {
    dbg("[ccnl] throw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 공매도 잔고 — /uapi/domestic-stock/v1/quotations/inquire-short-stock-quantity
// TR_ID: FHPST04830000 (KRX 공매도 잔고 일별 추이).
// ────────────────────────────────────────────────────────────────────

interface KisShortItem {
  stck_bsop_date?: string;
  ssts_cntg_qty?: string;
  ssts_cntg_tr_pbmn?: string;
  ssts_cntg_qty_rate?: string;
  ssts_rsqn?: string;
  ssts_tr_pbmn?: string;
  ssts_qty_rate?: string;
}

interface KisShortResponse {
  rt_cd?: string;
  msg1?: string;
  output1?: KisShortItem | KisShortItem[];
  output2?: KisShortItem[];
}

export async function fetchKrShortBalance(
  code: string
): Promise<ShortBalanceData | null> {
  const six = toKisCode(code);
  if (!six) return null;
  if (!kisEnabled()) return null;

  try {
    const json = await kisGet<KisShortResponse>({
      path: "/uapi/domestic-stock/v1/quotations/inquire-short-stock-quantity",
      trId: "FHPST04830000",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: six,
        FID_INPUT_DATE_1: daysAgoYyyymmdd(14),
        FID_INPUT_DATE_2: todayYyyymmdd(),
        FID_PERIOD_DIV_CODE: "D",
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") return null;

    const list: KisShortItem[] =
      json.output2 && json.output2.length > 0
        ? json.output2
        : Array.isArray(json.output1)
          ? json.output1
          : json.output1
            ? [json.output1]
            : [];
    if (list.length === 0) return null;

    const latest = list[0];
    const qty = n(latest.ssts_cntg_qty) ?? n(latest.ssts_rsqn);
    const amount = n(latest.ssts_cntg_tr_pbmn) ?? n(latest.ssts_tr_pbmn);
    const ratioRaw =
      n(latest.ssts_cntg_qty_rate) ?? n(latest.ssts_qty_rate);
    const ratio = ratioRaw != null ? ratioRaw / 100 : null;
    const asOf = parseYyyymmdd(latest.stck_bsop_date);

    if (qty == null && amount == null && ratio == null) return null;

    return {
      ratio,
      qty,
      amount,
      asOf,
      fetchedAt: Date.now(),
    };
  } catch (e) {
    dbg("[short] throw:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
