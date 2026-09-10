import "server-only";
import {
  isKospi200NightWindow,
  kospi200NightRateVsRegularClose,
} from "../analyzer/kospi200Futures";
import { fetchKisKospi200FuturesNightRate } from "./kis";

/**
 * 코스피200 선물 야간 — Yahoo 티커 없음.
 * 벤치(야선지지·코스피랩): 갭은 야간선물 vs 정규 종가가 1순위, NQ·BTC·환율은 보조.
 * 피드: sonmul `/api/market/overview` 의 KOSPI200_NIGHT / KOSPI200_DAY.
 * 폴백: KIS → 네이버 FUT(주간 종가만 오면 야간=0).
 */

const SONMUL_OVERVIEW = "https://sonmul.co.kr/api/market/overview";
const NAVER_FUT_BASIC = "https://m.stock.naver.com/api/index/FUT/basic";
const NAVER_FUT_PRICE = "https://m.stock.naver.com/api/index/FUT/price";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 180_000; // 3분

interface SonmulQuote {
  symbol?: string;
  current?: number;
  change?: number;
  changeRate?: number;
  prevClose?: number;
}

interface SonmulOverview {
  success?: boolean;
  data?: { futures?: SonmulQuote[] };
}

interface NaverFutBasic {
  stockName?: string;
  closePrice?: string;
  localTradedAt?: string;
  marketStatus?: string;
}

interface NaverFutDayBar {
  localTradedAt?: string;
  closePrice?: string;
}

export type Kospi200NightSource = "sonmul" | "kis" | "naver";

export interface Kospi200NightQuote {
  last: number;
  regularClose: number;
  rate: number;
  source: Kospi200NightSource;
  asOf: number;
}

let cache: { at: number; quote: Kospi200NightQuote | null } | null = null;
let inflight: Promise<Kospi200NightQuote | null> | null = null;

function parseKoNum(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

async function fetchJson<T>(
  url: string,
  referer: string
): Promise<T | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": UA,
        Referer: referer,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function sonmulKospi200NightQuote(
  quotes: SonmulQuote[],
  asOf = Date.now()
): Kospi200NightQuote | null {
  const night = quotes.find((q) => q.symbol === "KOSPI200_NIGHT");
  const day = quotes.find((q) => q.symbol === "KOSPI200_DAY");
  const last = night?.current;
  const dayClose = day?.current;
  if (last == null || dayClose == null) return null;
  const rate = kospi200NightRateVsRegularClose(last, dayClose);
  if (rate == null) return null;
  return { last, regularClose: dayClose, rate, source: "sonmul", asOf };
}

/** 야간 현재가 / 주간 종가 − 1. changeRate 필드는 prevClose 정의가 달라 쓰지 않음. */
export function sonmulKospi200NightRate(quotes: SonmulQuote[]): number | null {
  return sonmulKospi200NightQuote(quotes)?.rate ?? null;
}

async function fetchSonmulKospi200NightQuote(): Promise<Kospi200NightQuote | null> {
  const json = await fetchJson<SonmulOverview>(
    SONMUL_OVERVIEW,
    "https://sonmul.co.kr/"
  );
  const futures = json?.data?.futures;
  if (!Array.isArray(futures) || futures.length === 0) return null;
  return sonmulKospi200NightQuote(futures);
}

async function fetchNaverKospi200NightQuote(
  now: Date
): Promise<Kospi200NightQuote | null> {
  if (!isKospi200NightWindow(now)) return null;
  const [basic, days] = await Promise.all([
    fetchJson<NaverFutBasic>(
      NAVER_FUT_BASIC,
      "https://m.stock.naver.com/domestic/index/FUT"
    ),
    fetchJson<NaverFutDayBar[]>(
      NAVER_FUT_PRICE,
      "https://m.stock.naver.com/domestic/index/FUT"
    ),
  ]);
  const last = parseKoNum(basic?.closePrice);
  const dayClose = parseKoNum(days?.[0]?.closePrice);
  if (last == null || dayClose == null) return null;
  const rate = kospi200NightRateVsRegularClose(last, dayClose);
  if (rate == null) return null;
  return {
    last,
    regularClose: dayClose,
    rate,
    source: "naver",
    asOf: Date.now(),
  };
}

async function fetchKospi200NightQuoteUncached(
  now: Date
): Promise<Kospi200NightQuote | null> {
  const sonmul = await fetchSonmulKospi200NightQuote().catch(() => null);
  if (sonmul != null) return sonmul;

  if (!isKospi200NightWindow(now)) return null;

  const kis = await fetchKisKospi200FuturesNightRate(now).catch(() => null);
  if (kis != null && Number.isFinite(kis) && Math.abs(kis) >= 0.0005) {
    return {
      last: 1 + kis,
      regularClose: 1,
      rate: kis,
      source: "kis",
      asOf: Date.now(),
    };
  }
  const naver = await fetchNaverKospi200NightQuote(now).catch(() => null);
  if (naver != null) return naver;
  if (kis != null && Number.isFinite(kis)) {
    return {
      last: 1 + kis,
      regularClose: 1,
      rate: kis,
      source: "kis",
      asOf: Date.now(),
    };
  }
  return null;
}

/** 야간선물 시세. 주간에도 야간 마감 갭을 보여 준다. 캐시 3분. */
export async function fetchKospi200NightQuote(
  now = new Date()
): Promise<Kospi200NightQuote | null> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.quote;
  if (inflight) return inflight;
  const p = fetchKospi200NightQuoteUncached(now)
    .then((quote) => {
      cache = { at: Date.now(), quote };
      return quote;
    })
    .catch(() => {
      cache = { at: Date.now(), quote: null };
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = p;
  return p;
}

/** 야간 창의 코스피200 선물 등락률. 정규장 중엔 null (이미 시가에 반영됨). */
export async function fetchKospi200NightRate(
  now = new Date()
): Promise<number | null> {
  if (!isKospi200NightWindow(now)) return null;
  const quote = await fetchKospi200NightQuote(now);
  return quote?.rate ?? null;
}
