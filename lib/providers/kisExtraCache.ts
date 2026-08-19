import "server-only";
import type {
  FlowData,
  IndexQuote,
  MarketLeadersData,
  MarketLeadersKind,
  MarketLeadersMarket,
  ProgramTradeData,
  Quote,
  ShortBalanceData,
  AskingPriceData,
} from "../types";
import {
  fetchKrFlow,
  fetchKrIndex,
  fetchKrIntradayCandles,
  fetchKrMarketLeaders,
  fetchKrProgramTrade,
  fetchKrQuote,
  fetchKrShortBalance,
  fetchUsQuote,
  fetchKrAskingPrice,
  kisKvConfigured,
  kisKvGet,
  kisKvSet,
} from "./kis";
import type { HistoricalPoint } from "./yahoo";
import {
  QUOTE_STALE_WHILE_REVALIDATE_MS,
  askingTtlMs,
  flowTtlMs,
  pickTtl,
  quoteTtlMs,
  type QuoteMarket,
} from "./kisCachePolicy";
import { isKrRegularSession } from "../analyzer/tradingSession";

// KIS 응답 메모리 캐시 + in-flight 디듀프 + (수급) KV cross-instance.
// - 시세: 세션별 TTL (장중 20s / 장후 5분) + SWR
// - 수급: 장중 1h / 장후·휴장 24h + KV (Vercel cold start 에도 재호출 안 함)
// - 호가: 장중 10분 / 장후 24h
// - 프로그램 매매: 60s / 공매도: 5분 / 시장 순위: 30s / 분봉: 세션별
//
// 패턴은 consensusCache 와 동일. global symbol로 hot-reload 캐시 유실 방지.

const PROGRAM_TTL_MS = 60_000;
const SHORT_TTL_MS = 5 * 60_000;
const LEADERS_TTL_MS = 30_000;
/** 분봉 — 장중 2분, 장후 30분 (스파크라인 fanout 절감) */
const INTRADAY_CANDLES_TTL_OPEN_MS = 120_000;
const INTRADAY_CANDLES_TTL_CLOSED_MS = 30 * 60_000;

interface Entry<T> {
  data: T;
  /** 이 시각까지는 fresh — 재조회 없음 */
  expiresAt: number;
  /** expiresAt 이후 ~ staleUntil: stale 즉시 반환 + 백그라운드 재조회 */
  staleUntil: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __kisQuoteCache: Map<string, Entry<Quote | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisQuoteFlight: Map<string, Promise<Quote | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisFlowCache: Map<string, Entry<FlowData | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisFlowFlight: Map<string, Promise<FlowData | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisIndexCache: Map<string, Entry<IndexQuote | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisIndexFlight: Map<string, Promise<IndexQuote | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisProgramCache: Map<string, Entry<ProgramTradeData | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisProgramFlight: Map<string, Promise<ProgramTradeData | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisShortCache: Map<string, Entry<ShortBalanceData | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisShortFlight: Map<string, Promise<ShortBalanceData | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisLeadersCache: Map<string, Entry<MarketLeadersData | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisLeadersFlight: Map<string, Promise<MarketLeadersData | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisCandleCache:
    | Map<string, Entry<HistoricalPoint[] | null>>
    | undefined;
  // eslint-disable-next-line no-var
  var __kisCandleFlight:
    | Map<string, Promise<HistoricalPoint[] | null>>
    | undefined;
  // eslint-disable-next-line no-var
  var __kisAskingCache: Map<string, Entry<AskingPriceData | null>> | undefined;
  // eslint-disable-next-line no-var
  var __kisAskingFlight: Map<string, Promise<AskingPriceData | null>> | undefined;
}

function getQuoteCache(): Map<string, Entry<Quote | null>> {
  if (!global.__kisQuoteCache) global.__kisQuoteCache = new Map();
  return global.__kisQuoteCache;
}
function getQuoteFlight(): Map<string, Promise<Quote | null>> {
  if (!global.__kisQuoteFlight) global.__kisQuoteFlight = new Map();
  return global.__kisQuoteFlight;
}
function getFlowCache(): Map<string, Entry<FlowData | null>> {
  if (!global.__kisFlowCache) global.__kisFlowCache = new Map();
  return global.__kisFlowCache;
}
function getFlowFlight(): Map<string, Promise<FlowData | null>> {
  if (!global.__kisFlowFlight) global.__kisFlowFlight = new Map();
  return global.__kisFlowFlight;
}
function getIndexCache(): Map<string, Entry<IndexQuote | null>> {
  if (!global.__kisIndexCache) global.__kisIndexCache = new Map();
  return global.__kisIndexCache;
}
function getIndexFlight(): Map<string, Promise<IndexQuote | null>> {
  if (!global.__kisIndexFlight) global.__kisIndexFlight = new Map();
  return global.__kisIndexFlight;
}

