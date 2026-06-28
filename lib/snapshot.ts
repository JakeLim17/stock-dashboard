import "server-only";
import { cache } from "react";
import type { HistoricalPoint } from "./providers/yahoo";
import {
  fetchQuote,
  fetchQuotesBatch,
  fetchHistorical,
  computeTech,
  fetchFlowOrMock,
  fetchAllNews,
  fetchNewsForSymbols,
  reclassifyWithTitleKo,
  riskKeywords,
  fetchYahooQuotesBatch,
} from "./providers";
import { translateTitleToKo } from "./news/translation";
import { getConsensusBundle } from "./providers/consensusCache";
import { getMarketAlertCached } from "./providers/marketAlertCache";
import { isKrStock } from "./providers/naver";
import { fetchIntradayBars, isKrMarketOpen } from "./providers/naverIntraday";
import { kisEnabled } from "./providers/kis";
import {
  fetchEventsForSymbol,
  getMacroEventsCached,
} from "./providers/eventCalendar";
import {
  getCuratedMacroUpcoming,
  getCuratedUpcomingForSymbol,
} from "./monthly-schedule";
import { dedupeEventItems } from "./schedule-dedup";
import {
  analyze,
  marketMoodLabel,
  predict,
  assessVolatility,
  computeIntradayMetrics,
  evaluateSignalMarks,
  pickTopSignalMarks,
} from "./analyzer";
import { dailySigmaFromCloses } from "./analyzer/statHelpers";
import {
  assessDataQuality,
  applyThinHistoryAnalysisGate,
  applyThinHistoryPredictionGate,
} from "./analyzer/dataQuality";
import { assessNewsRisk } from "./news/riskScore";
import { assessOpportunity } from "./news/opportunityScore";
import { getAnalysisCache } from "./analysisCache";
import { saveQuote, saveFlow, saveTech, saveAnalysis, saveNews } from "./db";
import {
  PRIMARY_SYMBOLS,
  MARKET_INDICATORS,
  getOverseasNightProxy,
  resolveWatchSymbols,
} from "./symbols";
import type {
  AnalysisResult,
  DashboardSnapshot,
  EventItem,
  FlowData,
  MarketIndicator,
  NewsItem,
  OverseasNightIndicator,
  Quote,
  Predictions,
  SymbolMeta,
  StockSnapshot,
  TechIndicators,
} from "./types";

export interface BuildSnapshotOptions {
  includeOverseasNight?: boolean;
}

// Phase A(lite) 카드용 — 분석·예측·수급 전 도착 시 UI placeholder.
const PENDING_ANALYSIS: AnalysisResult = {
  shortTerm: {
    signal: "HOLD",
    headline: "분석 중…",
    reasons: [],
    score: 50,
  },
  longTerm: {
    signal: "HOLD",
    headline: "분석 중…",
    reasons: [],
    score: 50,
  },
  externalRisk: { level: "low", score: 0, drivers: [], matchCount: 0 },
  verdict: {
    action: "HOLD",
    label: "분석 중",
    headline: "가격 변동·수급 분석 중…",
    tone: "hold",
    detail: "",
  },
  signal: "HOLD",
  heatScore: 50,
  buyScore: 50,
  headline: "가격 변동·수급 분석 중…",
  reasons: [],
};

const PENDING_FLOW: FlowData = {
  foreignNet: null,
  institutionNet: null,
  individualNet: null,
};

const PENDING_TECH: TechIndicators = {
  trend: "sideways",
  heat: 50,
};

// 시장 분위기·반도체 과열도 계산에 쓰이는 컨텍스트.
// fetchMarketIndicators() 결과로 자동 도출되며, 이후 fetchWatchlistSnapshots()의
// 종목 분석/예측에 그대로 전달돼 일관된 시장 컨텍스트를 유지한다.
export interface MarketContextSnapshot {
  // 0~100 — SOX·NVDA 기반. 두 데이터 중 하나라도 빠지면 null (UI "—" 표시).
  semiHeat: number | null;
  nasdaqRate: number;
  fxRate: number;
  vix: number;
  kospiRate: number;
  soxRate: number;
}

// 매크로 히스토리 재사용 — watchlist 가 동일 심볼 90일치를 다시 fetch 하지 않도록.
const WATCHLIST_MACRO_CODES = [
  "NQ=F",
  "KRW=X",
  "^IXIC",
  "^KS11",
  "^SOX",
  "DX-Y.NYB",
  "^TNX",
] as const;

export interface MarketIndicatorsResult {
  indicators: MarketIndicator[];
  errors: Record<string, string>;
  context: MarketContextSnapshot;
  // 환율(KRW=X) — 해외 야간 지표 계산에 재사용. 없으면 null.
  usdKrw: number | null;
  /** 90일 일봉 — predictor 매크로 회귀 입력. watchlist 와 공유해 중복 fetch 방지. */
  macroHistories: Partial<Record<(typeof WATCHLIST_MACRO_CODES)[number], HistoricalPoint[]>>;
}

export interface WatchlistSnapshotsResult {
  primaries: StockSnapshot[];
  errors: Record<string, string>;
}

export interface WatchlistDeps {
  indicators?: MarketIndicator[];
  news?: NewsItem[];
  context?: MarketContextSnapshot;
  usdKrw?: number | null;
  macroHistories?: MarketIndicatorsResult["macroHistories"];
  options?: BuildSnapshotOptions;
}

