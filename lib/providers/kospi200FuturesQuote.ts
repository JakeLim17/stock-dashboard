import "server-only";
import {
  isKospi200NightWindow,
  kospi200NightRateVsRegularClose,
} from "../analyzer/kospi200Futures";
import { fetchKisKospi200FuturesNightRate } from "./kis";

/**
 * 코스피200 선물 야간 등락 — Yahoo 티커 없음.
 * 벤치(sonmul.co.kr): 갭은 야간선물 vs 정규 종가가 1순위, NQ·SOX·환율은 보조.
 * 피드: `/api/market/overview` 의 KOSPI200_NIGHT / KOSPI200_DAY (HTML 스크래핑 아님).
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

let cache: { at: number; rate: number | null } | null = null;
let inflight: Promise<number | null> | null = null;

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

/** 야간 현재가 / 주간 종가 − 1. changeRate 필드는 prevClose 정의가 달라 쓰지 않음. */
export function sonmulKospi200NightRate(quotes: SonmulQuote[]): number | null {
  const night = quotes.find((q) => q.symbol === "KOSPI200_NIGHT");
  const day = quotes.find((q) => q.symbol === "KOSPI200_DAY");
  const last = night?.current;
  const dayClose = day?.current;
  if (last == null || dayClose == null) return null;
  return kospi200NightRateVsRegularClose(last, dayClose);
}

async function fetchSonmulKospi200NightRate(
  now: Date
): Promise<number | null> {
  if (!isKospi200NightWindow(now)) return null;
  const json = await fetchJson<SonmulOverview>(
    SONMUL_OVERVIEW,
    "https://sonmul.co.kr/"
  );
  const futures = json?.data?.futures;
  if (!Array.isArray(futures) || futures.length === 0) return null;
  return sonmulKospi200NightRate(futures);
}

async function fetchNaverKospi200NightRate(
  now: Date
): Promise<number | null> {
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
  return kospi200NightRateVsRegularClose(last, dayClose);
}

async function fetchKospi200NightRateUncached(
  now: Date
): Promise<number | null> {
  if (!isKospi200NightWindow(now)) return null;
  const sonmul = await fetchSonmulKospi200NightRate(now).catch(() => null);
  if (sonmul != null && Number.isFinite(sonmul)) return sonmul;
  const kis = await fetchKisKospi200FuturesNightRate(now).catch(() => null);
  if (kis != null && Number.isFinite(kis) && Math.abs(kis) >= 0.0005) {
    return kis;
  }
  const naver = await fetchNaverKospi200NightRate(now).catch(() => null);
  if (naver != null && Number.isFinite(naver)) return naver;
  if (kis != null && Number.isFinite(kis)) return kis;
  return null;
}

/** 야간 창의 코스피200 선물 등락률. 캐시 3분. */
export async function fetchKospi200NightRate(
  now = new Date()
): Promise<number | null> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.rate;
  if (inflight) return inflight;
  const p = fetchKospi200NightRateUncached(now)
    .then((rate) => {
      cache = { at: Date.now(), rate };
      return rate;
    })
    .catch(() => {
      cache = { at: Date.now(), rate: null };
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = p;
  return p;
}