function makeEntry<T>(
  data: T,
  dataTtl: number,
  swrMs: number
): Entry<T> {
  const now = Date.now();
  const ttl = pickTtl(data as T | null, dataTtl);
  // null 은 짧게만 봉인 — SWR 창을 열지 않음 (실패를 오래 보여주지 않음)
  const useSwr = data != null && swrMs > 0;
  return {
    data,
    expiresAt: now + ttl,
    staleUntil: now + ttl + (useSwr ? swrMs : 0),
  };
}

/** 접속 시 캐시 hit = KIS 스킵 한 줄 (warn — Vercel Functions 로그에서 바로 보임) */
function logKisCacheSkip(kind: string, key: string, hit: "mem" | "kv"): void {
  console.warn(`[kis-cache] skip kind=${kind} key=${key} hit=${hit}`);
}

function logKisCacheMiss(kind: string, key: string): void {
  console.warn(`[kis-cache] miss kind=${kind} key=${key} → KIS fetch`);
}

/**
 * soft TTL + SWR + in-flight 디듀프.
 * - fresh: 즉시 반환
 * - stale: 즉시 반환 + 백그라운드 재조회 (await 안 함)
 * - 완전 만료: 재조회를 await
 */
async function getOrFetchSwr<T>(opts: {
  cache: Map<string, Entry<T>>;
  flight: Map<string, Promise<T>>;
  key: string;
  ttlMs: number;
  swrMs: number;
  kind?: string;
  fetch: () => Promise<T>;
}): Promise<T> {
  const { cache, flight, key, ttlMs, swrMs, kind } = opts;
  const now = Date.now();
  const hit = cache.get(key);

  if (hit && hit.expiresAt > now) {
    if (kind) logKisCacheSkip(kind, key, "mem");
    return hit.data;
  }

  const inflight = flight.get(key);
  // staleUntil 없는 구형 엔트리(hot-reload)는 fresh 만료 = 즉시 재조회
  const staleUntil = hit?.staleUntil ?? hit?.expiresAt ?? 0;
  if (hit && staleUntil > now) {
    // stale-while-revalidate: 즉시 stale, 없으면 백그라운드 갱신
    if (!inflight) {
      const p = (async () => {
        const data = await opts.fetch();
        cache.set(key, makeEntry(data, ttlMs, swrMs));
        return data;
      })().finally(() => {
        flight.delete(key);
      });
      flight.set(key, p);
    }
    if (kind) logKisCacheSkip(kind, key, "mem");
    return hit.data;
  }

  if (inflight) return inflight;

  if (kind) logKisCacheMiss(kind, key);

  const p = (async () => {
    const data = await opts.fetch();
    cache.set(key, makeEntry(data, ttlMs, swrMs));
    return data;
  })().finally(() => {
    flight.delete(key);
  });
  flight.set(key, p);
  return p;
}

/** hard TTL (SWR 없음) — 수급·프로그램 등 느리게 변하는 데이터 */
async function getOrFetchHard<T>(opts: {
  cache: Map<string, Entry<T>>;
  flight: Map<string, Promise<T>>;
  key: string;
  ttlMs: number;
  kind?: string;
  fetch: () => Promise<T>;
}): Promise<T> {
  return getOrFetchSwr({ ...opts, swrMs: 0 });
}

/**
 * 수급 전용 — 메모리 → KV → KIS.
 * Vercel cold start 마다 메모리가 비어도 KV hit 이면 토큰·수급 REST 를 안 친다.
 */
