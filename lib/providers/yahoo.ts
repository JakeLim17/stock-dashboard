import "server-only";
import YahooFinance from "yahoo-finance2";
import type {
  AnalystConsensus,
  ExtendedHoursQuote,
  Quote,
  TechIndicators,
  Valuation,
} from "../types";

// yahoo-finance2 v3는 인스턴스 기반. survey/historical 안내 로그 끄기.
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

// Yahoo Finance 호출 timeout — 응답이 8초 이상 늦으면 끊고 catch 로 흘려보낸다.
// (2026-06) Yahoo 가 가끔 무응답 / 30s+ 지연을 보내며 Vercel function 점유를 늘림.
// 이걸 강제로 끊어 폴링 5s 회복으로 인한 누적 점유를 막는다.
// AbortSignal.timeout 은 Node 18+ / 모던 브라우저 모두 지원. AbortError 가 던져지면
// 호출자(fetchQuotesBatch 또는 각 함수의 catch) 가 그대로 흡수.
const YAHOO_TIMEOUT_MS = 8_000;
function yfFetchOpts(): { fetchOptions: { signal: AbortSignal } } {
  return { fetchOptions: { signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS) } };
}

/** 신규상장(SKHY 등) meta 불완전 — 스키마 검증 끄고 quotes/필드 사용 */
function yfFetchOptsRelaxed(): {
  fetchOptions: { signal: AbortSignal };
  validateResult: false;
} {
  return {
    fetchOptions: { signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS) },
    validateResult: false,
  };
}

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
  const raw = (await yahooFinance.quote(
    code,
    {},
    yfFetchOptsRelaxed()
  )) as unknown as RawRecord | RawRecord[] | undefined;
  const q: RawRecord = Array.isArray(raw) ? (raw[0] ?? {}) : (raw ?? {});

  let price = num(q.regularMarketPrice) ?? 0;
  let prev = num(q.regularMarketPreviousClose) ?? price;
  let abs = num(q.regularMarketChange) ?? (price > 0 ? price - prev : 0);
  const rate = num(q.regularMarketChangePercent);
  // Yahoo는 changePercent를 % 단위 (1.23 = 1.23%)로 줌. 우리는 0.0123 형식 사용.
  let changeRate = rate != null ? rate / 100 : prev ? abs / prev : 0;

  let volume = num(q.regularMarketVolume);
  let high = num(q.regularMarketDayHigh);
  let low = num(q.regularMarketDayLow);
  let open = num(q.regularMarketOpen);
  let currency = str(q.currency);

  // 신규상장: quote 에 가격 필드가 비어 있어도 chart 일봉에는 종가가 있는 경우가 많음 (SKHY).
  // Yahoo v7 quote 가 빈 객체·0을 줘도 chart 폴백으로 카드를 채운다.
  if (!(price > 0)) {
    const bar = await fetchLatestChartBar(code);
    if (bar && bar.close > 0) {
      price = bar.close;
      open = open ?? bar.open;
      high = high ?? bar.high;
      low = low ?? bar.low;
      volume = volume ?? bar.volume;
      if (!(prev > 0)) {
        // 전일 종가 없으면 시가를 기준으로 등락 산출 (상장 첫날)
        prev = bar.open > 0 ? bar.open : price;
      }
      abs = price - prev;
      changeRate = prev > 0 ? abs / prev : 0;
      if (!currency) currency = "USD";
    }
  }

  // price=0 을 성공으로 넘기면 카드에 $0.00 · "불러오기 실패" 로 굳는다 — 실패로 올려 재시도·에러 배너.
  if (!(price > 0)) {
    throw new Error(`${code}: Yahoo 시세 없음 (quote·chart 모두 실패)`);
  }

  // regularMarketTime은 라이브러리가 보통 Date 객체로 변환해서 줌. 안전하게 둘 다 처리.
  const priceTime = toEpochMs(q.regularMarketTime);

  const marketState = str(q.marketState);
  const extendedHours = extractExtended(q, marketState, price, priceTime);

  return {
    code,
    name,
    price,
    prevClose: prev,
    changeAbs: abs,
    changeRate,
    volume,
    high,
    low,
    open,
    marketCap: num(q.marketCap),
    currency,
    valuation: {
      per: num(q.trailingPE),
      forwardPer: num(q.forwardPE),
      pbr: num(q.priceToBook),
      eps: num(q.epsTrailingTwelveMonths),
    },
    fetchedAt: Date.now(),
    marketState,
    priceTime,
    extendedHours,
  };
}