// ──────────────────────────────────────────────────────────────
// 스탬피드 가드 — 동일 결과를 짧은 시간 안에 여러 클라이언트가 동시에 요청하면
// Yahoo 28개 + 종목별 fanout 이 곱빼기로 발생해 24초 latency 가 생기는 원인.
// snapshot/indicator 둘 다 같은 패턴(`consensusCache.ts`)의 in-flight + soft TTL.
// ──────────────────────────────────────────────────────────────

// 시장 지표 — 60s TTL (Vercel 절감, CDN s-maxage와 맞춤).
const MARKET_INDICATOR_TTL_MS = 60_000;
type MarketIndicatorCache = { data: MarketIndicatorsResult; at: number };
let marketIndicatorCache: MarketIndicatorCache | null = null;
let marketIndicatorInFlight: Promise<MarketIndicatorsResult> | null = null;

// 풀 스냅샷 — 60s TTL. CDN s-maxage(600s)보다 짧게 — 동일 인스턴스 내 중복만 막음.
const SNAPSHOT_TTL_MS = 60_000;
type SnapshotCache = { data: DashboardSnapshot; at: number };
const snapshotCache = new Map<string, SnapshotCache>();
const snapshotInFlight = new Map<string, Promise<DashboardSnapshot>>();

// ──────────────────────────────────────────────────────────────
// 1) 시장 지표 — 빠른 영역 (1-2초). SummaryBar / MarketPanel 1차 채움용.
//    Suspense streaming 단계 중 가장 먼저 도착한다.
// ──────────────────────────────────────────────────────────────
async function fetchMarketIndicatorsCore(): Promise<MarketIndicatorsResult> {
  const errors: Record<string, string> = {};
  // 시세 batch + 모든 인디케이터 일별 close history(최근 90영업일)를 병렬로.
  // history는 (1) KRW=X 변동성 σ 계산, (2) Sparkline(-30), (3) watchlist 매크로 회귀에 재사용.
  const INDICATOR_HISTORY_DAYS = 90;
  const [indicatorResults, historyResults] = await Promise.all([
    fetchYahooQuotesBatch(MARKET_INDICATORS),
    Promise.all(
      MARKET_INDICATORS.map((meta) =>
        fetchHistorical(meta.code, INDICATOR_HISTORY_DAYS).catch(() => [])
      )
    ),
  ]);
  const historyMap = new Map<string, number[]>();
  const macroHistories: MarketIndicatorsResult["macroHistories"] = {};
  for (let i = 0; i < MARKET_INDICATORS.length; i++) {
    const meta = MARKET_INDICATORS[i];
    const hist = historyResults[i];
    const closes = hist
      .map((p) => p.close)
      .filter((v) => Number.isFinite(v) && v > 0);
    historyMap.set(meta.code, closes);
    if (
      (WATCHLIST_MACRO_CODES as readonly string[]).includes(meta.code) &&
      hist.length > 0
    ) {
      macroHistories[meta.code as (typeof WATCHLIST_MACRO_CODES)[number]] = hist;
    }
  }
  const indicators: MarketIndicator[] = [];

  // KRW=X 변동성 — 일별 close → 로그수익률 → 1개월(EWMA) / 1주(표본 stddev) σ%.
  // σ는 단위 % / day. 한 줄에 2개를 보여줘 사용자가 "최근 변동성 안정/확대"를 직관 파악.
  const fxCloses = historyMap.get("KRW=X") ?? [];
  const fxVolatility = (() => {
    if (fxCloses.length < 6) return null;
    const sigma30 = dailySigmaFromCloses(fxCloses.slice(-22)); // 약 1개월 거래일
    // 1주(직전 5거래일) 표본 표준편차 — 짧은 윈도우엔 단순 stddev가 직관적.
    const recent = fxCloses.slice(-6);
    const r1w: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      const p = recent[i - 1];
      const c = recent[i];
      if (p > 0 && c > 0) r1w.push(Math.log(c / p));
    }
    const mu1w = r1w.length > 0 ? r1w.reduce((a, b) => a + b, 0) / r1w.length : 0;
    const var1w =
      r1w.length > 1
        ? r1w.reduce((acc, x) => acc + (x - mu1w) ** 2, 0) / (r1w.length - 1)
        : 0;
    const sigma1w = Math.sqrt(Math.max(var1w, 0));

    if (sigma30 <= 0 && sigma1w <= 0) return null;
    const pct30 = sigma30 * 100;
    const pct1w = sigma1w * 100;
    return {
      window: "1m" as const,
      sigmaPct: pct30,
      label: `σ(1M) ${pct30.toFixed(2)}% / day`,
      secondaryWindow: "1w" as const,
      secondarySigmaPct: pct1w,
    };
  })();

  for (let i = 0; i < indicatorResults.length; i++) {
    const r = indicatorResults[i];
    const meta = MARKET_INDICATORS[i];
    if (!r.ok) {
      errors[meta.code] = r.error;
      continue;
    }
    const q = r.quote;
    saveQuote(q);
    const closeHistory = historyMap.get(meta.code) ?? [];
    indicators.push({
      code: meta.code,
      name: meta.name,
      value: q.price,
      changeRate: q.changeRate,
      status: indicatorStatus(meta.code, q.changeRate, q.price),
      hint: indicatorHint(meta.code, q.changeRate),
      priceTime: q.priceTime ?? null,
      marketState: q.marketState,
      changeAbs: q.changeAbs ?? null,
      prevClose: q.prevClose ?? null,
      dayHigh: q.high ?? null,
      dayLow: q.low ?? null,
      volatility: meta.code === "KRW=X" ? fxVolatility : null,
      // 최근 30영업일치만 잘라 응답 크기 절감 (Sparkline에 충분).
      closeHistory: closeHistory.length >= 2 ? closeHistory.slice(-30) : undefined,
    });
  }

  const sox = indicators.find((i) => i.code === "^SOX");
  const nvda = indicators.find((i) => i.code === "NVDA");
  const kospi = indicators.find((i) => i.code === "^KS11");
  const nq = indicators.find((i) => i.code === "NQ=F");
  const fx = indicators.find((i) => i.code === "KRW=X");
  const vix = indicators.find((i) => i.code === "^VIX");

  // 반도체 과열도 = SOX + NVDA 평균을 0~100으로 환산 (1% 변동 → ±15점).
  // ⚠ 데이터 결손 시 0 으로 떨어뜨리지 않고 null 반환 — Vercel 에서 Yahoo SOX/NVDA 가
  //    빈 응답이면 과거엔 "과열도 0/100" 으로 굳어 보였음. SummaryBar 는 null 시 "—" 표시.
  const soxRate = sox?.changeRate;
  const nvdaRate = nvda?.changeRate;
  const semiHeat: number | null =
    typeof soxRate === "number" && typeof nvdaRate === "number"
      ? Math.max(
          0,
          Math.min(100, Math.round(50 + ((soxRate + nvdaRate) / 2) * 1500))
        )
      : null;

  return {
    indicators,
    errors,
    context: {
      semiHeat,
      nasdaqRate: nq?.changeRate ?? 0,
      fxRate: fx?.changeRate ?? 0,
      vix: vix?.value ?? 15,
      kospiRate: kospi?.changeRate ?? 0,
      soxRate: soxRate ?? 0,
    },
    usdKrw: fx?.value ?? null,
    macroHistories,
  };
}

