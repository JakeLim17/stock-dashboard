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
} from "./kis";
import type { HistoricalPoint } from "./yahoo";
import {
  FLOW_TTL_MS,
  QUOTE_STALE_WHILE_REVALIDATE_MS,
  pickTtl,
  quoteTtlMs,
  type QuoteMarket,
} from "./kisCachePolicy";

// KIS 응답 메모리 캐시 + in-flight 디듀프.
// - 시세: 세션별 TTL (장중 8s / 장후 45s) + SWR (만료 직후에도 stale 즉시 반환)
// - 수급(외인·기관): 5분 — 분 단위 이상 변화. 접속/full마다 재호출 금지.
// - 프로그램 매매: 60s / 공매도: 5분 / 시장 순위: 30s / 분봉: 30s
//
// 패턴은 consensusCache 와 동일. global symbol로 hot-reload 캐시 유실 방지.

const PROGRAM_TTL_MS = 60_000;
const SHORT_TTL_MS = 5 * 60_000;
const LEADERS_TTL_MS = 30_000;
// 분봉은 새 minute boundary 가 의미 있어 30s 캐시. 클라이언트 폴링은 별도로 1m 단위.
const INTRADAY_CANDLES_TTL_MS = 30_000;

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
  fetch: () => Promise<T>;
}): Promise<T> {
  const { cache, flight, key, ttlMs, swrMs } = opts;
  const now = Date.now();
  const hit = cache.get(key);

  if (hit && hit.expiresAt > now) return hit.data;

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
    return hit.data;
  }

  if (inflight) return inflight;

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
  fetch: () => Promise<T>;
}): Promise<T> {
  return getOrFetchSwr({ ...opts, swrMs: 0 });
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
    fetch: () => fetchKrIndex(yahooCode, name).catch(() => null),
  });
}

/** 외인·기관 수급 — 5분 TTL. full 스냅샷·추천 fanout 중복 차단 */
export async function getKrFlowCached(code: string): Promise<FlowData | null> {
  return getOrFetchHard({
    cache: getFlowCache(),
    flight: getFlowFlight(),
    key: code,
    ttlMs: FLOW_TTL_MS,
    fetch: () => fetchKrFlow(code).catch(() => null),
  });
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

export async function getIntradayCandlesCached(
  code: string
): Promise<HistoricalPoint[] | null> {
  return getOrFetchHard({
    cache: getCandleCache(),
    flight: getCandleFlight(),
    key: code,
    ttlMs: INTRADAY_CANDLES_TTL_MS,
    fetch: () => fetchKrIntradayCandles(code).catch(() => null),
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
  }
}

// 테스트·문서용 re-export (server 경로에서도 정책 상수 접근)
export {
  FLOW_TTL_MS,
  NULL_TTL_MS,
  QUOTE_STALE_WHILE_REVALIDATE_MS,
  quoteTtlMs,
} from "./kisCachePolicy";