async function getOrFetchFlowWithKv(code: string): Promise<FlowData | null> {
  const cache = getFlowCache();
  const flight = getFlowFlight();
  const key = code;
  const ttlMs = flowTtlMs();
  const now = Date.now();
  const mem = cache.get(key);

  if (mem && mem.expiresAt > now) {
    logKisCacheSkip("flow", key, "mem");
    return mem.data;
  }

  const inflight = flight.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    // KV cross-instance (토큰과 동일 Upstash)
    if (kisKvConfigured()) {
      try {
        const raw = await kisKvGet(`kis:flow:v1:${code}`);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            data: FlowData | null;
            expiresAt?: number;
          };
          if (
            parsed &&
            typeof parsed.expiresAt === "number" &&
            parsed.expiresAt > Date.now()
          ) {
            const remainMs = parsed.expiresAt - Date.now();
            cache.set(key, makeEntry(parsed.data, remainMs, 0));
            logKisCacheSkip("flow", key, "kv");
            return parsed.data;
          }
        }
      } catch {
        // KV 실패 → KIS 폴백
      }
    }

    logKisCacheMiss("flow", key);
    const data = await fetchKrFlow(code).catch(() => null);
    const entry = makeEntry(data, ttlMs, 0);
    cache.set(key, entry);

    if (data != null && kisKvConfigured()) {
      const ttlSec = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
      const payload = JSON.stringify({ data, expiresAt: entry.expiresAt });
      void kisKvSet(`kis:flow:v1:${code}`, payload, ttlSec);
    }

    return data;
  })().finally(() => {
    flight.delete(key);
  });

  flight.set(key, p);
  return p;
}

/** 해외 시세 — 세션별 TTL + SWR + in-flight 공유 */
export async function getUsQuoteCached(
  code: string,
  name: string
): Promise<Quote | null> {
  const market: QuoteMarket = "us";
  return getOrFetchSwr({
    cache: getQuoteCache(),
    flight: getQuoteFlight(),
    key: `us:${code}`,
    ttlMs: quoteTtlMs(market),
    swrMs: QUOTE_STALE_WHILE_REVALIDATE_MS,
    kind: "quote-us",
    fetch: () => fetchUsQuote(code, name).catch(() => null),
  });
}

/** 국내 시세 — 네이버 실패 폴백 경로. 세션별 TTL + SWR */
export async function getKrQuoteCached(
  code: string,
  name: string
): Promise<Quote | null> {
  const market: QuoteMarket = "kr";
  return getOrFetchSwr({
    cache: getQuoteCache(),
    flight: getQuoteFlight(),
    key: `kr:${code}`,
    ttlMs: quoteTtlMs(market),
    swrMs: QUOTE_STALE_WHILE_REVALIDATE_MS,
    kind: "quote-kr",
    fetch: () => fetchKrQuote(code, name).catch(() => null),
  });
}

/** 국내 지수 — 세션별 TTL + SWR */
export async function getKrIndexCached(
  yahooCode: string,
  name: string
): Promise<IndexQuote | null> {
  const market: QuoteMarket = "kr";
  return getOrFetchSwr({
    cache: getIndexCache(),
    flight: getIndexFlight(),
    key: `idx:${yahooCode}`,
    ttlMs: quoteTtlMs(market),
    swrMs: QUOTE_STALE_WHILE_REVALIDATE_MS,
    kind: "index",
    fetch: () => fetchKrIndex(yahooCode, name).catch(() => null),
  });
}

/** 외인·기관 수급 — 세션별 TTL + KV. 접속/full마다 재호출 금지 */
export async function getKrFlowCached(code: string): Promise<FlowData | null> {
  return getOrFetchFlowWithKv(code);
}

function getProgramCache(): Map<string, Entry<ProgramTradeData | null>> {
  if (!global.__kisProgramCache) global.__kisProgramCache = new Map();
  return global.__kisProgramCache;
}
function getProgramFlight(): Map<string, Promise<ProgramTradeData | null>> {
  if (!global.__kisProgramFlight) global.__kisProgramFlight = new Map();
  return global.__kisProgramFlight;
}
function getShortCache(): Map<string, Entry<ShortBalanceData | null>> {
  if (!global.__kisShortCache) global.__kisShortCache = new Map();
  return global.__kisShortCache;
}
function getShortFlight(): Map<string, Promise<ShortBalanceData | null>> {
  if (!global.__kisShortFlight) global.__kisShortFlight = new Map();
  return global.__kisShortFlight;
}
function getLeadersCache(): Map<string, Entry<MarketLeadersData | null>> {
  if (!global.__kisLeadersCache) global.__kisLeadersCache = new Map();
  return global.__kisLeadersCache;
}
function getLeadersFlight(): Map<string, Promise<MarketLeadersData | null>> {
  if (!global.__kisLeadersFlight) global.__kisLeadersFlight = new Map();
  return global.__kisLeadersFlight;
}

export async function getProgramTradeCached(
  code: string
): Promise<ProgramTradeData | null> {
  return getOrFetchHard({
    cache: getProgramCache(),
    flight: getProgramFlight(),
    key: code,
    ttlMs: PROGRAM_TTL_MS,
    fetch: () => fetchKrProgramTrade(code).catch(() => null),
  });
}