// fetchMarketIndicators 의 외부 노출 진입점 — 5s soft TTL + in-flight dedup 적용.
// Suspense streaming 진입과 client polling /api/snapshot 의 indicator 부분이
// 같은 인스턴스에서 동시 fanout 되는 사고를 막는다.
export async function fetchMarketIndicators(): Promise<MarketIndicatorsResult> {
  const now = Date.now();
  if (marketIndicatorCache && now - marketIndicatorCache.at < MARKET_INDICATOR_TTL_MS) {
    return marketIndicatorCache.data;
  }
  if (marketIndicatorInFlight) return marketIndicatorInFlight;
  const p = fetchMarketIndicatorsCore()
    .then((data) => {
      marketIndicatorCache = { data, at: Date.now() };
      return data;
    })
    .finally(() => {
      marketIndicatorInFlight = null;
    });
  marketIndicatorInFlight = p;
  return p;
}

// ──────────────────────────────────────────────────────────────
// 2) 뉴스 — 빠른 영역 (1-2초). NewsPanel + externalRisk 입력.
// ──────────────────────────────────────────────────────────────
export async function fetchNewsItems(limit = 60): Promise<NewsItem[]> {
  const news = await fetchAllNews(limit);
  if (news.length > 0) {
    try {
      saveNews(news);
    } catch {
      /* 메모리 DB 등 — 무시 */
    }
  }
  return news;
}

