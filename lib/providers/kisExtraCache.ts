import "server-only";
import type {
  MarketLeadersData,
  MarketLeadersKind,
  MarketLeadersMarket,
  ProgramTradeData,
  ShortBalanceData,
} from "../types";
import {
  fetchKrIntradayCandles,
  fetchKrMarketLeaders,
  fetchKrProgramTrade,
  fetchKrShortBalance,
} from "./kis";
import type { HistoricalPoint } from "./yahoo";

// KIS 신규 데이터(프로그램 매매·공매도·시장 순위) 메모리 캐시.
// - 프로그램 매매: 60s TTL — 매 폴링(1~2초)마다 호출하면 토큰/throttle 부담이 큼. 분 단위 변화가 본질적인 데이터.
// - 공매도 잔고:   5분 TTL — KRX 일별 갱신이라 더 자주 호출할 이유 없음.
// - 시장 순위:    30s TTL — 자주 바뀌지만 사용자가 보는 빈도가 낮음.
//
// 패턴은 consensusCache 와 동일. global symbol로 hot-reload 캐시 유실 방지.

const PROGRAM_TTL_MS = 60_000;
const SHORT_TTL_MS = 5 * 60_000;
const LEADERS_TTL_MS = 30_000;
// 분봉은 새 minute boundary 가 의미 있어 30s 캐시. 클라이언트 폴링은 별도로 1m 단위.
const INTRADAY_CANDLES_TTL_MS = 30_000;
// null 결과 캐시 TTL — 첫 실패로 길게 봉인되면 일시적 KIS hiccup 회복이 느려진다.
// 정상 data 와 분리해 짧게(기본 10s) 유지하면, KIS 가 복구된 직후 다음 폴링부터
// 사용자 화면에 데이터가 다시 채워진다.
const NULL_TTL_MS = 10_000;

// data 가 null 이면 짧은 null-TTL, 그 외에는 정상 data-TTL.
function pickTtl<T>(data: T | null, dataTtl: number): number {
  return data == null ? NULL_TTL_MS : dataTtl;
}

interface Entry<T> {
  data: T;
  expiresAt: number;
}

declare global {
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
  const c = getProgramCache();
  const f = getProgramFlight();
  const now = Date.now();
  const hit = c.get(code);
  if (hit && hit.expiresAt > now) return hit.data;
  const inflight = f.get(code);
  if (inflight) return inflight;
  const p = (async () => {
    const data = await fetchKrProgramTrade(code).catch(() => null);
    c.set(code, {
      data,
      expiresAt: Date.now() + pickTtl(data, PROGRAM_TTL_MS),
    });
    return data;
  })().finally(() => {
    f.delete(code);
  });
  f.set(code, p);
  return p;
}

export async function getShortBalanceCached(
  code: string
): Promise<ShortBalanceData | null> {
  const c = getShortCache();
  const f = getShortFlight();
  const now = Date.now();
  const hit = c.get(code);
  if (hit && hit.expiresAt > now) return hit.data;
  const inflight = f.get(code);
  if (inflight) return inflight;
  const p = (async () => {
    const data = await fetchKrShortBalance(code).catch(() => null);
    c.set(code, {
      data,
      expiresAt: Date.now() + pickTtl(data, SHORT_TTL_MS),
    });
    return data;
  })().finally(() => {
    f.delete(code);
  });
  f.set(code, p);
  return p;
}

export async function getMarketLeadersCached(
  kind: MarketLeadersKind,
  market: MarketLeadersMarket = "all",
  count = 20
): Promise<MarketLeadersData | null> {
  const key = `${kind}:${market}:${count}`;
  const c = getLeadersCache();
  const f = getLeadersFlight();
  const now = Date.now();
  const hit = c.get(key);
  if (hit && hit.expiresAt > now) return hit.data;
  const inflight = f.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    const data = await fetchKrMarketLeaders(kind, market, count).catch(() => null);
    c.set(key, {
      data,
      expiresAt: Date.now() + pickTtl(data, LEADERS_TTL_MS),
    });
    return data;
  })().finally(() => {
    f.delete(key);
  });
  f.set(key, p);
  return p;
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
  const key = code;
  const c = getCandleCache();
  const f = getCandleFlight();
  const now = Date.now();
  const hit = c.get(key);
  if (hit && hit.expiresAt > now) return hit.data;
  const inflight = f.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    const data = await fetchKrIntradayCandles(code).catch(() => null);
    c.set(key, {
      data,
      expiresAt: Date.now() + pickTtl(data, INTRADAY_CANDLES_TTL_MS),
    });
    return data;
  })().finally(() => {
    f.delete(key);
  });
  f.set(key, p);
  return p;
}

// 강제 갱신 — 사용자 새로고침 버튼 등에서 호출.
export function invalidateKisExtraCache(code?: string): void {
  if (code) {
    getProgramCache().delete(code);
    getProgramFlight().delete(code);
    getShortCache().delete(code);
    getShortFlight().delete(code);
    getCandleCache().delete(code);
    getCandleFlight().delete(code);
  } else {
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
