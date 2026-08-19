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
  didNewsFetchFail,
  fetchNewsForSymbols,
  reclassifyWithTitleKo,
  riskKeywords,
  fetchYahooQuotesBatch,
  seedHistoryFromQuote,
} from "./providers";
import { translateTitleToKo } from "./news/translation";
import { getConsensusBundle } from "./providers/consensusCache";
import { getMarketAlertCached } from "./providers/marketAlertCache";
import { isKrStock } from "./providers/naver";
import { fetchIntradayBars, isKrMarketOpen } from "./providers/naverIntraday";
import { kisEnabled } from "./providers/kis";
import { collectExtraAlphaFactors } from "./providers/extraAlpha";
import {
  CORE_SNAPSHOT_TTL_MS,
  FULL_SNAPSHOT_TTL_MS,
  LITE_SNAPSHOT_TTL_MS,
} from "./providers/kisCachePolicy";
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
  getGroupCatalystPeer,
  spilloverLeaderEvents,
} from "./symbol-groups";
import { applyGroupCatalystSpillover } from "./group-catalyst-spillover";
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
import { resolveOvernightProxyRate } from "./analyzer/overnightPassThrough";
import {
  assessDataQuality,
  applyThinHistoryAnalysisGate,
  applyThinHistoryPredictionGate,
} from "./analyzer/dataQuality";
import { assessNewsRisk } from "./news/riskScore";
import { assessOpportunity } from "./news/opportunityScore";
import { getAnalysisCache } from "./analysisCache";
import { saveQuote, saveFlow, saveTech, saveAnalysis, saveNews, recentNews } from "./db";
import {
  PRIMARY_SYMBOLS,
  MARKET_INDICATORS,
  WATCHLIST_CANDIDATES,
  getOverseasNightFallback,
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
  esRate: number;
  ymRate: number;
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
  /**
   * core: 시세+히스토리+수급+컨센+규칙분석 (예측·매크로·공시 skip) — 체감 3s 목표.
   * full: ChronoPulse 예측·뉴스·공시·야간지표 포함.
   */
  mode?: "core" | "full";
}

const EMPTY_MARKET_CONTEXT: MarketContextSnapshot = {
  semiHeat: null,
  nasdaqRate: 0,
  fxRate: 0,
  vix: 0,
  kospiRate: 0,
  soxRate: 0,
  esRate: 0,
  ymRate: 0,
};

// ──────────────────────────────────────────────────────────────
// 스탬피드 가드 — 동일 결과를 짧은 시간 안에 여러 클라이언트가 동시에 요청하면
// Yahoo 28개 + 종목별 fanout 이 곱빼기로 발생해 24초 latency 가 생기는 원인.
// snapshot/indicator 둘 다 같은 패턴(`consensusCache.ts`)의 in-flight + soft TTL.
// ──────────────────────────────────────────────────────────────

// 시장 지표 — lite 폴링(90s)보다 길게. 동일 인스턴스 중복·CDN 흡수.
const MARKET_INDICATOR_TTL_MS = 90_000;
type MarketIndicatorCache = { data: MarketIndicatorsResult; at: number };
let marketIndicatorCache: MarketIndicatorCache | null = null;
let marketIndicatorInFlight: Promise<MarketIndicatorsResult> | null = null;

/** 웜 캐시만 즉시 반환 — core 가 지표 90일 fanout 에 막히지 않게. */
function peekMarketIndicators(): MarketIndicatorsResult | null {
  if (
    marketIndicatorCache &&
    Date.now() - marketIndicatorCache.at < MARKET_INDICATOR_TTL_MS
  ) {
    return marketIndicatorCache.data;
  }
  return null;
}

// 풀 스냅샷 — full 폴링(15분)과 맞춤. 인스턴스 내 중복만 막음 (인증 응답이라 CDN 공유 없음).
const SNAPSHOT_TTL_MS = FULL_SNAPSHOT_TTL_MS;
type SnapshotCache = { data: DashboardSnapshot; at: number };
const snapshotCache = new Map<string, SnapshotCache>();
const snapshotInFlight = new Map<string, Promise<DashboardSnapshot>>();