// Yahoo 응답에서 프리/애프터마켓 가격을 ExtendedHoursQuote로 정규화.
// 기준값은 항상 정규장 종가(regularMarketPrice). Yahoo가 주는 changePercent는 % 단위.
//
// 신선도 기반 active 판정:
//   Yahoo가 marketState를 PRE/POST → PREPRE/POSTPOST로 옮긴 뒤에도
//   preMarketPrice/postMarketPrice의 timestamp가 regularMarketTime보다 신선한 경우가 잦다
//   (한국 시각 새벽~오전, 미국 애프터마켓 진행 중일 때 흔함).
//   상태 라벨만 보고 active=false로 두면 정규장 종가(수 시간 전)가 카드 메인 가격으로
//   잡혀 사용자가 stale한 가격으로 매매를 판단하게 된다.
//   → state가 PRE/POST가 아니더라도, 시간외 timestamp가 정규장보다 신선하면 active=true.
function extractExtended(
  q: RawRecord,
  marketState: string | undefined,
  regularPrice: number,
  regularTime: number | null
): ExtendedHoursQuote | null {
  const state = (marketState ?? "").toUpperCase();

  // 프리마켓: PRE 또는 PREPRE에서 preMarketPrice가 있으면 채움
  if ((state === "PRE" || state === "PREPRE") && num(q.preMarketPrice) != null) {
    const price = num(q.preMarketPrice) as number;
    const abs = num(q.preMarketChange) ?? price - regularPrice;
    const ratePct = num(q.preMarketChangePercent);
    const rate = ratePct != null ? ratePct / 100 : regularPrice ? abs / regularPrice : 0;
    const time = toEpochMs(q.preMarketTime);
    const fresher = time != null && regularTime != null ? time > regularTime : false;
    return {
      session: "pre",
      price,
      changeAbs: abs,
      changeRate: rate,
      time,
      active: state === "PRE" || fresher,
      regularClose: regularPrice,
    };
  }

  // 애프터마켓: POST 또는 POSTPOST에서 postMarketPrice가 있으면 채움
  if ((state === "POST" || state === "POSTPOST") && num(q.postMarketPrice) != null) {
    const price = num(q.postMarketPrice) as number;
    const abs = num(q.postMarketChange) ?? price - regularPrice;
    const ratePct = num(q.postMarketChangePercent);
    const rate = ratePct != null ? ratePct / 100 : regularPrice ? abs / regularPrice : 0;
    const time = toEpochMs(q.postMarketTime);
    const fresher = time != null && regularTime != null ? time > regularTime : false;
    return {
      session: "post",
      price,
      changeAbs: abs,
      changeRate: rate,
      time,
      active: state === "POST" || fresher,
      regularClose: regularPrice,
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

/** chart 응답에서 일봉 배열 정규화 — 스키마 미완(신규상장)이어도 quotes 만 있으면 OK */
function mapChartQuotes(list: RawRecord[]): HistoricalPoint[] {
  return list
    .filter((q) => num(q.close) != null && (num(q.close) as number) > 0)
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
}

/** 최신 1일봉 — quote 가격 폴백·상장 첫날 시드용.
 *  구간을 짧게→길게 재시도 (신규상장 validRanges·주말 공백 흡수). */
async function fetchLatestChartBar(
  code: string
): Promise<HistoricalPoint | null> {
  for (const lookback of [10, 30, 90]) {
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - lookback);
      const raw = (await yahooFinance.chart(
        code,
        { period1: start, period2: end, interval: "1d" },
        yfFetchOptsRelaxed()
      )) as unknown as { quotes?: Array<RawRecord> };
      const points = mapChartQuotes(raw?.quotes ?? []);
      if (points.length > 0) return points[points.length - 1]!;
    } catch {
      // 다음 lookback 시도
    }
  }
  return null;
}

export async function fetchHistorical(
  code: string,
  days = 90
): Promise<HistoricalPoint[]> {
  const end = new Date();
  // 신규상장은 validRanges 가 1d/5d 뿐인 경우가 있어 요청 구간을 넉넉히 잡되
  // 최소 14일은 확보해 상장 직후 1~수 봉을 놓치지 않는다.
  const lookbacks = Array.from(
    new Set([Math.max(days, 14), 30, 90, Math.max(days, 14)])
  );

  for (const lookback of lookbacks) {
    try {
      const start = new Date();
      start.setDate(end.getDate() - lookback);
      const raw = (await yahooFinance.chart(
        code,
        {
          period1: start,
          period2: end,
          interval: "1d",
        },
        // 신규상장 meta 불완전 → 스키마 검증 끄고 quotes 사용 (SKHY 실측)
        yfFetchOptsRelaxed()
      )) as unknown as { quotes?: Array<RawRecord> };

      const points = mapChartQuotes(raw?.quotes ?? []);
      if (points.length > 0) return points.slice(-days);
    } catch {
      // 다음 lookback
    }
  }
  return [];
}

/** quote OHLC 로 1봉 시드 — history 가 비었을 때 카드·예측이 0일로 굳지 않게 */
export function seedHistoryFromQuote(quote: {
  price: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  priceTime?: number | null;
  fetchedAt: number;
}): HistoricalPoint[] {
  if (!(quote.price > 0)) return [];
  const close = quote.price;
  return [
    {
      date: quote.priceTime ?? quote.fetchedAt,
      open: quote.open && quote.open > 0 ? quote.open : close,
      high: quote.high && quote.high > 0 ? quote.high : close,
      low: quote.low && quote.low > 0 ? quote.low : close,
      close,
      volume: quote.volume && quote.volume > 0 ? quote.volume : 0,
    },
  ];
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

// ─── 컨센서스 / 밸류에이션 ────────────────────────────────────────
//
// quoteSummary로 한 번에 받아 둘 다 채운다. 한국 종목(예: 005930.KS)도 정상 응답.
// 단, 한국 종목은 trailingPE / priceToBook 등이 null로 오는 경우가 많아 네이버 보조와 머지가 필요.
export async function fetchAnalystAndValuation(
  code: string
): Promise<{ consensus: AnalystConsensus | null; valuation: Valuation | null } | null> {
  try {
    const r = (await yahooFinance.quoteSummary(
      code,
      {
        modules: [
          "financialData",
          "recommendationTrend",
          "defaultKeyStatistics",
          "price",
          "summaryDetail",
        ],
      },
      yfFetchOpts()
    )) as unknown as RawRecord | null;
    if (!r) return null;

    const fin = (r.financialData ?? {}) as RawRecord;
    const trend = ((r.recommendationTrend as RawRecord | undefined)?.trend ??
      []) as RawRecord[];
    const keyStats = (r.defaultKeyStatistics ?? {}) as RawRecord;
    const price = (r.price ?? {}) as RawRecord;
    const detail = (r.summaryDetail ?? {}) as RawRecord;

    const targetMean = num(fin.targetMeanPrice);
    const targetMedian = num(fin.targetMedianPrice);
    const targetHigh = num(fin.targetHighPrice);
    const targetLow = num(fin.targetLowPrice);
    const analystCount = num(fin.numberOfAnalystOpinions);
    const recommendationKey = ((): AnalystConsensus["recommendationKey"] => {
      const k = str(fin.recommendationKey)?.toLowerCase();
      if (
        k === "strong_buy" ||
        k === "buy" ||
        k === "hold" ||
        k === "sell" ||
        k === "strong_sell"
      )
        return k;
      return null;
    })();
    const recommendationMean = num(fin.recommendationMean);
    const currentPrice = num(fin.currentPrice) ?? num(price.regularMarketPrice);

    const head = trend[0] ?? {};
    const strongBuy = num(head.strongBuy) ?? 0;
    const buy = num(head.buy) ?? 0;
    const hold = num(head.hold) ?? 0;
    const sell = num(head.sell) ?? 0;
    const strongSell = num(head.strongSell) ?? 0;

    const hasConsensus =
      targetMean != null ||
      analystCount != null ||
      strongBuy + buy + hold + sell + strongSell > 0 ||
      recommendationKey != null;

    const upsidePercent =
      targetMean != null && currentPrice != null && currentPrice > 0
        ? targetMean / currentPrice - 1
        : null;

    const consensus: AnalystConsensus | null = hasConsensus
      ? {
          targetMean,
          targetMedian,
          targetHigh,
          targetLow,
          analystCount,
          recommendationKey,
          recommendationMean,
          strongBuy,
          buy,
          hold,
          sell,
          strongSell,
          upsidePercent,
          source: "yahoo",
          asOf: Date.now(),
        }
      : null;

    // 밸류에이션: trailing/forward EPS·PBR·BPS·배당. 한국 종목은 일부 null.
    const trailingPE = num(detail.trailingPE) ?? num(price.trailingPE);
    const forwardPE = num(detail.forwardPE) ?? num(keyStats.forwardPE);
    const pbr = num(keyStats.priceToBook);
    const eps = num(keyStats.trailingEps);
    const forwardEps = num(keyStats.forwardEps);
    const dividendYield = num(detail.dividendYield);
    const week52High = num(detail.fiftyTwoWeekHigh);
    const week52Low = num(detail.fiftyTwoWeekLow);
    const bookValue = num(keyStats.bookValue);

    const computedForwardPer =
      forwardPE ??
      (forwardEps != null && forwardEps > 0 && currentPrice != null
        ? currentPrice / forwardEps
        : null);

    const valuation: Valuation | null =
      trailingPE != null ||
      computedForwardPer != null ||
      pbr != null ||
      eps != null ||
      week52High != null
        ? {
            per: trailingPE,
            forwardPer: computedForwardPer,
            pbr,
            eps,
            bps: bookValue,
            dividendYield,
            week52High,
            week52Low,
            source: "yahoo",
            asOf: Date.now(),
          }
        : null;

    return { consensus, valuation };
  } catch {
    return null;
  }
}
