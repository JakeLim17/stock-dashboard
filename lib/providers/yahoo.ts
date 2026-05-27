import "server-only";
import YahooFinance from "yahoo-finance2";
import type { ExtendedHoursQuote, Quote, TechIndicators } from "../types";

// yahoo-finance2 v3는 인스턴스 기반. survey/historical 안내 로그 끄기.
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

// quote는 union 타입을 돌려줘서 직접 narrowing이 까다롭다.
// → 결과를 record로 받고 안전한 num/str helper로 꺼내쓴다.
type RawRecord = Record<string, unknown>;

export interface HistoricalPoint {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchQuote(code: string, name: string): Promise<Quote> {
  const raw = (await yahooFinance.quote(code)) as unknown as RawRecord | RawRecord[] | undefined;
  const q: RawRecord = Array.isArray(raw) ? (raw[0] ?? {}) : (raw ?? {});

  const price = num(q.regularMarketPrice) ?? 0;
  const prev = num(q.regularMarketPreviousClose) ?? price;
  const abs = num(q.regularMarketChange) ?? price - prev;
  const rate = num(q.regularMarketChangePercent);
  // Yahoo는 changePercent를 % 단위 (1.23 = 1.23%)로 줌. 우리는 0.0123 형식 사용.
  const changeRate = rate != null ? rate / 100 : prev ? abs / prev : 0;

  // regularMarketTime은 라이브러리가 보통 Date 객체로 변환해서 줌. 안전하게 둘 다 처리.
  const priceTime = toEpochMs(q.regularMarketTime);

  const marketState = str(q.marketState);
  const extendedHours = extractExtended(q, marketState, price);

  return {
    code,
    name,
    price,
    prevClose: prev,
    changeAbs: abs,
    changeRate,
    volume: num(q.regularMarketVolume),
    high: num(q.regularMarketDayHigh),
    low: num(q.regularMarketDayLow),
    marketCap: num(q.marketCap),
    currency: str(q.currency),
    fetchedAt: Date.now(),
    marketState,
    priceTime,
    extendedHours,
  };
}

// Yahoo 응답에서 프리/애프터마켓 가격을 ExtendedHoursQuote로 정규화.
// 기준값은 항상 정규장 종가(regularMarketPrice). Yahoo가 주는 changePercent는 % 단위.
function extractExtended(
  q: RawRecord,
  marketState: string | undefined,
  regularPrice: number
): ExtendedHoursQuote | null {
  const state = (marketState ?? "").toUpperCase();

  // 프리마켓: PRE 또는 PREPRE에서 preMarketPrice가 있으면 채움
  if ((state === "PRE" || state === "PREPRE") && num(q.preMarketPrice) != null) {
    const price = num(q.preMarketPrice) as number;
    const abs = num(q.preMarketChange) ?? price - regularPrice;
    const ratePct = num(q.preMarketChangePercent);
    const rate = ratePct != null ? ratePct / 100 : regularPrice ? abs / regularPrice : 0;
    return {
      session: "pre",
      price,
      changeAbs: abs,
      changeRate: rate,
      time: toEpochMs(q.preMarketTime),
      active: state === "PRE",
    };
  }

  // 애프터마켓: POST 또는 POSTPOST에서 postMarketPrice가 있으면 채움
  if ((state === "POST" || state === "POSTPOST") && num(q.postMarketPrice) != null) {
    const price = num(q.postMarketPrice) as number;
    const abs = num(q.postMarketChange) ?? price - regularPrice;
    const ratePct = num(q.postMarketChangePercent);
    const rate = ratePct != null ? ratePct / 100 : regularPrice ? abs / regularPrice : 0;
    return {
      session: "post",
      price,
      changeAbs: abs,
      changeRate: rate,
      time: toEpochMs(q.postMarketTime),
      active: state === "POST",
    };
  }

  return null;
}

// Date | number(sec or ms) | string → epoch ms
function toEpochMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) {
    // Yahoo는 보통 초 단위. 10자리면 sec, 13자리면 ms로 추정.
    return v > 1e12 ? v : v * 1000;
  }
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export async function fetchQuotesBatch(
  items: Array<{ code: string; name: string }>
): Promise<Array<{ ok: true; quote: Quote } | { ok: false; code: string; error: string }>> {
  return Promise.all(
    items.map(async (it) => {
      try {
        const quote = await fetchQuote(it.code, it.name);
        return { ok: true as const, quote };
      } catch (e) {
        return {
          ok: false as const,
          code: it.code,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })
  );
}

export async function fetchHistorical(
  code: string,
  days = 90
): Promise<HistoricalPoint[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);

  try {
    const raw = (await yahooFinance.chart(code, {
      period1: start,
      period2: end,
      interval: "1d",
    })) as unknown as { quotes?: Array<RawRecord> };

    const list = raw?.quotes ?? [];
    return list
      .filter((q) => num(q.close) != null)
      .map((q) => {
        const close = num(q.close) ?? 0;
        const ds = q.date as Date | string | number;
        const date = ds instanceof Date ? ds.getTime() : new Date(ds).getTime();
        return {
          date,
          open: num(q.open) ?? close,
          high: num(q.high) ?? close,
          low: num(q.low) ?? close,
          close,
          volume: num(q.volume) ?? 0,
        };
      });
  } catch {
    return [];
  }
}

// 단순 SMA
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// 표준 RSI (Wilder)
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

export function computeTech(hist: HistoricalPoint[]): TechIndicators {
  const closes = hist.map((h) => h.close);
  const s5 = sma(closes, 5);
  const s20 = sma(closes, 20);
  const s60 = sma(closes, 60);
  const r = rsi(closes, 14);

  let trend: TechIndicators["trend"] = "sideways";
  if (s5 != null && s20 != null) {
    if (s5 > s20 * 1.005) trend = "uptrend";
    else if (s5 < s20 * 0.995) trend = "downtrend";
  }

  // 과열도: RSI 기준 0~100, 5일 거래량 급증이면 +10 가산
  let heat = 50;
  if (r != null) heat = clamp(Math.round(r), 0, 100);

  if (hist.length >= 21) {
    const recent5 = hist.slice(-5).reduce((a, b) => a + b.volume, 0) / 5;
    const past20 = hist.slice(-25, -5).reduce((a, b) => a + b.volume, 0) / 20;
    if (past20 > 0 && recent5 / past20 > 1.5) heat = Math.min(100, heat + 10);
  }

  return {
    sma5: s5,
    sma20: s20,
    sma60: s60,
    rsi14: r,
    trend,
    heat,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