// 시장 전반 뉴스 + 워치리스트 종목별 뉴스를 합쳐서 dedup.
// - 각 종목 fetchNewsForSymbol → titleKo(번역) 까지 채워진 풍부한 결과.
// - 합본 후 시간 역순 정렬, id/제목 정규화 dedup, limit 컷.
// - 종목별 fetch 는 5s hard-timeout — cold start 시 응답 지연 방지. 실패하면 시장 전반만 반환.
//
// 응답 크기 ~250 KB 미만으로 유지하려고 limit 기본 80 — 상위 60(전역) + 종목별 합본.
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutP = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, timeoutP]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeTitleKey(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

// 영문 제목 → 한국어 번역. 시간 예산(ms) 안에서 직렬 처리.
// translateTitleToKo 자체에 1.1s 쓰로틀 + 24h 캐시가 있어, 캐시 히트는 즉시 반환.
// 첫 콜드 호출은 N개 × 1.1s 까지 늘어날 수 있어 budget 초과 시 즉시 중단 → 다음
// 폴링 사이클에서 캐시가 점진적으로 채워진다.
async function enrichTitleKoWithBudget(
  items: NewsItem[],
  budgetMs: number
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (const it of items) {
    if (Date.now() >= deadline) break;
    if (it.titleKo) continue;
    if (!it.title) continue;
    // looksKorean 휴리스틱: 한글 음절 1자라도 있으면 번역 스킵.
    if (/[\uAC00-\uD7A3]/.test(it.title)) continue;
    try {
      const ko = await translateTitleToKo(it.title);
      if (ko && ko !== it.title) it.titleKo = ko;
    } catch {
      /* 개별 실패는 무시 — 다음 사이클에서 재시도 */
    }
  }
}

export async function fetchNewsItemsWithSymbols(
  watchlistCodes: string[],
  baseLimit = 60,
  perSymbolLimit = 8,
  totalLimit = 80
): Promise<NewsItem[]> {
  const [marketNews, perSymbol] = await Promise.all([
    fetchAllNews(baseLimit),
    withTimeout(
      fetchNewsForSymbols(watchlistCodes, {
        maxItems: perSymbolLimit,
        withinHours: 24,
      }),
      5000,
      {} as Record<string, NewsItem[]>
    ).catch(() => ({} as Record<string, NewsItem[]>)),
  ]);

  // ⚠ 머지 순서 중요: per-symbol(번역 완료 titleKo 포함)을 먼저, 글로벌(영어 원문)을 뒤로.
  // 후속 sort가 stable 이라 publishedAt 동률인 동일 기사에서 per-symbol 버전이 살아남고
  // dedup(seenIds/seenTitles) 가 글로벌 버전을 스킵 → 한국어 titleKo 가 그대로 보존된다.
  const merged: NewsItem[] = [];
  for (const code of watchlistCodes) {
    const items = perSymbol[code] ?? [];
    merged.push(...items);
  }
  merged.push(...marketNews);

  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const dedup: NewsItem[] = [];
  for (const n of merged.sort((a, b) => b.publishedAt - a.publishedAt)) {
    if (seenIds.has(n.id)) continue;
    const titleKey = normalizeTitleKey(n.title);
    if (seenTitles.has(titleKey)) continue;
    seenIds.add(n.id);
    seenTitles.add(titleKey);
    dedup.push(n);
    if (dedup.length >= totalLimit) break;
  }

  // 영문 글로벌 헤드라인 보강 — 상위 N개에 대해 시간 예산 안에서 번역.
  // 첫 cold 호출은 ~5s 안에서 가능한 만큼만 채우고, 나머지는 다음 폴링 사이클에서
  // translateTitleToKo 의 24h 캐시 hit 으로 즉시 채워진다.
  await enrichTitleKoWithBudget(dedup.slice(0, 30), 5000);
  // Round 4: titleKo 가 채워진 항목 중 neutral/null 이었던 sentiment 를 재분류.
  //   영문 원문 사전이 빈약할 수 있어 한국어 번역본을 함께 검사하면 분류율이 크게 ↑.
  //   이미 호재/악재인 항목은 보존(번역 노이즈로 흔들림 방지).
  reclassifyWithTitleKo(dedup);

  if (dedup.length > 0) {
    try {
      saveNews(dedup);
    } catch {
      /* 무시 */
    }
  }
  return dedup;
}

// ──────────────────────────────────────────────────────────────
// React.cache로 한 SSR request 내 중복 호출 제거.
//   - app/page.tsx에서 first-paint RSC들이 같은 데이터를 await하더라도 1번만 fetch
//   - buildSnapshot도 동일 cached 버전 사용 → DashboardLoader와 first-paint slot이 fetch 공유
//   - 클라이언트 polling이 /api/snapshot으로 호출하는 buildSnapshot은 매 request 별로 새 캐시
//     스코프라 polling 신선도에 영향 없음
// ──────────────────────────────────────────────────────────────
export const cachedMarketIndicators = cache(fetchMarketIndicators);
export const cachedNewsItems = cache(() => fetchNewsItems(60));

// ──────────────────────────────────────────────────────────────
// 3) 매크로 이벤트 — 즉시 (24h 메모리 캐시). FOMC·KOSPI 만기·KRX 휴장.
// ──────────────────────────────────────────────────────────────
export function fetchMacroEvents(): EventItem[] {
  const now = Date.now();
  const lower = now - 86_400_000;
  const upper = now + 60 * 86_400_000;
  const macro = getMacroEventsCached().filter(
    (e) => e.date >= lower && e.date <= upper
  );
  const curated = getCuratedMacroUpcoming(60);
  return dedupeEventItems([...macro, ...curated]);
}

// ──────────────────────────────────────────────────────────────
// 4) marketMood 조립 — indicators + news 둘 다 있어야 가능.
//    별도 함수로 두면 page.tsx에서 두 데이터가 도착하는 시점에 호출 가능.
// ──────────────────────────────────────────────────────────────
export function buildMarketMood(
  indicators: MarketIndicator[],
  news: NewsItem[],
  semiHeat: number | null
): DashboardSnapshot["marketMood"] {
  return {
    label: marketMoodLabel(indicators),
    semiHeat,
    riskKeywords: riskKeywords(news),
  };
}

// ──────────────────────────────────────────────────────────────
// 5) 관심 종목 분석 — 가장 느린 영역 (3-5초).
//    indicators / news / context 가 없으면 내부에서 직접 fetch한다(독립 호출 가능).
//    있으면 그대로 재사용 (buildSnapshot 등 합성 호출에서 중복 방지).
// ──────────────────────────────────────────────────────────────
export async function fetchWatchlistSnapshots(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  deps: WatchlistDeps = {}
): Promise<WatchlistSnapshotsResult> {
  const errors: Record<string, string> = {};
  const watchSymbols: SymbolMeta[] = resolveWatchSymbols(requestedSymbols);
  const includeOverseasNight = deps.options?.includeOverseasNight === true;

  // indicators / news / context 가 없으면 자체 fetch (독립 호출 시 안전망).
  let indicators = deps.indicators;
  let context = deps.context;
  let usdKrw = deps.usdKrw ?? null;
  if (!indicators || !context) {
    const r = await fetchMarketIndicators();
    indicators = r.indicators;
    context = r.context;
    usdKrw = r.usdKrw;
    Object.assign(errors, r.errors);
  }

  const newsAllPromise: Promise<NewsItem[]> = deps.news
    ? Promise.resolve(deps.news)
    : fetchNewsItems(30).catch((e) => {
        errors["news"] = e instanceof Error ? e.message : String(e);
        return [] as NewsItem[];
      });

  // 베타 시나리오용 시장 시계열 — indicators 단계에서 이미 받은 90일 히스토리 재사용.
  const mh = deps.macroHistories;
  const histOrFetch = async (
    code: (typeof WATCHLIST_MACRO_CODES)[number]
  ): Promise<HistoricalPoint[]> => {
    const cached = mh?.[code];
    if (cached && cached.length >= 30) return cached;
    return fetchHistorical(code, 90).catch(() => []);
  };

  const [
    nasdaqHistory,
    fxHistory,
    ixicHistory,
    kospiHistory,
    soxHistory,
    dxyHistoryPrimary,
    us10yHistory,
    eurUsdQuote,
    newsAll,
  ] = await Promise.all([
    histOrFetch("NQ=F"),
    histOrFetch("KRW=X"),
    histOrFetch("^IXIC"),
    histOrFetch("^KS11"),
    histOrFetch("^SOX"),
    histOrFetch("DX-Y.NYB"),
    histOrFetch("^TNX"),
    includeOverseasNight
      ? fetchQuote("EURUSD=X", "유로/달러").catch((e) => {
          errors["EURUSD=X"] = e instanceof Error ? e.message : String(e);
          return null;
        })
      : Promise.resolve(null),
    newsAllPromise,
  ]);
  // DX-Y.NYB 가 빈 배열이면 선물 DX=F 로 폴백 (분 단위 응답이라 일별 close 신선도는 약간 낮으나 방향성은 동일).
  const dxyHistory =
    dxyHistoryPrimary.length >= 30
      ? dxyHistoryPrimary
      : await fetchHistorical("DX=F", 90).catch(() => []);

  // VIX 현재값은 indicators 에서 추출 (cachedMarketIndicators 결과가 deps 로 전달됨).
  const vixIndicator = indicators.find((i) => i.code === "^VIX");
  const us10yIndicator = indicators.find((i) => i.code === "^TNX");
  const vix = vixIndicator?.value ?? null;
  const us10y = us10yIndicator?.value ?? null;
  const eurUsd = eurUsdQuote?.price ?? null;

  const primaries: StockSnapshot[] = [];
  const primaryResults = await Promise.allSettled(
    watchSymbols.map(async (meta) => {
      const [
        quoteRes,
        hist,
        bundle,
        marketAlert,
        upcomingEvents,
      ] = await Promise.all([
        fetchQuotesBatch([meta]).then((r) => r[0]),
        fetchHistorical(meta.code, 90),
        getConsensusBundle(meta.code).catch(() => ({
          consensus: null,
          valuation: null,
          researches: [],
        })),
        isKrStock(meta.code)
          ? getMarketAlertCached(meta.code).catch(() => null)
          : Promise.resolve(null),
        fetchEventsForSymbol(meta).catch(() => []),
      ]);

      const upcomingEventsMerged = dedupeEventItems([
        ...upcomingEvents,
        ...getCuratedUpcomingForSymbol(meta.code, 90),
      ]);

      if (!quoteRes.ok) throw new Error(quoteRes.error);
      const quote: typeof quoteRes.quote = {
        ...quoteRes.quote,
        marketAlert,
      };

      // 컨센서스 upsidePercent는 캐시 시점 가격 기준이라 매번 재계산 — 룰/UI가 같은 값을 보도록.
      const consensus = bundle.consensus
        ? {
            ...bundle.consensus,
            upsidePercent:
              bundle.consensus.targetMean != null && quote.price > 0
                ? bundle.consensus.targetMean / quote.price - 1
                : null,
            domesticUpsidePercent:
              bundle.consensus.domesticMean != null && quote.price > 0
                ? bundle.consensus.domesticMean / quote.price - 1
                : null,
            globalUpsidePercent:
              bundle.consensus.globalMean != null && quote.price > 0
                ? bundle.consensus.globalMean / quote.price - 1
                : null,
          }
        : null;
      const consensusValuation = bundle.valuation;
      const researches = bundle.researches;

      const overseasNight = includeOverseasNight
        ? await fetchOverseasNightIndicator(
            meta,
            quote,
            usdKrw,
            eurUsd
          ).catch((e) => {
            errors[`night:${meta.code}`] =
              e instanceof Error ? e.message : String(e);
            return null;
          })
        : null;

      const flowRes = await fetchFlowOrMock(meta.code, quote.price);
      const tech = computeTech(hist);
      const flow = { ...flowRes.flow, fetchedAt: quote.fetchedAt };

      // 한국 종목 + 정규장 진행 중일 때만 1분봉 호출 (TTL 60s 캐시).
      const intradayBars =
        isKrStock(meta.code) && isKrMarketOpen()
          ? await fetchIntradayBars(meta.code).catch(() => null)
          : null;
      const intradayMetrics = intradayBars
        ? computeIntradayMetrics(intradayBars)
        : null;

      // 종목 + 시장 전반 뉴스를 합쳐 외부 리스크 평가.
      const relatedNews = newsAll.filter(
        (n) =>
          n.symbol === meta.code ||
          (n.title || "").includes(meta.name) ||
          n.symbol == null
      );
      const externalRisk = assessNewsRisk(relatedNews);
      const externalOpportunity = assessOpportunity(
        newsAll,
        meta.code,
        meta.name
      );

      const dataQuality = assessDataQuality({
        code: meta.code,
        historyLength: hist.length,
        flow,
      });
      const cachedAnalysis = getAnalysisCache(meta.code);

      let analysis: AnalysisResult;
      let predictions: Predictions | null;

      if (cachedAnalysis) {
        analysis = cachedAnalysis.analysis;
        predictions = cachedAnalysis.predictions;
      } else {
        const analysisRaw = analyze({
          quote,
          tech,
          flow,
          consensus,
          valuation: consensusValuation,
          externalRisk,
          externalOpportunity,
          context: {
            ...context!,
            overseasNightRate: overseasNight?.changeRate ?? null,
          },
          history: hist,
        });
        analysis = applyThinHistoryAnalysisGate(analysisRaw, dataQuality);
        const volatility = assessVolatility({
          history: hist,
          flow,
          todayChangeRate: quote.changeRate,
          intraday: intradayMetrics,
        });
        analysis.volatility = volatility;
        if (volatility.level === "gambling" || volatility.level === "high") {
          const top = volatility.drivers[0]?.label;
          const tag =
            volatility.level === "gambling"
              ? `도박장 ⚠ 변동성 ${volatility.score}`
              : `고변동 변동성 ${volatility.score}`;
          analysis.shortTerm.reasons = [
            `· ${tag}${top ? ` · ${top}` : ""}`,
            ...analysis.shortTerm.reasons,
          ].slice(0, 3);
          analysis.reasons = analysis.shortTerm.reasons;
        }
        const eventsForVolatility: EventItem[] = [
          ...upcomingEventsMerged,
          ...getMacroEventsCached(),
        ];
        predictions = predict({
          quote,
          history: hist,
          nasdaqHistory,
          fxHistory,
          ixicHistory,
          kospiHistory,
          soxHistory,
          dxyHistory,
          us10yHistory,
          vix,
          us10y,
          meta,
          buyScore: analysis.buyScore,
          heatScore: analysis.heatScore,
          overseasNight,
          intradayDailyVol: intradayMetrics?.parkinsonDaily ?? null,
          events: eventsForVolatility,
          todayChangeRate: quote.changeRate,
          momentumActive: !!analysis.verdict.momentumOverride,
        });
        predictions = applyThinHistoryPredictionGate(predictions, dataQuality);
        if (predictions?.targets) {
          const REDUCE_ACTIONS = new Set(["REDUCE", "TRIM", "AVOID"]);
          if (REDUCE_ACTIONS.has(analysis.verdict.action)) {
            const t = predictions.targets;
            if (
              t.entry > 0 &&
              (t.takeProfit1 >= t.entry * 1.03 ||
                t.takeProfit2 >= t.entry * 1.03)
            ) {
              predictions.targets = { ...t, suppressed: true };
            }
          }
        }
        saveAnalysis(meta.code, quote.fetchedAt, analysis);
      }

      saveQuote(quote);
      saveFlow(meta.code, quote.fetchedAt, flow);
      saveTech(meta.code, quote.fetchedAt, tech);

      const signalMarks = pickTopSignalMarks(
        evaluateSignalMarks({
          quote,
          history: hist,
          flow,
          valuation: consensusValuation,
          upcomingEvents: upcomingEventsMerged,
        }),
        4
      );
      const closeHistory = hist
        .map((p) => p.close)
        .filter((v) => Number.isFinite(v) && v > 0)
        .slice(-30);

      return {
        meta,
        quote,
        tech,
        flow,
        analysis,
        overseasNight,
        predictions,
        consensus,
        consensusValuation,
        researches,
        signalMarks,
        upcomingEvents: upcomingEventsMerged,
        programTrade: null,
        shortBalance: null,
        closeHistory: closeHistory.length >= 2 ? closeHistory : undefined,
        dataQuality,
        marketContext: {
          semiHeat: context!.semiHeat,
          nasdaqRate: context!.nasdaqRate,
          fxRate: context!.fxRate,
          vix: context!.vix,
          kospiRate: context!.kospiRate,
          soxRate: context!.soxRate,
        },
        analysisCachedAt: cachedAnalysis?.cachedAt ?? null,
      };
    })
  );

  for (let i = 0; i < primaryResults.length; i++) {
    const r = primaryResults[i];
    if (r.status === "fulfilled") {
      primaries.push(r.value);
    } else {
      errors[watchSymbols[i].code] =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  }

  return { primaries, errors };
}

// ──────────────────────────────────────────────────────────────
// Phase A — 시세 우선 경량 스냅샷 (1~3초 목표).
//   indicators(cached) + watchlist quote batch 만. 분석·뉴스·예측·수급 fanout 제외.
// ──────────────────────────────────────────────────────────────
async function buildSnapshotLiteCore(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  _options: BuildSnapshotOptions = {}
): Promise<DashboardSnapshot> {
  const errors: Record<string, string> = {};
  const watchSymbols = resolveWatchSymbols(requestedSymbols);
  const indicatorResult = await cachedMarketIndicators();
  Object.assign(errors, indicatorResult.errors);

  const quoteResults = await fetchQuotesBatch(watchSymbols);
  const primaries: StockSnapshot[] = [];

  for (let i = 0; i < watchSymbols.length; i++) {
    const meta = watchSymbols[i];
    const qr = quoteResults[i];
    if (!qr.ok) {
      errors[meta.code] = qr.error;
      continue;
    }
    saveQuote(qr.quote);
    primaries.push({
      meta,
      quote: qr.quote,
      flow: PENDING_FLOW,
      tech: PENDING_TECH,
      analysis: PENDING_ANALYSIS,
      predictions: null,
      consensus: null,
      consensusValuation: null,
      researches: [],
      signalMarks: [],
      upcomingEvents: [],
      programTrade: null,
      shortBalance: null,
    });
  }

  return {
    generatedAt: Date.now(),
    phase: "lite",
    primaries,
    indicators: indicatorResult.indicators,
    marketMood: buildMarketMood(
      indicatorResult.indicators,
      [],
      indicatorResult.context.semiHeat
    ),
    news: [],
    errors,
    macroEvents: fetchMacroEvents(),
    kisActive: kisEnabled(),
  };
}

const LITE_SNAPSHOT_TTL_MS = 40_000;
type LiteSnapshotCache = { data: DashboardSnapshot; at: number };
const liteSnapshotCache = new Map<string, LiteSnapshotCache>();
const liteSnapshotInFlight = new Map<string, Promise<DashboardSnapshot>>();

function liteSnapshotKey(
  symbols: string[],
  options: BuildSnapshotOptions
): string {
  const normalized = Array.from(new Set(symbols)).sort().join(",");
  return `lite:${normalized}|night=${options.includeOverseasNight ? "1" : "0"}`;
}

export async function buildSnapshotLite(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  options: BuildSnapshotOptions = {}
): Promise<DashboardSnapshot> {
  const key = liteSnapshotKey(requestedSymbols, options);
  const now = Date.now();
  const hit = liteSnapshotCache.get(key);
  if (hit && now - hit.at < LITE_SNAPSHOT_TTL_MS) return hit.data;
  const inflight = liteSnapshotInFlight.get(key);
  if (inflight) return inflight;
  const p = buildSnapshotLiteCore(requestedSymbols, options)
    .then((data) => {
      liteSnapshotCache.set(key, { data, at: Date.now() });
      if (liteSnapshotCache.size > 64) {
        const firstKey = liteSnapshotCache.keys().next().value;
        if (firstKey !== undefined) liteSnapshotCache.delete(firstKey);
      }
      return data;
    })
    .finally(() => {
      liteSnapshotInFlight.delete(key);
    });
  liteSnapshotInFlight.set(key, p);
  return p;
}

// ──────────────────────────────────────────────────────────────
// 기존 호환 — 메인 대시보드 1회 분의 통합 스냅샷.
//   indicators + news 를 병렬로 받고 → watchlist 분석에 deps로 주입.
//   외부 인터페이스(반환 shape)는 종전과 동일.
// ──────────────────────────────────────────────────────────────
export async function buildSnapshot(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  options: BuildSnapshotOptions = {}
): Promise<DashboardSnapshot> {
  // 뉴스 실패는 치명적이지 않음 — 빈 배열로 진행. 호출자가 별도 fetch 시도해도 무방.
  // cached* 사용 — page.tsx의 first-paint RSC가 동일 request 내에서 먼저 호출했다면
  // 그 결과를 그대로 재사용 (Promise dedup으로 외부 호출 1회).
  // 단계별 타이밍 (BUILD_SNAPSHOT_TIMING=1 일 때만 stderr 로 출력 — dev 진단용).
  const TIMING = process.env.BUILD_SNAPSHOT_TIMING === "1";
  const t0 = TIMING ? performance.now() : 0;
  // 뉴스 — 시장 전반 + 워치리스트 종목별 통합. 종목별 fetch 는 5s timeout 으로
  // cold start 응답 지연을 막는다. 실패해도 시장 전반 뉴스만으로 진행.
  const watchSymbolsForNews = resolveWatchSymbols(requestedSymbols).map(
    (s) => s.code
  );
  const [indicatorResult, news] = await Promise.all([
    cachedMarketIndicators(),
    fetchNewsItemsWithSymbols(watchSymbolsForNews, 60, 8, 80).catch(
      () => [] as NewsItem[]
    ),
  ]);
  const t1 = TIMING ? performance.now() : 0;

  const watchResult = await fetchWatchlistSnapshots(requestedSymbols, {
    indicators: indicatorResult.indicators,
    news,
    context: indicatorResult.context,
    usdKrw: indicatorResult.usdKrw,
    macroHistories: indicatorResult.macroHistories,
    options,
  });
  const t2 = TIMING ? performance.now() : 0;
  if (TIMING) {
    console.warn(
      `[snapshot] indicators+news=${(t1 - t0).toFixed(0)}ms watchlist=${(t2 - t1).toFixed(0)}ms total=${(t2 - t0).toFixed(0)}ms news=${news.length} primaries=${watchResult.primaries.length}`
    );
  }

  const errors = { ...indicatorResult.errors, ...watchResult.errors };

  return {
    generatedAt: Date.now(),
    phase: "full",
    primaries: watchResult.primaries,
    indicators: indicatorResult.indicators,
    marketMood: buildMarketMood(
      indicatorResult.indicators,
      news,
      indicatorResult.context.semiHeat
    ),
    news,
    errors,
    macroEvents: fetchMacroEvents(),
    kisActive: kisEnabled(),
  };
}

// ──────────────────────────────────────────────────────────────
// buildSnapshotShared — `/api/snapshot` 전용 in-flight dedup + 2s TTL.
//   동일 symbols + 옵션을 짧은 시간 안에 여러 클라이언트가 호출하면
//   직전 응답을 그대로 반환해 fanout 비용을 한 번으로 압축한다.
//   refresh=1 처럼 캐시 우회가 필요하면 buildSnapshot 을 직접 호출.
// ──────────────────────────────────────────────────────────────
function snapshotKey(symbols: string[], options: BuildSnapshotOptions): string {
  const normalized = Array.from(new Set(symbols)).sort().join(",");
  return `${normalized}|night=${options.includeOverseasNight ? "1" : "0"}`;
}

export async function buildSnapshotShared(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  options: BuildSnapshotOptions = {}
): Promise<DashboardSnapshot> {
  const key = snapshotKey(requestedSymbols, options);
  const now = Date.now();
  const hit = snapshotCache.get(key);
  if (hit && now - hit.at < SNAPSHOT_TTL_MS) return hit.data;
  const inflight = snapshotInFlight.get(key);
  if (inflight) return inflight;
  const p = buildSnapshot(requestedSymbols, options)
    .then((data) => {
      snapshotCache.set(key, { data, at: Date.now() });
      // 메모리 가드 — symbol 조합이 폭증해도 64 entry 까지만 유지.
      if (snapshotCache.size > 64) {
        const firstKey = snapshotCache.keys().next().value;
        if (firstKey !== undefined) snapshotCache.delete(firstKey);
      }
      return data;
    })
    .finally(() => {
      snapshotInFlight.delete(key);
    });
  snapshotInFlight.set(key, p);
  return p;
}

// 강제 갱신용 — `/api/snapshot?refresh=1` 진입 시 호출.
export function invalidateSnapshotCache(): void {
  snapshotCache.clear();
  liteSnapshotCache.clear();
  marketIndicatorCache = null;
}

async function fetchOverseasNightIndicator(
  meta: SymbolMeta,
  domesticQuote: Quote,
  usdKrw: number | null,
  eurUsd: number | null
): Promise<OverseasNightIndicator | null> {
  const proxy = getOverseasNightProxy(meta.code);
  if (!proxy) return null;

  const quote = await fetchQuote(proxy.proxyCode, proxy.name);
  if (!quote.price || quote.changeRate == null) return null;
  const currency = quote.currency?.toUpperCase();
  const fxToKrw =
    currency === "KRW"
      ? 1
      : currency === "USD"
        ? usdKrw
        : currency === "EUR" && eurUsd != null && usdKrw != null
          ? eurUsd * usdKrw
          : null;
  const impliedKrwPrice =
    fxToKrw != null ? (quote.price * fxToKrw) / proxy.sharesPerReceipt : null;
  const krxClose =
    domesticQuote.extendedHours?.regularClose ??
    domesticQuote.price ??
    domesticQuote.prevClose ??
    null;
  const premiumRate =
    impliedKrwPrice != null && krxClose != null && krxClose > 0
      ? impliedKrwPrice / krxClose - 1
      : null;

  return {
    baseCode: meta.code,
    proxyCode: proxy.proxyCode,
    name: proxy.name,
    exchange: proxy.exchange,
    sharesPerReceipt: proxy.sharesPerReceipt,
    price: quote.price,
    changeRate: quote.changeRate,
    currency: quote.currency,
    fxToKrw,
    usdKrw,
    eurUsd,
    impliedKrwPrice,
    krxClose,
    premiumRate,
    marketState: quote.marketState,
    priceTime: quote.priceTime,
    fetchedAt: quote.fetchedAt,
  };
}

function indicatorStatus(
  code: string,
  rate: number,
  value: number
): MarketIndicator["status"] {
  if (code === "^VIX") {
    if (value >= 25) return "warn";
    if (value >= 20) return "warn";
  }
  if (rate >= 0.003) return "up";
  if (rate <= -0.003) return "down";
  return "flat";
}

function indicatorHint(code: string, rate: number): string | undefined {
  if (code === "^SOX") {
    if (rate >= 0.01) return "반도체 강세";
    if (rate <= -0.01) return "반도체 약세";
  }
  if (code === "KRW=X") {
    if (rate >= 0.005) return "원화 약세 주의";
    if (rate <= -0.005) return "원화 강세";
  }
  if (code === "^VIX") {
    if (rate >= 0.05) return "변동성 확대";
  }
  if (code === "DX-Y.NYB" || code === "DX=F") {
    if (rate >= 0.005) return "달러 강세 — 수출주 부담";
    if (rate <= -0.005) return "달러 약세 — 수출주 우호";
  }
  if (code === "^TNX") {
    if (rate >= 0.02) return "금리 상승 — 성장주 부담";
    if (rate <= -0.02) return "금리 하락 — 성장주 우호";
  }
  if (code === "RTY=F") {
    if (rate >= 0.01) return "중소형주 강세";
    if (rate <= -0.01) return "중소형주 약세";
  }
  return undefined;
}
