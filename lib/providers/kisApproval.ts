import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

// KIS WebSocket 접속용 approval_key 발급/캐시 모듈.
//
// 동작:
//   POST {KIS_BASE_URL}/oauth2/Approval
//   body: { grant_type: "client_credentials", appkey, secretkey }
//   → { approval_key }
//
// 캐시:
//   1) Vercel KV (cross-instance) ← `lib/providers/kis.ts` 와 동일 패턴
//   2) /tmp/kis-approval.json (인스턴스 hot reuse)
//   3) 메모리 (cachedApproval)
//
// 발급 빈도:
//   KIS WebSocket approval_key 는 발급 후 24h 유효. 카톡 알림 정책은 토큰(REST) 과
//   별개이지만 보수적으로 24h KV TTL 사용 + 발급 실패 시 60초 cooldown.
//
// ⚠ 이 모듈은 `lib/providers/kis.ts` 의 REST 토큰 발급 로직과 **완전히 별개**.
//   두 캐시가 서로 영향 주지 않도록 KV key prefix 도 따로 둔다.

// ────────────────────────────────────────────────────────────────────
// 기본 설정
// ────────────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  return (
    process.env.KIS_BASE_URL ??
    "https://openapivts.koreainvestment.com:29443"
  );
}

function getAppKey(): string | null {
  return process.env.KIS_APP_KEY ?? null;
}

function getAppSecret(): string | null {
  return process.env.KIS_APP_SECRET ?? null;
}

export function kisApprovalEnabled(): boolean {
  return !!(getAppKey() && getAppSecret());
}

function dbg(...args: unknown[]): void {
  if (process.env.DEBUG_KIS === "1" || process.env.DEBUG_KIS === "true") {
    console.log("[kis-ws]", ...args);
  }
}

// ────────────────────────────────────────────────────────────────────
// 캐시 상태
// ────────────────────────────────────────────────────────────────────

interface ApprovalCache {
  approvalKey: string;
  expiresAt: number; // epoch ms (24h - 1h 안전 마진)
  keyFingerprint: string;
}

let cachedApproval: ApprovalCache | null = null;
let inflightPromise: Promise<string | null> | null = null;
let cooldownUntil = 0;
let lastStoreCheckAt = 0;
const STORE_RECHECK_INTERVAL_MS = 30_000;

const KV_APPROVAL_KEY_NAME = "kis:approval_key:v1";

// ────────────────────────────────────────────────────────────────────
// KV / 디스크 헬퍼 — `lib/providers/kis.ts` 와 동일 시그니처. 코드 중복은 의도적.
//   (kis.ts 가 server-only · 별도 토큰 캐시 라이프사이클을 가져 import 분리 유지)
// ────────────────────────────────────────────────────────────────────

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

function approvalDiskPath(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return "/tmp/kis-approval.json";
  }
  return path.join(process.cwd(), ".cache", "kis-approval.json");
}

function keyFingerprint(): string {
  const k = getAppKey() ?? "";
  return `${k.slice(0, 8)}:${k.length}`;
}

function isValidStoredApproval(
  parsed: Partial<ApprovalCache> | null | undefined
): parsed is ApprovalCache {
  return !!(
    parsed?.approvalKey &&
    typeof parsed.expiresAt === "number" &&
    parsed.expiresAt > Date.now() &&
    parsed.keyFingerprint === keyFingerprint()
  );
}

async function loadFromStore(): Promise<void> {
  if (cachedApproval && cachedApproval.expiresAt > Date.now()) return;
  if (lastStoreCheckAt > 0 && Date.now() - lastStoreCheckAt < STORE_RECHECK_INTERVAL_MS) return;
  lastStoreCheckAt = Date.now();

  if (isKvConfigured()) {
    try {
      const raw = await kvGet(KV_APPROVAL_KEY_NAME);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ApprovalCache>;
        if (isValidStoredApproval(parsed)) {
          cachedApproval = parsed;
          dbg("[approval] loaded from KV (cross-instance), expires in",
            Math.round((parsed.expiresAt - Date.now()) / 1000), "s");
          return;
        }
      }
    } catch {
      // KV 실패 — 파일 폴백
    }
  }

  try {
    const raw = await fs.readFile(approvalDiskPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ApprovalCache>;
    if (isValidStoredApproval(parsed)) {
      cachedApproval = parsed;
      dbg("[approval] loaded from disk", approvalDiskPath());
    }
  } catch {
    // 파일 없음/파싱 실패 — 무시 (메모리 캐시만으로 동작)
  }
}