// ──────────────────────────────────────────────────────────────
// 1) 시장 지표 — 빠른 영역 (1-2초). SummaryBar / MarketPanel 1차 채움용.
//    Suspense streaming 단계 중 가장 먼저 도착한다.
// ──────────────────────────────────────────────────────────────
function buildFxVolatility(
  fxCloses: number[]
): MarketIndicator["volatility"] {
  if (fxCloses.length < 6) return null;
  const sigma30 = dailySigmaFromCloses(fxCloses.slice(-22));
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
}

function assembleMarketIndicatorsResult(
  indicatorResults: Awaited<ReturnType<typeof fetchYahooQuotesBatch>>,
  historyMap: Map<string, number[]>,
  macroHistories: MarketIndicatorsResult["macroHistories"]
): MarketIndicatorsResult {
  const errors: Record<string, string> = {};
  const indicators: MarketIndicator[] = [];
  const fxVolatility = buildFxVolatility(historyMap.get("KRW=X") ?? []);

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
      closeHistory: closeHistory.length >= 2 ? closeHistory.slice(-30) : undefined,
    });
  }

  const sox = indicators.find((i) => i.code === "^SOX");
  const nvda = indicators.find((i) => i.code === "NVDA");
  const kospi = indicators.find((i) => i.code === "^KS11");
  const nq = indicators.find((i) => i.code === "NQ=F");
  const es = indicators.find((i) => i.code === "ES=F");
  const ym = indicators.find((i) => i.code === "YM=F");
  const fx = indicators.find((i) => i.code === "KRW=X");
  const vix = indicators.find((i) => i.code === "^VIX");
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
      esRate: es?.changeRate ?? 0,
      ymRate: ym?.changeRate ?? 0,
    },
    usdKrw: fx?.value ?? null,
    macroHistories,
  };
}

async function fetchMarketIndicatorsCore(): Promise<MarketIndicatorsResult> {
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
  return assembleMarketIndicatorsResult(
    indicatorResults,
    historyMap,
    macroHistories
  );
}

/**
 * lite 전용 — Yahoo 시세 batch 만. 90일 history fanout 없음 (Active CPU 절감).
 * 캐시에 쓰지 않음 — full/core 가 웜한 지표를 오염시키지 않게.
 */