export async function getShortBalanceCached(
  code: string
): Promise<ShortBalanceData | null> {
  return getOrFetchHard({
    cache: getShortCache(),
    flight: getShortFlight(),
    key: code,
    ttlMs: SHORT_TTL_MS,
    fetch: () => fetchKrShortBalance(code).catch(() => null),
  });
}

export async function getMarketLeadersCached(
  kind: MarketLeadersKind,
  market: MarketLeadersMarket = "all",
  count = 20
): Promise<MarketLeadersData | null> {
  return getOrFetchHard({
    cache: getLeadersCache(),
    flight: getLeadersFlight(),
    key: `${kind}:${market}:${count}`,
    ttlMs: LEADERS_TTL_MS,
    fetch: () => fetchKrMarketLeaders(kind, market, count).catch(() => null),
  });
}

function getCandleCache(): Map<string, Entry<HistoricalPoint[] | null>> {
  if (!global.__kisCandleCache) global.__kisCandleCache = new Map();
  return global.__kisCandleCache;
}
function getCandleFlight(): Map<string, Promise<HistoricalPoint[] | null>> {
  if (!global.__kisCandleFlight) global.__kisCandleFlight = new Map();
  return global.__kisCandleFlight;
}

function intradayCandlesTtlMs(now = new Date()): number {
  return isKrRegularSession(now)
    ? INTRADAY_CANDLES_TTL_OPEN_MS
    : INTRADAY_CANDLES_TTL_CLOSED_MS;
}

export async function getIntradayCandlesCached(
  code: string
): Promise<HistoricalPoint[] | null> {
  return getOrFetchHard({
    cache: getCandleCache(),
    flight: getCandleFlight(),
    key: code,
    ttlMs: intradayCandlesTtlMs(),
    kind: "intraday",
    fetch: () => fetchKrIntradayCandles(code).catch(() => null),
  });
}

function getAskingCache(): Map<string, Entry<AskingPriceData | null>> {
  if (!global.__kisAskingCache) global.__kisAskingCache = new Map();
  return global.__kisAskingCache;
}
function getAskingFlight(): Map<string, Promise<AskingPriceData | null>> {
  if (!global.__kisAskingFlight) global.__kisAskingFlight = new Map();
  return global.__kisAskingFlight;
}

/** 10호가 — 예측 알파용. KIS 키 없으면 null. 세션별 TTL */
export async function getKrAskingPriceCached(
  code: string
): Promise<AskingPriceData | null> {
  return getOrFetchHard({
    cache: getAskingCache(),
    flight: getAskingFlight(),
    key: code,
    ttlMs: askingTtlMs(),
    kind: "asking",
    fetch: () => fetchKrAskingPrice(code).catch(() => null),
  });
}

// 강제 갱신 — 사용자 새로고침 버튼 등에서 호출.
export function invalidateKisExtraCache(code?: string): void {
  if (code) {
    getQuoteCache().delete(`us:${code}`);
    getQuoteCache().delete(`kr:${code}`);
    getQuoteFlight().delete(`us:${code}`);
    getQuoteFlight().delete(`kr:${code}`);
    getFlowCache().delete(code);
    getFlowFlight().delete(code);
    getIndexCache().delete(`idx:${code}`);
    getIndexFlight().delete(`idx:${code}`);
    getProgramCache().delete(code);
    getProgramFlight().delete(code);
    getShortCache().delete(code);
    getShortFlight().delete(code);
    getCandleCache().delete(code);
    getCandleFlight().delete(code);
    getAskingCache().delete(code);
    getAskingFlight().delete(code);
    // KV 수급도 무효화 (실패해도 로컬은 이미 지움)
    if (kisKvConfigured()) {
      void kisKvSet(`kis:flow:v1:${code}`, "", 1);
    }
  } else {
    getQuoteCache().clear();
    getQuoteFlight().clear();
    getFlowCache().clear();
    getFlowFlight().clear();
    getIndexCache().clear();
    getIndexFlight().clear();
    getProgramCache().clear();
    getProgramFlight().clear();
    getShortCache().clear();
    getShortFlight().clear();
    getLeadersCache().clear();
    getLeadersFlight().clear();
    getCandleCache().clear();
    getCandleFlight().clear();
    getAskingCache().clear();
    getAskingFlight().clear();
  }
}

// 테스트·문서용 re-export (server 경로에서도 정책 상수 접근)
export {
  ASKING_TTL_CLOSED_MS,
  FLOW_TTL_MS,
  NULL_TTL_MS,
  QUOTE_STALE_WHILE_REVALIDATE_MS,
  askingTtlMs,
  flowTtlMs,
  quoteTtlMs,
} from "./kisCachePolicy";
