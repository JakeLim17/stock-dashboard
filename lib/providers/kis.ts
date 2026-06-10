import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FlowData, Quote } from "../types";
import { toKisCode } from "../symbols";
import type { HistoricalPoint } from "./yahoo";

// 한국투자증권(KIS) Open API provider.
// - 토큰: 메모리 캐싱 + 만료 5분 전 자동 갱신, 동시 호출 시 단일 in-flight 공유.
// - 엔드포인트(7): 토큰 / 국내시세 / 국내일별 / 국내수급 / 해외시세 / 해외일별
// - 응답 키는 KIS 공식 명세(stck_prpr 등)를 그대로 따른다.

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

let cachedToken: TokenCache | null = null;
let inflightTokenPromise: Promise<string> | null = null;
// 토큰 발급 1분당 1회(EGW00133) lockout 회피용 cooldown.
// 발급 실패 시 60초간 추가 요청을 즉시 throw → 같은 시간 내 호출자는 빠르게 fallback 가도록.
let tokenCooldownUntil = 0;
let diskCacheLoaded = false;

// node_modules/.cache 하위에 토큰 1개만 저장 — git ignore 자동 + dev 재시작/Turbopack
// 모듈 reload 후에도 동일 키면 그대로 재사용 (KIS 토큰은 24h 유효).
function tokenCachePath(): string {
  return path.join(process.cwd(), "node_modules", ".cache", "kis-token.json");
}

function keyFingerprint(): string {
  const k = getAppKey() ?? "";
  // 앞 8자만 fingerprint로 — 키가 같은 환경인지 확인용 (전체 키는 디스크 평문 저장 안 함을 흉내)
  return `${k.slice(0, 8)}:${k.length}`;
}

async function loadTokenFromDisk(): Promise<void> {
  if (diskCacheLoaded) return;
  diskCacheLoaded = true;
  try {
    const raw = await fs.readFile(tokenCachePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<TokenCache>;
    if (
      parsed?.token &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > Date.now() &&
      parsed.keyFingerprint === keyFingerprint()
    ) {
      cachedToken = {
        token: parsed.token,
        expiresAt: parsed.expiresAt,
        keyFingerprint: parsed.keyFingerprint,
      };
    }
  } catch {
    // 파일 없음/파싱 실패 — 무시
  }
}

async function saveTokenToDisk(tc: TokenCache): Promise<void> {
  try {
    const dir = path.dirname(tokenCachePath());
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${tokenCachePath()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tc), "utf8");
    await fs.rename(tmp, tokenCachePath());
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

async function requestNewToken(): Promise<string> {
  const appkey = getAppKey();
  const appsecret = getAppSecret();
  if (!appkey || !appsecret) {
    throw new Error("KIS_APP_KEY / KIS_APP_SECRET 가 설정되지 않음");
  }

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
    // EGW00133 = 1분당 1회 제한. 60초 cooldown 걸어서 추가 호출 차단.
    if (res.status === 403 && /EGW00133|1분당 1회/.test(text)) {
      tokenCooldownUntil = Date.now() + 60_000;
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
  // 비동기 디스크 저장 — 실패해도 무시
  void saveTokenToDisk(tc);
  return json.access_token;
}

async function getToken(forceRefresh = false): Promise<string> {
  await loadTokenFromDisk();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  // 1분당 1회 lockout — 토큰 새로 못 받으므로 즉시 throw
  if (tokenCooldownUntil > Date.now()) {
    const sec = Math.ceil((tokenCooldownUntil - Date.now()) / 1000);
    throw new Error(`KIS 토큰 cooldown 중 (${sec}초 남음) — naver/yahoo로 fallback`);
  }
  if (inflightTokenPromise) return inflightTokenPromise;

  inflightTokenPromise = requestNewToken().finally(() => {
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
  output?: KisInvestorItem[];
}

// 수량×종가 → 원화 환산. 거래대금이 응답에 있으면 그걸 우선 사용.
function toKrwNet(
  qty: number | null,
  tradeValue: number | null,
  closePrice: number | null
): number | null {
  if (tradeValue != null) return tradeValue;
  if (qty == null) return null;
  const px = closePrice ?? 0;
  if (px <= 0) return null;
  return qty * px;
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
    const json = await kisGet<KisInvestorResponse>({
      path: "/uapi/domestic-stock/v1/quotations/inquire-investor",
      trId: "FHKST01010900",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: six,
      },
    });

    if (json.rt_cd && json.rt_cd !== "0") {
      dbg("[flow] rt_cd !=0", json.rt_cd, "msg=", (json as { msg1?: string }).msg1);
      return null;
    }
    const list = json.output ?? [];
    if (list.length === 0) {
      dbg("[flow] empty output");
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
    dbg("[flow] throw:", e instanceof Error ? e.message : String(e));
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
    pvol?: string; // 거래량
    diff?: string; // 전일 대비
    rate?: string; // 등락률 (%)
    sign?: string; // "1"~"5"
    open?: string;
    high?: string;
    low?: string;
    tomv?: string; // 시가총액
    curr?: string; // 통화
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
    const json = await kisGet<KisOverseasPriceResponse>({
      path: "/uapi/overseas-price/v1/quotations/price",
      trId: "HHDFS00000300",
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
      volume: n(o.pvol),
      high: n(o.high),
      low: n(o.low),
      open: n(o.open),
      marketCap,
      currency: o.curr ?? "USD",
      valuation: null,
      fetchedAt: Date.now(),
      marketState: undefined,
      priceTime: null,
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