async function fetchMarketIndicatorsQuotesOnly(): Promise<MarketIndicatorsResult> {
  const indicatorResults = await fetchYahooQuotesBatch(MARKET_INDICATORS);
  return assembleMarketIndicatorsResult(indicatorResults, new Map(), {});
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
    return news;
  }
  try {
    const cached = recentNews(limit);
    if (cached.length > 0) return cached;
  } catch {
    /* ignore */
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
      9_000,
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
  await enrichTitleKoWithBudget(dedup.slice(0, 24), 2_000);
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
  const mode = deps.mode ?? "full";
  const isCore = mode === "core";

  // indicators / news / context 가 없으면 자체 fetch (독립 호출 시 안전망).
  // core 는 지표 fanout 을 기다리지 않음 — 빈 컨텍스트로 수급·컨센만 진행.
  let indicators = deps.indicators;
  let context = deps.context;
  let usdKrw = deps.usdKrw ?? null;
  if (!indicators || !context) {
    if (isCore) {
      indicators = indicators ?? [];
      context = context ?? EMPTY_MARKET_CONTEXT;
    } else {
      const r = await fetchMarketIndicators();
      indicators = r.indicators;
      context = r.context;
      usdKrw = r.usdKrw;
      Object.assign(errors, r.errors);
    }
  }

  const newsAllPromise: Promise<NewsItem[]> = deps.news
    ? Promise.resolve(deps.news)
    : isCore
      ? Promise.resolve([] as NewsItem[])
      : fetchNewsItems(30).catch((e) => {
          errors["news"] = e instanceof Error ? e.message : String(e);
          return [] as NewsItem[];
        });

  // core: 매크로 시계열·야간 EUR 을 기다리지 않음 — 예측은 full 에서.
  // full: 베타 시나리오용 시장 시계열 — indicators 단계에서 이미 받은 90일 히스토리 재사용.
  const mh = deps.macroHistories;
  const histOrFetch = async (
    code: (typeof WATCHLIST_MACRO_CODES)[number]
  ): Promise<HistoricalPoint[]> => {
    if (isCore) return [];
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
    !isCore && includeOverseasNight
      ? fetchQuote("EURUSD=X", "유로/달러").catch((e) => {
          errors["EURUSD=X"] = e instanceof Error ? e.message : String(e);
          return null;
        })
      : Promise.resolve(null),
    newsAllPromise,
  ]);
  // DX-Y.NYB 가 빈 배열이면 선물 DX=F 로 폴백 (분 단위 응답이라 일별 close 신선도는 약간 낮으나 방향성은 동일).
  const dxyHistory =
    isCore || dxyHistoryPrimary.length >= 30
      ? dxyHistoryPrimary
      : await fetchHistorical("DX=F", 90).catch(() => []);

  // VIX 현재값은 indicators 에서 추출 (cachedMarketIndicators 결과가 deps 로 전달됨).
  const vixIndicator = indicators.find((i) => i.code === "^VIX");
  const us10yIndicator = indicators.find((i) => i.code === "^TNX");
  const vix = vixIndicator?.value ?? null;
  const us10y = us10yIndicator?.value ?? null;
  const eurUsd = eurUsdQuote?.price ?? null;

  const primaries: StockSnapshot[] = [];
  // core: 수급·컨센·RSI 우선 — 종목당 5s. full: 예측·공시 포함 12s.
  const SYMBOL_BUDGET_MS = isCore ? 5_000 : 12_000;
  const FLOW_TIMEOUT_MS = isCore ? 2_500 : 8_000;
  const CONSENSUS_TIMEOUT_MS = isCore ? 2_500 : 8_000;
  const emptyConsensus = {
    consensus: null,
    valuation: null,
    researches: [] as Awaited<
      ReturnType<typeof getConsensusBundle>
    >["researches"],
  };
  const primaryResults = await Promise.allSettled(
    watchSymbols.map(async (meta) => {
      const work = async (): Promise<StockSnapshot> => {
      // 시세·히스토리·수급·컨센서스를 한 번에 — 예전엔 수급이 이벤트 뒤에 직렬이라 체감 지연.
      const [
        quoteRes,
        histRaw,
        bundle,
        marketAlert,
        upcomingEvents,
        flowEarly,
      ] = await Promise.all([
        fetchQuotesBatch([meta]).then((r) => r[0]),
        fetchHistorical(meta.code, 90),
        withTimeout(
          getConsensusBundle(meta.code).catch(() => emptyConsensus),
          CONSENSUS_TIMEOUT_MS,
          emptyConsensus
        ),
        isKrStock(meta.code)
          ? getMarketAlertCached(meta.code).catch(() => null)
          : Promise.resolve(null),
        isCore
          ? Promise.resolve([] as EventItem[])
          : withTimeout(
              fetchEventsForSymbol(meta).catch(() => [] as EventItem[]),
              2_500,
              [] as EventItem[]
            ),
        withTimeout(
          fetchFlowOrMock(meta.code, 0).catch(() => ({
            flow: { ...PENDING_FLOW },
            source: "mock" as const,
          })),
          FLOW_TIMEOUT_MS,
          { flow: { ...PENDING_FLOW }, source: "mock" as const }
        ),
      ]);
      let hist = histRaw;

      let upcomingEventsMerged = dedupeEventItems([
        ...upcomingEvents,
        ...getCuratedUpcomingForSymbol(meta.code, 90),
      ]);

      // full 만 peer spillover (Yahoo 이벤트 추가 호출). core 는 curated 로 충분.
      if (!isCore) {
        const peer = getGroupCatalystPeer(meta.code);
        if (peer && peer.leaderCode !== meta.code) {
          const leaderInWatch = watchSymbols.find(
            (m) => m.code === peer.leaderCode
          );
          const leaderMeta =
            leaderInWatch ??
            WATCHLIST_CANDIDATES.find((m) => m.code === peer.leaderCode);
          if (leaderMeta) {
            const leaderCurated = getCuratedUpcomingForSymbol(
              peer.leaderCode,
              90
            ).filter((e) => e.symbolCode === peer.leaderCode);
            const leaderApiEvents = await withTimeout(
              fetchEventsForSymbol(leaderMeta).catch(() => [] as EventItem[]),
              2_000,
              [] as EventItem[]
            );
            upcomingEventsMerged = dedupeEventItems([
              ...upcomingEventsMerged,
              ...spilloverLeaderEvents(meta.code, [
                ...leaderApiEvents,
                ...leaderCurated,
              ]),
            ]);
          }
        }
      }

      if (!quoteRes.ok) throw new Error(quoteRes.error);
      const quote: typeof quoteRes.quote = {
        ...quoteRes.quote,
        marketAlert,
      };

      // 신규상장(SKHY 등): Yahoo chart 폴백으로 시세는 있는데 history 가 빈 배열이면
      // "0일" 배지·예측 게이트가 거짓으로 걸린다 → quote OHLC 로 1봉 시드.
      if (hist.length === 0 && quote.price > 0) {
        hist = seedHistoryFromQuote(quote);
      }

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

      // core: 야간 지표 skip (full 에서 채움). 예측 critical path 차단 방지.
      const overseasNight =
        !isCore && includeOverseasNight
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

      // flowEarly 는 price=0 으로 먼저 떴을 수 있음 — 실가격으로 한 번 더(캐시 hit 면 즉시).
      const flowRes =
        quote.price > 0
          ? await withTimeout(
              fetchFlowOrMock(meta.code, quote.price).catch(() => flowEarly),
              FLOW_TIMEOUT_MS,
              flowEarly
            )
          : flowEarly;
      const tech = computeTech(hist);
      const flow = { ...flowRes.flow, fetchedAt: quote.fetchedAt };

      // 한국 종목 + 정규장 진행 중일 때만 1분봉 호출 (TTL 60s 캐시).
      const intradayBars =
        !isCore && isKrStock(meta.code) && isKrMarketOpen()
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

      // core: OpenDART/SEC/호가 알파 skip — full 에서만 (budget 로도 막히게).
      const extraFactors = isCore
        ? []
        : await collectExtraAlphaFactors({
            code: meta.code,
            relatedNews,
            skipSlowSources: false,
          }).catch(() => []);

      const dataQuality = assessDataQuality({
        code: meta.code,
        historyLength: hist.length,
        flow,
      });
      const cachedAnalysis = getAnalysisCache(meta.code);
      const eventsForVolatility: EventItem[] = [
        ...upcomingEventsMerged,
        ...getMacroEventsCached(),
      ];

      let analysis: AnalysisResult;
      let predictions: Predictions | null;

      const buildPredictions = (a: AnalysisResult): Predictions | null => {
        // core: ChronoPulse·매크로 예측은 full 로 미룸 — 수급·컨센 UI 가 같이 기다리지 않게.
        if (isCore) return null;
        let pred: Predictions | null = predict({
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
          buyScore: a.buyScore,
          heatScore: a.heatScore,
          overseasNight,
          intradayDailyVol: intradayMetrics?.parkinsonDaily ?? null,
          events: eventsForVolatility,
          todayChangeRate: quote.changeRate,
          momentumActive: !!a.verdict.momentumOverride,
          newsRisk: externalRisk,
          flow,
          externalRisk,
          externalOpportunity,
          consensusUpside: consensus?.upsidePercent ?? null,
          marketContext: context ?? undefined,
          extraFactors,
        });
        pred = applyThinHistoryPredictionGate(pred, dataQuality);
        if (pred?.targets) {
          const REDUCE_ACTIONS = new Set(["REDUCE", "TRIM", "AVOID"]);
          if (REDUCE_ACTIONS.has(a.verdict.action)) {
            const t = pred.targets;
            if (
              t.entry > 0 &&
              (t.takeProfit1 >= t.entry * 1.03 ||
                t.takeProfit2 >= t.entry * 1.03)
            ) {
              pred = { ...pred, targets: { ...t, suppressed: true } };
            }
          }
        }
        return pred;
      };

      const analysisContext = {
        ...(context ?? EMPTY_MARKET_CONTEXT),
        overseasNightRate: overseasNight?.changeRate ?? null,
      };

      if (cachedAnalysis) {
        // 규칙 분석은 캐시 재사용하되, 뉴스·ChronoPulse 예측은 항상 최신으로.
        // (캐시가 호재/악재를 1시간 굳혀 전 종목 "뉴스 안정 +0.1%"·flat 곡선이 나오던 버그)
        analysis = {
          ...cachedAnalysis.analysis,
          externalRisk,
          externalOpportunity,
        };
        predictions = buildPredictions(analysis);
      } else {
        const analysisRaw = analyze({
          quote,
          tech,
          flow,
          consensus,
          valuation: consensusValuation,
          externalRisk,
          externalOpportunity,
          context: analysisContext,
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
        predictions = buildPredictions(analysis);
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
          semiHeat: (context ?? EMPTY_MARKET_CONTEXT).semiHeat,
          nasdaqRate: (context ?? EMPTY_MARKET_CONTEXT).nasdaqRate,
          fxRate: (context ?? EMPTY_MARKET_CONTEXT).fxRate,
          vix: (context ?? EMPTY_MARKET_CONTEXT).vix,
          kospiRate: (context ?? EMPTY_MARKET_CONTEXT).kospiRate,
          soxRate: (context ?? EMPTY_MARKET_CONTEXT).soxRate,
          esRate: (context ?? EMPTY_MARKET_CONTEXT).esRate,
          ymRate: (context ?? EMPTY_MARKET_CONTEXT).ymRate,
        },
        analysisCachedAt: cachedAnalysis?.cachedAt ?? null,
      };
      };

      const snap = await withTimeout(
        work(),
        SYMBOL_BUDGET_MS,
        null as StockSnapshot | null
      );
      if (!snap) {
        throw new Error(`${meta.code} 종목 분석 ${SYMBOL_BUDGET_MS}ms 초과`);
      }
      return snap;
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

  applyGroupCatalystSpillover(primaries);

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
  // lite: 웜 캐시(시세+스파크라인) 우선. 없으면 시세-only (90일 fanout 스킵).
  // 백그라운드로 full 지표를 워밍해 다음 폴링·core/full 이 peek 하게.
  const peeked = peekMarketIndicators();
  const indicatorResult =
    peeked ?? (await fetchMarketIndicatorsQuotesOnly());
  if (!peeked) {
    void cachedMarketIndicators().catch(() => null);
  }
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

// lite 서버 TTL = 정규장 폴링(90s). 더 짧으면 폴링마다 람다 재실행(Vercel).
// 숫자는 kisCachePolicy.LITE_SNAPSHOT_TTL_MS SSOT.
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
// Phase A.5 — core 스냅샷: 시세+히스토리+수급+컨센+규칙분석 (예측·공시 skip).
//   목표: 콜드 <3s. ChronoPulse·매크로·OpenDART 는 full 로 미룸.
// ──────────────────────────────────────────────────────────────
// core TTL — kisCachePolicy.CORE_SNAPSHOT_TTL_MS (진입 중복·Strict Mode 흡수)
type CoreSnapshotCache = { data: DashboardSnapshot; at: number };
const coreSnapshotCache = new Map<string, CoreSnapshotCache>();
const coreSnapshotInFlight = new Map<string, Promise<DashboardSnapshot>>();

function coreSnapshotKey(
  symbols: string[],
  options: BuildSnapshotOptions
): string {
  const normalized = Array.from(new Set(symbols)).sort().join(",");
  return `core:${normalized}|night=${options.includeOverseasNight ? "1" : "0"}`;
}

async function buildSnapshotCoreInner(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  options: BuildSnapshotOptions = {}
): Promise<DashboardSnapshot> {
  const TIMING = process.env.BUILD_SNAPSHOT_TIMING === "1";
  const t0 = TIMING ? performance.now() : 0;
  // core 는 지표 90일 fanout 을 기다리지 않음 — lite/full 이 이미(또는 곧) 채움.
  // 웜 캐시가 있으면 재사용, 없으면 빈 컨텍스트로 수급·컨센·RSI 만 빠르게.
  const peeked = peekMarketIndicators();
  const indicatorResult =
    peeked ??
    ({
      indicators: [],
      errors: {},
      context: EMPTY_MARKET_CONTEXT,
      usdKrw: null,
      macroHistories: {},
    } satisfies MarketIndicatorsResult);
  // 백그라운드로 지표 워밍 (응답은 막지 않음)
  if (!peeked) {
    void cachedMarketIndicators().catch(() => null);
  }
  const watchResult = await fetchWatchlistSnapshots(requestedSymbols, {
    indicators: indicatorResult.indicators,
    news: [],
    context: indicatorResult.context,
    usdKrw: indicatorResult.usdKrw,
    macroHistories: {},
    options,
    mode: "core",
  });
  if (TIMING) {
    console.warn(
      `[snapshot:core] total=${(performance.now() - t0).toFixed(0)}ms primaries=${watchResult.primaries.length}`
    );
  }
  return {
    generatedAt: Date.now(),
    phase: "core",
    primaries: watchResult.primaries,
    indicators: indicatorResult.indicators,
    marketMood: buildMarketMood(
      indicatorResult.indicators,
      [],
      indicatorResult.context.semiHeat
    ),
    news: [],
    errors: { ...indicatorResult.errors, ...watchResult.errors },
    macroEvents: fetchMacroEvents(),
    kisActive: kisEnabled(),
  };
}

export async function buildSnapshotCore(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  options: BuildSnapshotOptions = {}
): Promise<DashboardSnapshot> {
  const key = coreSnapshotKey(requestedSymbols, options);
  const now = Date.now();
  const hit = coreSnapshotCache.get(key);
  if (hit && now - hit.at < CORE_SNAPSHOT_TTL_MS) return hit.data;
  const inflight = coreSnapshotInFlight.get(key);
  if (inflight) return inflight;
  const p = buildSnapshotCoreInner(requestedSymbols, options)
    .then((data) => {
      coreSnapshotCache.set(key, { data, at: Date.now() });
      if (coreSnapshotCache.size > 64) {
        const firstKey = coreSnapshotCache.keys().next().value;
        if (firstKey !== undefined) coreSnapshotCache.delete(firstKey);
      }
      return data;
    })
    .finally(() => {
      coreSnapshotInFlight.delete(key);
    });
  coreSnapshotInFlight.set(key, p);
  return p;
}

/** full 빌드 전체 상한 — 초과 시 core partial 반환 (서버 hang 방지) */
const FULL_BUILD_BUDGET_MS = 22_000;

// ──────────────────────────────────────────────────────────────
// 기존 호환 — 메인 대시보드 1회 분의 통합 스냅샷.
//   indicators + news 를 병렬로 받고 → watchlist 분석에 deps로 주입.
//   외부 인터페이스(반환 shape)는 종전과 동일.
// ──────────────────────────────────────────────────────────────
export async function buildSnapshot(
  requestedSymbols: string[] = PRIMARY_SYMBOLS.map((s) => s.code),
  options: BuildSnapshotOptions = {}
): Promise<DashboardSnapshot> {
  const TIMING = process.env.BUILD_SNAPSHOT_TIMING === "1";
  const t0 = TIMING ? performance.now() : 0;

  const buildFull = async (): Promise<DashboardSnapshot> => {
    const watchSymbolsForNews = resolveWatchSymbols(requestedSymbols).map(
      (s) => s.code
    );
    // 뉴스는 전체 budget 의 일부만 — 막히면 빈 배열로 진행해 예측은 먼저.
    const [indicatorResult, news] = await Promise.all([
      cachedMarketIndicators(),
      withTimeout(
        fetchNewsItemsWithSymbols(watchSymbolsForNews, 60, 8, 80).catch(
          () => [] as NewsItem[]
        ),
        12_000,
        [] as NewsItem[]
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
      mode: "full",
    });
    const t2 = TIMING ? performance.now() : 0;
    if (TIMING) {
      console.warn(
        `[snapshot] indicators+news=${(t1 - t0).toFixed(0)}ms watchlist=${(t2 - t1).toFixed(0)}ms total=${(t2 - t0).toFixed(0)}ms news=${news.length} primaries=${watchResult.primaries.length}`
      );
    }

    const errors = { ...indicatorResult.errors, ...watchResult.errors };
    const newsFailed = news.length === 0 && didNewsFetchFail();
    if (newsFailed) {
      errors["news"] = "뉴스를 불러오지 못했어요";
    }
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
      newsFetchFailed: newsFailed,
      errors,
      macroEvents: fetchMacroEvents(),
      kisActive: kisEnabled(),
    };
  };

  // 전체 hard budget — hang 시 core partial 로라도 예측·RSI 반환
  const fullP = buildFull();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = await Promise.race([
    fullP.then((data) => ({ ok: true as const, data })),
    new Promise<{ ok: false }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false }), FULL_BUILD_BUDGET_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });

  if (timedOut.ok) return timedOut.data;

  console.warn(
    `[snapshot] full budget ${FULL_BUILD_BUDGET_MS}ms exceeded → core partial`
  );
  try {
    const core = await buildSnapshotCore(requestedSymbols, options);
    return {
      ...core,
      phase: "full" as const,
      errors: {
        ...core.errors,
        _budget: `full ${FULL_BUILD_BUDGET_MS}ms 초과 → core partial`,
      },
    };
  } catch (e) {
    // core 도 실패하면 fullP 가 끝날 때까지 조금 더 기다림 (이미 진행 중)
    try {
      return await withTimeout(fullP, 8_000, {
        generatedAt: Date.now(),
        phase: "full" as const,
        primaries: [],
        indicators: [],
        marketMood: {
          label: "중립" as const,
          semiHeat: null,
          riskKeywords: [],
        },
        news: [],
        errors: {
          _fatal: e instanceof Error ? e.message : String(e),
        },
        macroEvents: fetchMacroEvents(),
        kisActive: kisEnabled(),
      });
    } catch (e2) {
      console.warn(
        "[snapshot] full+core failed",
        e2 instanceof Error ? e2.message : String(e2)
      );
      throw e2;
    }
  }
}

// ──────────────────────────────────────────────────────────────
// buildSnapshotShared — `/api/snapshot` 전용 in-flight dedup + full TTL.
//   동일 symbols + 옵션을 짧은 시간 안에 여러 클라이언트가 호출하면
//   직전 응답을 그대로 반환해 fanout 비용을 한 번으로 압축한다.
//   TTL = FULL_SNAPSHOT_TTL_MS(15분). refresh=1 은 buildSnapshot 직접 호출.
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
  coreSnapshotCache.clear();
  marketIndicatorCache = null;
}

async function fetchOverseasNightIndicator(
  meta: SymbolMeta,
  domesticQuote: Quote,
  usdKrw: number | null,
  eurUsd: number | null
): Promise<OverseasNightIndicator | null> {
  const primary = getOverseasNightProxy(meta.code);
  if (!primary) return null;
  const candidates = [primary, getOverseasNightFallback(meta.code)].filter(
    (p): p is NonNullable<typeof p> => p != null
  );

  for (const proxy of candidates) {
    const quote = await fetchQuote(proxy.proxyCode, proxy.name);
    if (!quote.price || quote.changeRate == null) continue;
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

    const ext = quote.extendedHours;
    const proxyHist = await fetchHistorical(proxy.proxyCode, 5).catch(() => []);
    const recentCloses =
      proxyHist.length > 0
        ? proxyHist.map((h) => h.close)
        : quote.price > 0
          ? [quote.price]
          : [];
    const changeRate = resolveOvernightProxyRate({
      sessionRate: quote.changeRate,
      extendedRate: ext?.changeRate,
      extendedActive: !!ext?.active,
      recentCloses,
      sessionOpen: quote.open ?? proxyHist[0]?.open ?? null,
      listingReferencePrice: proxy.listingReferencePrice ?? null,
      lastPrice: ext?.active && ext.price > 0 ? ext.price : quote.price,
    });

    return {
      baseCode: meta.code,
      proxyCode: proxy.proxyCode,
      name: proxy.name,
      exchange: proxy.exchange,
      sharesPerReceipt: proxy.sharesPerReceipt,
      proxyKind: proxy.proxyKind,
      price: quote.price,
      changeRate,
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
  return null;
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