async function saveToStore(c: ApprovalCache): Promise<void> {
  const json = JSON.stringify(c);
  const ttlSec = Math.max(
    60,
    Math.min(86_400, Math.floor((c.expiresAt - Date.now()) / 1000))
  );

  if (isKvConfigured()) {
    const ok = await kvSet(KV_APPROVAL_KEY_NAME, json, ttlSec);
    if (ok) dbg("[approval] saved to KV, ttl=", ttlSec, "s");
  }

  try {
    const filePath = approvalDiskPath();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, json, "utf8");
    await fs.rename(tmp, filePath);
  } catch {
    // 쓰기 실패는 치명적이지 않음 — 메모리 캐시로 동작 가능
  }
}

// ────────────────────────────────────────────────────────────────────
// 신규 발급
// ────────────────────────────────────────────────────────────────────

interface ApprovalResponse {
  approval_key?: string;
}

async function requestNewApproval(reason: string): Promise<string | null> {
  const appkey = getAppKey();
  const appsecret = getAppSecret();
  if (!appkey || !appsecret) return null;

  // 빈도 추적용 로그 — 디버그 플래그 무관하게 항상 1줄.
  console.warn(
    `[kis-ws] requesting new approval_key (reason=${reason}, fingerprint=${keyFingerprint()}, kvConfigured=${isKvConfigured()})`
  );

  try {
    const res = await fetch(`${getBaseUrl()}/oauth2/Approval`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey,
        // ⚠ REST 토큰은 `appsecret` 키, WebSocket approval 은 `secretkey` 키 — KIS API 규격.
        secretkey: appsecret,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 60초 cooldown — 발급 실패가 잦으면 폴링이 폭주하지 않도록 제한.
      cooldownUntil = Date.now() + 60_000;
      console.warn(
        `[kis-ws] approval_key 발급 실패 (${res.status}): ${text.slice(0, 200)}`
      );
      return null;
    }

    const json = (await res.json()) as ApprovalResponse;
    if (!json.approval_key) {
      cooldownUntil = Date.now() + 60_000;
      return null;
    }

    // KIS approval_key 는 발급 후 24h 유효. 1h 안전 마진.
    const expiresAt = Date.now() + 23 * 60 * 60 * 1000;
    const c: ApprovalCache = {
      approvalKey: json.approval_key,
      expiresAt,
      keyFingerprint: keyFingerprint(),
    };
    cachedApproval = c;
    void saveToStore(c);
    return json.approval_key;
  } catch (e) {
    cooldownUntil = Date.now() + 60_000;
    console.warn(
      `[kis-ws] approval_key 발급 throw: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 외부 API
// ────────────────────────────────────────────────────────────────────

// 캐시된 approval_key 반환. 없으면 KV/디스크 로드 → 그래도 없으면 신규 발급.
// 발급 실패/cooldown 중이면 null (호출자는 SSE 503 등으로 폴백 결정).
export async function getApprovalKey(): Promise<string | null> {
  if (!getAppKey() || !getAppSecret()) return null;
  await loadFromStore();
  if (cachedApproval && cachedApproval.expiresAt > Date.now()) {
    return cachedApproval.approvalKey;
  }
  if (cooldownUntil > Date.now()) return null;
  if (inflightPromise) return inflightPromise;

  const reason = cachedApproval ? "cache-expired" : "no-cache (cold start)";
  inflightPromise = requestNewApproval(reason).finally(() => {
    inflightPromise = null;
  });
  return inflightPromise;
}
