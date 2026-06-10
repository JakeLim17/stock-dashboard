import "server-only";
import type {
  MarketLeadersData,
  MarketLeadersKind,
  MarketLeadersMarket,
  ProgramTradeData,
  ShortBalanceData,
} from "../types";
import {
  fetchKrMarketLeaders,
  fetchKrProgramTrade,
  fetchKrShortBalance,
} from "./kis";

// KIS 신규 데이터(프로그램 매매·공매도·시장 순위) 메모리 캐시.
// - 프로그램 매매: 60s TTL — 매 폴링(1~2초)마다 호출하면 토큰/throttle 부담이 큼. 분 단위 변화가 본질적인 데이터.
// - 공매도 잔고:   5분 TTL — KRX 일별 갱신이라 더 자주 호출할 이유 없음.
// - 시장 순위:    30s TTL — 자주 바뀌지만 사용자가 보는 빈도가 낮음.
//
// 패턴은 consensusCache 와 동일. global symbol로 hot-reload 캐시 유실 방지.

const PROGRAM_TTL_MS = 60_000;
const SHORT_TTL_MS = 5 * 60_000;
const LEADERS_TTL_MS = 30_000;

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
    c.set(code, { data, expiresAt: Date.now() + PROGRAM_TTL_MS });
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
    c.set(code, { data, expiresAt: Date.now() + SHORT_TTL_MS });
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
    c.set(key, { data, expiresAt: Date.now() + LEADERS_TTL_MS });
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
  } else {
    getProgramCache().clear();
    getProgramFlight().clear();
    getShortCache().clear();
    getShortFlight().clear();
    getLeadersCache().clear();
    getLeadersFlight().clear();
  }
}
