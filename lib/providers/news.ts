import "server-only";
import Parser from "rss-parser";
import crypto from "node:crypto";
import type { NewsItem } from "../types";
import { RISK_KEYWORDS } from "../news/keywords";
import { POSITIVE_KEYWORDS } from "../news/positiveKeywords";
import { WATCHLIST_CANDIDATES } from "../symbols";
import {
  fetchNaverFinanceNews,
  fetchNaverNewsSearch,
  extractKrCode,
} from "./naverNews";
import { translateTitleToKo } from "../news/translation";

// Google News RSS — 짧은 timeout. rss-parser 내장 timeout 이 503/HTML 응답에서
// 끝나지 않는 사례가 있어 withHardTimeout(1.5s) 으로 한 번 더 보강.
const parser = new Parser({
  timeout: 2500,
  headers: { "User-Agent": "Mozilla/5.0 stock-dashboard/0.1" },
});

// Google News RSS 차단(503/timeout) 감지 — 한 번 차단 잡히면 해당 언어 윈도우에서만
// 즉시 fail 시켜 snapshot 응답이 수십 초 hang 되는 사태를 막는다.
//
// 이전엔 전역 변수 1개로 한 번 잡히면 한·영 양쪽 모두 10분 봉인됐다.
// 한국어(hl=ko) 가 503 인 사이에도 영어(hl=en) 는 살아 있을 수 있어 per-language 로 분리.
// 첫 실패는 2분 backoff 부터 시작해 연속 실패 시 4·8·16·30분(cap) 으로 지수 증가 →
// 일시적 hiccup 에서는 빨리 회복하고, 지속 차단에는 호출 횟수 자체를 줄인다.
const GOOGLE_BACKOFF_START_MS = 2 * 60 * 1000;
const GOOGLE_BACKOFF_MAX_MS = 30 * 60 * 1000;

interface GoogleBlockState {
  blockedUntil: number;
  consecutiveFailures: number;
}
const googleBlockState = new Map<string, GoogleBlockState>();

type GoogleSourceKey = "ko" | "en";

function shouldSkipGoogle(key: GoogleSourceKey): boolean {
  const state = googleBlockState.get(key);
  return !!state && Date.now() < state.blockedUntil;
}

function markGoogleBlocked(key: GoogleSourceKey): void {
  const prev = googleBlockState.get(key);
  const failures = (prev?.consecutiveFailures ?? 0) + 1;
  const backoff = Math.min(
    GOOGLE_BACKOFF_MAX_MS,
    GOOGLE_BACKOFF_START_MS * Math.pow(2, failures - 1)
  );
  googleBlockState.set(key, {
    blockedUntil: Date.now() + backoff,
    consecutiveFailures: failures,
  });
  console.warn(
    `[news] Google News RSS blocked (${key}) → skip for ${Math.round(backoff / 60_000)} min (failure ${failures})`
  );
}

function clearGoogleBlocked(key: GoogleSourceKey): void {
  googleBlockState.delete(key);
}

// Google fetch 한 건당 hard timeout. parser timeout 이 실제 안 끝나는 사례(503 HTML
// 응답 + parseString hang)가 관찰됨 → Promise.race 로 강제 종료.
const GOOGLE_HARD_TIMEOUT_MS = 1500;

async function withHardTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`hard-timeout ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchGoogleFeed(cfg: { q: string; lang: "ko" | "en"; symbol?: string }) {
  if (shouldSkipGoogle(cfg.lang)) throw new Error(`google-skipped:${cfg.lang}`);
  try {
    const feed = await withHardTimeout(
      parser.parseURL(feedUrl(cfg.q, cfg.lang)),
      GOOGLE_HARD_TIMEOUT_MS
    );
    // 성공했으면 연속 실패 카운터 리셋 — 다음 hiccup 은 다시 짧은 backoff(2분) 부터.
    clearGoogleBlocked(cfg.lang);
    return (feed.items ?? []).slice(0, 8).map((item) => toNewsItem(item, cfg.symbol));
  } catch (e) {
    markGoogleBlocked(cfg.lang);
    throw e;
  }
}

// 한국어 검색 (네이버 인덱스 기반) + 영어/글로벌 (Google News English)
function feedUrl(query: string, lang: "ko" | "en"): string {
  const q = encodeURIComponent(query);
  if (lang === "ko") {
    return `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
  }
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

function yahooRssUrl(symbol: string): string {
  return `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
    symbol
  )}&region=US&lang=en-US`;
}

// 종목/시장 키워드별 fetch.
// 추천에 자주 등장하는 시총 상위 종목 + 사용자 관심 종목 위주.
// 한·영 두 쿼리를 잡아 글로벌 매체 호재(예: "Hyundai Motor wins order")까지 커버.
const QUERIES: Array<{ q: string; symbol?: string; lang: "ko" | "en" }> = [
  // ── 반도체 핵심 ──────────────────────────────────────────
  { q: "삼성전자", symbol: "005930.KS", lang: "ko" },
  { q: "Samsung Electronics", symbol: "005930.KS", lang: "en" },
  { q: "SK하이닉스", symbol: "000660.KS", lang: "ko" },
  { q: "SK Hynix HBM", symbol: "000660.KS", lang: "en" },
  { q: "SK스퀘어", symbol: "402340.KS", lang: "ko" },
  { q: "SK Square", symbol: "402340.KS", lang: "en" },
  { q: "SK지주", symbol: "034730.KS", lang: "ko" },
  { q: "삼성전기", symbol: "009150.KS", lang: "ko" },

  // ── IT가전·자동차 ────────────────────────────────────────
  { q: "LG전자", symbol: "066570.KS", lang: "ko" },
  { q: "현대차", symbol: "005380.KS", lang: "ko" },
  { q: "Hyundai Motor", symbol: "005380.KS", lang: "en" },
  { q: "기아", symbol: "000270.KS", lang: "ko" },
  { q: "Kia Motors", symbol: "000270.KS", lang: "en" },

  // ── 배터리·인터넷 ───────────────────────────────────────
  { q: "LG에너지솔루션", symbol: "373220.KS", lang: "ko" },
  { q: "LG Energy Solution", symbol: "373220.KS", lang: "en" },
  { q: "네이버 NAVER", symbol: "035420.KS", lang: "ko" },
  { q: "카카오", symbol: "035720.KS", lang: "ko" },

  // ── 방산·항공·조선·원전 ─────────────────────────────────
  { q: "한화에어로스페이스", symbol: "012450.KS", lang: "ko" },
  { q: "Hanwha Aerospace", symbol: "012450.KS", lang: "en" },
  { q: "한국항공우주", symbol: "047810.KS", lang: "ko" },
  { q: "Korea Aerospace KAI", symbol: "047810.KS", lang: "en" },
  { q: "두산에너빌리티", symbol: "034020.KS", lang: "ko" },
  { q: "Doosan Enerbility nuclear", symbol: "034020.KS", lang: "en" },
  { q: "대한항공", symbol: "003490.KS", lang: "ko" },
  { q: "Korean Air", symbol: "003490.KS", lang: "en" },

  // ── 바이오 ──────────────────────────────────────────────
  { q: "삼성바이오로직스", symbol: "207940.KS", lang: "ko" },

  // ── 2026-06 카탈로그 확장 종목 (한·영 인기 종목 위주) ────
  { q: "두산로보틱스", symbol: "454910.KS", lang: "ko" },
  { q: "Doosan Robotics", symbol: "454910.KS", lang: "en" },
  { q: "씨에스윈드", symbol: "112610.KS", lang: "ko" },
  { q: "CS Wind", symbol: "112610.KS", lang: "en" },
  { q: "휴젤 보톡스", symbol: "145020.KQ", lang: "ko" },
  { q: "Hugel botulinum", symbol: "145020.KQ", lang: "en" },
  { q: "LG생활건강", symbol: "051900.KS", lang: "ko" },
  { q: "삼양식품 불닭", symbol: "003230.KS", lang: "ko" },
  { q: "Samyang Foods Buldak", symbol: "003230.KS", lang: "en" },
  { q: "스튜디오드래곤", symbol: "253450.KQ", lang: "ko" },
  { q: "현대건설", symbol: "000720.KS", lang: "ko" },
  { q: "Hyundai E&C", symbol: "000720.KS", lang: "en" },
  { q: "더존비즈온", symbol: "012510.KS", lang: "ko" },
  { q: "LG디스플레이 OLED", symbol: "034220.KS", lang: "ko" },
  { q: "LG Display OLED", symbol: "034220.KS", lang: "en" },
  { q: "CJ대한통운", symbol: "000120.KS", lang: "ko" },

  // ── 미국 빅테크 (영문 쿼리만 — 한국어는 노이즈) ──────────
  { q: "Apple AAPL", symbol: "AAPL", lang: "en" },
  { q: "Microsoft Azure cloud", symbol: "MSFT", lang: "en" },
  { q: "Alphabet Google", symbol: "GOOGL", lang: "en" },
  { q: "Meta Platforms", symbol: "META", lang: "en" },
  { q: "Amazon AWS", symbol: "AMZN", lang: "en" },
  { q: "Tesla TSLA EV", symbol: "TSLA", lang: "en" },
  { q: "AMD chip", symbol: "AMD", lang: "en" },
  { q: "TSMC foundry", symbol: "TSM", lang: "en" },
  { q: "Palantir AI", symbol: "PLTR", lang: "en" },

  // ── 2026-06 미국 카탈로그 확장 (영문 쿼리 위주) ──────────
  // 반도체/AI 인프라
  { q: "Broadcom AVGO AI networking", symbol: "AVGO", lang: "en" },
  { q: "Qualcomm QCOM Snapdragon", symbol: "QCOM", lang: "en" },
  { q: "Micron MU HBM memory", symbol: "MU", lang: "en" },
  { q: "ARM Holdings chip IP", symbol: "ARM", lang: "en" },
  { q: "Marvell MRVL semiconductor", symbol: "MRVL", lang: "en" },
  { q: "Super Micro SMCI AI server", symbol: "SMCI", lang: "en" },
  // AI 소프트웨어
  { q: "Oracle ORCL cloud AI", symbol: "ORCL", lang: "en" },
  { q: "Salesforce CRM Agentforce", symbol: "CRM", lang: "en" },
  { q: "ServiceNow NOW enterprise AI", symbol: "NOW", lang: "en" },
  { q: "Adobe ADBE Firefly", symbol: "ADBE", lang: "en" },
  // 헬스케어
  { q: "Eli Lilly LLY GLP-1 weight loss", symbol: "LLY", lang: "en" },
  { q: "UnitedHealth UNH insurance", symbol: "UNH", lang: "en" },
  // 핀테크
  { q: "Visa V payments", symbol: "V", lang: "en" },
  { q: "Mastercard MA payments", symbol: "MA", lang: "en" },
  // 소비/리테일
  { q: "Costco COST membership earnings", symbol: "COST", lang: "en" },
  { q: "Walmart WMT retail", symbol: "WMT", lang: "en" },
  { q: "Home Depot HD housing", symbol: "HD", lang: "en" },
  // 중국 ADR
  { q: "Alibaba BABA cloud", symbol: "BABA", lang: "en" },
  { q: "PDD Holdings Temu Pinduoduo", symbol: "PDD", lang: "en" },
  // 에너지
  { q: "Exxon Mobil XOM oil", symbol: "XOM", lang: "en" },
  { q: "Chevron CVX oil", symbol: "CVX", lang: "en" },
  // 핫 테마 (BTC 노출·코인 거래소)
  { q: "MicroStrategy MSTR bitcoin treasury", symbol: "MSTR", lang: "en" },
  { q: "Coinbase COIN crypto exchange", symbol: "COIN", lang: "en" },

  // ── 시장 전반 ───────────────────────────────────────────
  { q: "반도체", lang: "ko" },
  { q: "환율 달러", lang: "ko" },
  { q: "Nvidia semiconductor", lang: "en" },
  { q: "Fed rate", lang: "en" },
];

// 동시성 제한 헬퍼 — Google News RSS 가 burst 호출에 차단되는 사례가 보고돼
// 전체 동시성을 3 으로 보수적으로 둔다 (워커A: 8 → 워커B: 3 머지 결과).
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (it: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i]) };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// Yahoo Finance RSS — 종목 단위 헤드라인 피드.
// Google News RSS 가 일시 차단(HTTP 503)되어도 종목 뉴스를 채울 수 있는 폴백 소스.
const SYMBOLS_FOR_YAHOO_RSS = WATCHLIST_CANDIDATES
  .filter((s) => s.kind === "us-stock" || s.kind === "kr-stock")
  .map((s) => s.code);

const yahooParser = new Parser({
  timeout: 6000,
  headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
});

async function fetchYahooHeadlines(symbol: string): Promise<NewsItem[]> {
  const feed = await yahooParser.parseURL(yahooRssUrl(symbol));
  return (feed.items ?? []).slice(0, 8).map((item) => toNewsItem(item, symbol));
}

// process 메모리 캐시 — buildSnapshot/api/news 가 짧은 시간 안에 여러 번 호출돼도
// Google/Yahoo RSS 를 매번 다 두드리지 않도록. TTL 90s.
let allNewsMemoCache: { items: NewsItem[]; at: number } | null = null;
const ALL_NEWS_MEMO_TTL_MS = 90_000;

// 제목 정규화 — dedup 키.
function normalizeTitleKey(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function fetchAllNews(limit = 40): Promise<NewsItem[]> {
  if (allNewsMemoCache && Date.now() - allNewsMemoCache.at < ALL_NEWS_MEMO_TTL_MS) {
    return allNewsMemoCache.items.slice(0, limit);
  }
  // 1) Google News RSS (한·영 쿼리) — 시장 전반 + 한국 종목 헤드라인의 주력 소스.
  // 2) Yahoo Finance 헤드라인 RSS — 미국 종목별 폴백. Google 차단 시에도 미국 뉴스 확보.
  // per-language skip 으로 한쪽만 차단된 경우엔 살아있는 쪽 쿼리는 그대로 실행.
  // fetchGoogleFeed 안에서 다시 한번 shouldSkipGoogle 가드가 있어 race-safe.
  const koSkip = shouldSkipGoogle("ko");
  const enSkip = shouldSkipGoogle("en");
  const googleQueries =
    koSkip && enSkip
      ? []
      : QUERIES.filter((q) => (q.lang === "ko" ? !koSkip : !enSkip));
  const [googleResults, yahooResults] = await Promise.all([
    googleQueries.length > 0
      ? runWithConcurrency(googleQueries, 3, fetchGoogleFeed)
      : Promise.resolve([] as PromiseSettledResult<NewsItem[]>[]),
    runWithConcurrency(SYMBOLS_FOR_YAHOO_RSS, 3, fetchYahooHeadlines),
  ]);

  const merged: NewsItem[] = [];
  let gOk = 0;
  let gFail = 0;
  let yOk = 0;
  let yFail = 0;
  for (const r of googleResults) {
    if (r.status === "fulfilled") {
      gOk++;
      merged.push(...r.value);
    } else gFail++;
  }
  for (const r of yahooResults) {
    if (r.status === "fulfilled") {
      yOk++;
      merged.push(...r.value);
    } else yFail++;
  }
  if (merged.length === 0) {
    console.warn(
      `[news] fetchAllNews: 0 items (google ok=${gOk} fail=${gFail}, yahoo ok=${yOk} fail=${yFail})`
    );
  } else if (gOk === 0 && yOk > 0) {
    console.warn(
      `[news] fetchAllNews: Google RSS all failed (${gFail}); using Yahoo only (${yOk} ok)`
    );
  }

  // 중복 제거 (id + 제목 정규화) — 같은 기사가 매체별로 중복되는 것을 한 번에 1건으로.
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
    if (dedup.length >= limit) break;
  }
  if (dedup.length > 0) {
    allNewsMemoCache = { items: dedup, at: Date.now() };
  }
  return dedup;
}

// ─────────────────────────────────────────────────────────────────────────────
// 종목별 뉴스 fetch — 다중 소스 폴백 + 영어 제목 한국어 번역.
//
// 한국 종목:
//   1) 네이버 금융 종목 뉴스 스크래핑 (10~20건, 한국어 원문)
//   2) Google News RSS 한국어
//   3) Yahoo Finance RSS (영문, 번역 적용)
//
// 미국 종목:
//   1) 네이버 뉴스 검색 (한국명 키워드, 한국어 매체 결과)
//   2) Google News RSS 한국어 (한국명 키워드로 한국어 매체 한정)
//   3) Yahoo Finance RSS (영문, 번역 적용)
//
// 영어 제목은 직후 titleKo 에 번역을 채워 UI 가 한국어 위주로 표시 가능하게 한다.
// Google 호출은 shouldSkipGoogle() 체크 + hard timeout 1.5s 로 워커A 의 보호 로직과
// 양립한다. Google 차단 시 자연스럽게 네이버 → Yahoo 로 폴백.
// ─────────────────────────────────────────────────────────────────────────────

// 미국 티커 → 한국명 매핑. 검색 키워드용. naver search / google news 한국어에 사용.
const US_TICKER_TO_KO: Record<string, string> = {
  NVDA: "엔비디아",
  AAPL: "애플",
  MSFT: "마이크로소프트",
  GOOGL: "알파벳",
  GOOG: "알파벳",
  META: "메타",
  AMZN: "아마존",
  TSLA: "테슬라",
  AMD: "AMD",
  TSM: "TSMC",
  PLTR: "팔란티어",
  AVGO: "브로드컴",
  QCOM: "퀄컴",
  MU: "마이크론",
  ARM: "ARM",
  MRVL: "마벨",
  SMCI: "슈퍼마이크로",
  ORCL: "오라클",
  CRM: "세일즈포스",
  NOW: "서비스나우",
  ADBE: "어도비",
  LLY: "일라이 릴리",
  UNH: "유나이티드헬스",
  V: "비자카드",
  MA: "마스터카드",
  COST: "코스트코",
  WMT: "월마트",
  HD: "홈디포",
  BABA: "알리바바",
  PDD: "테무",
  XOM: "엑손모빌",
  CVX: "셰브론",
  MSTR: "마이크로스트래티지",
  COIN: "코인베이스",
};

// 종목 코드별 한국어 사명 — 한국 종목용.
const KR_SYMBOL_TO_NAME: Record<string, string> = {
  "005930.KS": "삼성전자",
  "000660.KS": "SK하이닉스",
  "402340.KS": "SK스퀘어",
  "034730.KS": "SK",
  "009150.KS": "삼성전기",
  "066570.KS": "LG전자",
  "005380.KS": "현대차",
  "000270.KS": "기아",
  "373220.KS": "LG에너지솔루션",
  "035420.KS": "네이버",
  "035720.KS": "카카오",
  "012450.KS": "한화에어로스페이스",
  "047810.KS": "한국항공우주",
  "034020.KS": "두산에너빌리티",
  "003490.KS": "대한항공",
  "207940.KS": "삼성바이오로직스",
  "454910.KS": "두산로보틱스",
  "112610.KS": "씨에스윈드",
  "145020.KQ": "휴젤",
  "051900.KS": "LG생활건강",
  "003230.KS": "삼양식품",
  "253450.KQ": "스튜디오드래곤",
  "000720.KS": "현대건설",
  "012510.KS": "더존비즈온",
  "034220.KS": "LG디스플레이",
  "000120.KS": "CJ대한통운",
};

function looksKorean(s: string): boolean {
  // 한글 음절 1자라도 포함되면 한국어로 간주.
  return /[\uAC00-\uD7A3]/.test(s);
}

// 종목별 Google 폴백 — shouldSkipGoogle() + hard timeout 으로 워커A 보호 로직 적용.
// 실패해도 throw 하지 않고 빈 배열 반환 (호출자가 다음 소스로 폴백).
async function fromGoogleRss(
  query: string,
  lang: "ko" | "en",
  symbol: string | undefined,
  maxItems: number
): Promise<NewsItem[]> {
  if (shouldSkipGoogle(lang)) return [];
  try {
    const feed = await withHardTimeout(
      parser.parseURL(feedUrl(query, lang)),
      GOOGLE_HARD_TIMEOUT_MS
    );
    clearGoogleBlocked(lang);
    return (feed.items ?? [])
      .slice(0, maxItems)
      .map((item) => toNewsItem(item, symbol));
  } catch {
    markGoogleBlocked(lang);
    return [];
  }
}

async function fromYahooRss(
  ticker: string,
  symbol: string,
  maxItems: number
): Promise<NewsItem[]> {
  try {
    const feed = await yahooParser.parseURL(yahooRssUrl(ticker));
    return (feed.items ?? [])
      .slice(0, maxItems)
      .map((item) => {
        const n = toNewsItem(item, symbol);
        // Yahoo RSS 는 source 가 비는 경우가 많아 매체 라벨 보강.
        if (!n.source || n.source === "News") n.source = "Yahoo Finance";
        return n;
      });
  } catch {
    return [];
  }
}

// 영어 제목인 항목들에 한해 titleKo 를 채움. 한국어 원문은 건너뜀.
async function enrichTitleKo(items: NewsItem[]): Promise<NewsItem[]> {
  for (const it of items) {
    if (looksKorean(it.title)) continue;
    if (it.titleKo) continue;
    const ko = await translateTitleToKo(it.title);
    if (ko && ko !== it.title) it.titleKo = ko;
  }
  return items;
}

export interface FetchSymbolNewsOptions {
  // 결과 상한. dedup·정렬 이후 잘림.
  maxItems?: number;
  // 24h 이내 항목만 받을지 — UI 매칭 기본값과 일치(true).
  withinHours?: number;
}

export async function fetchNewsForSymbol(
  symbol: string,
  options: FetchSymbolNewsOptions = {}
): Promise<NewsItem[]> {
  const max = options.maxItems ?? 20;
  const withinHours = options.withinHours ?? 24;
  const cutoff = Date.now() - withinHours * 60 * 60 * 1000;

  const isKr = !!extractKrCode(symbol);
  const collected: NewsItem[] = [];

  if (isKr) {
    // 1) 네이버 금융 종목 뉴스 스크래핑 — 가장 풍부, 한국어 원문.
    const naverFin = await fetchNaverFinanceNews(symbol, { symbol, maxItems: max });
    collected.push(...naverFin);

    // 2) Google News RSS (한국어) — 보강. Google 차단 시 자동 skip.
    const name = KR_SYMBOL_TO_NAME[symbol];
    if (name) {
      collected.push(...(await fromGoogleRss(name, "ko", symbol, 10)));
    }
  } else {
    // 미국 종목 (또는 그 외 영문)
    const koName = US_TICKER_TO_KO[symbol];
    if (koName) {
      // 1) 네이버 뉴스 검색 (한국명) — 한국 매체 기사.
      collected.push(...(await fetchNaverNewsSearch(koName, { symbol, maxItems: 10 })));
      // 2) Google News RSS 한국어 (한국명) — 한국어 매체 결과 한정.
      collected.push(...(await fromGoogleRss(koName, "ko", symbol, 10)));
    }
    // 3) Yahoo Finance RSS — 영문, 번역 적용.
    collected.push(...(await fromYahooRss(symbol, symbol, 10)));
  }

  // 24h 컷 + 정규화 dedup + 시간 역순 + sentiment 분류 + symbol 보강.
  for (const n of collected) {
    if (!n.symbol) n.symbol = symbol;
    if (!n.sentiment) n.sentiment = classifySentiment(n.title, n.titleKo);
    if (!n.keywords || n.keywords.length === 0) n.keywords = extractKeywords(n.title);
  }

  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const dedup: NewsItem[] = [];
  for (const n of collected.sort((a, b) => b.publishedAt - a.publishedAt)) {
    if (n.publishedAt < cutoff) continue;
    if (seenIds.has(n.id)) continue;
    const titleKey = normalizeTitleKey(n.title);
    if (seenTitles.has(titleKey)) continue;
    seenIds.add(n.id);
    seenTitles.add(titleKey);
    dedup.push(n);
    if (dedup.length >= max) break;
  }

  // 영문 제목 → 한국어 번역. throttle 이 있어 직렬 처리.
  await enrichTitleKo(dedup);
  // Round 4: enrichTitleKo 결과(titleKo) 활용해 sentiment 재분류.
  //   neutral 로 박혔지만 한국어 번역에 강 키워드("급락", "어닝쇼크" 등) 가 매칭되면
  //   재분류로 호재/악재 판정이 가능해진다. 이미 positive/negative 인 건은 유지.
  reclassifyWithTitleKo(dedup);
  return dedup;
}

// 번역(titleKo) 채워진 직후 sentiment 재분류.
// title 만으로 neutral 이었던 항목이 한국어 사전 매칭으로 호재/악재가 되는 경우를 잡는다.
// 이미 호재/악재로 판정된 항목은 건드리지 않는다 (보수적: 번역 노이즈로 등급 변동 방지).
export function reclassifyWithTitleKo(items: NewsItem[]): void {
  for (const n of items) {
    if (!n.titleKo) continue;
    if (n.sentiment === "positive" || n.sentiment === "negative") continue;
    const next = classifySentiment(n.title, n.titleKo);
    if (next && next !== "neutral") n.sentiment = next;
  }
}

// 여러 종목 동시 fetch — concurrency 2 로 외부 차단 최소화.
export async function fetchNewsForSymbols(
  symbols: string[],
  options: FetchSymbolNewsOptions = {}
): Promise<Record<string, NewsItem[]>> {
  const out: Record<string, NewsItem[]> = {};
  const results = await runWithConcurrency(symbols, 2, async (sym) => {
    const items = await fetchNewsForSymbol(sym, options);
    return { sym, items };
  });
  for (const r of results) {
    if (r.status === "fulfilled") {
      out[r.value.sym] = r.value.items;
    }
  }
  return out;
}

function toNewsItem(
  item: Parser.Item,
  symbol: string | undefined
): NewsItem {
  const title = (item.title ?? "").trim();
  const link = item.link ?? "";
  // Google News는 source가 item.creator 또는 title에 " - 소스" 형태로 들어옴
  const sourceMatch = title.match(/ - ([^-]+)$/);
  const source = sourceMatch?.[1]?.trim() ?? item.creator ?? "News";
  const cleanTitle = sourceMatch ? title.slice(0, sourceMatch.index).trim() : title;

  const published = item.isoDate ? new Date(item.isoDate).getTime() : Date.now();
  const id = crypto.createHash("md5").update(link || title).digest("hex");

  const sentiment = classifySentiment(cleanTitle);
  const keywords = extractKeywords(cleanTitle);

  return {
    id,
    title: cleanTitle,
    link,
    source,
    publishedAt: published,
    symbol: symbol ?? matchSymbol(cleanTitle),
    sentiment,
    keywords,
  };
}

// sentiment 분류는 RISK_KEYWORDS / POSITIVE_KEYWORDS 의 정규식+가중치를 그대로 재사용.
// 두 사전이 단일 진실의 소스(SSOT)이므로 키워드 추가/수정이 sentiment 분류에도 즉시 반영된다.
//
// Round 4 강화:
//   - title + (있으면) titleKo 양쪽 매칭 — 영문 헤드라인이 한국어로 번역된 경우
//     한국어 사전이 더 풍부하므로 titleKo 도 검사한다.
//   - 차이 임계값을 1.5 로 낮춤 (약 키워드 2개 또는 weight=2 키워드 1개 단독 분류 가능).
//   - 강 키워드(weight ≥4) 가 한쪽에만 있으면 양쪽 합 차이 무관하게 그쪽으로 분류 (양쪽
//     모두 강 키워드면 합 비교).
//   - 같은 라벨(예: "급락"·"plunge")이 한·영 양쪽 다 매칭되어도 1번만 카운트(라벨 dedupe).
function classifySentiment(
  title: string,
  titleKo?: string | null
): NewsItem["sentiment"] {
  // title + titleKo 합쳐 매칭 — \b 영어 word boundary 가 양쪽 모두에서 정확히 동작.
  // titleKo 가 비거나 동일하면 title 만.
  const haystack =
    titleKo && titleKo !== title ? `${title}\n${titleKo}` : title;

  let posWeight = 0;
  let negWeight = 0;
  let posStrong = 0;
  let negStrong = 0;
  const seenPos = new Set<string>();
  const seenNeg = new Set<string>();

  for (const kw of RISK_KEYWORDS) {
    if (seenNeg.has(kw.label)) continue;
    if (kw.pattern.test(haystack)) {
      seenNeg.add(kw.label);
      negWeight += kw.weight;
      if (kw.weight >= 4) negStrong += 1;
    }
  }
  for (const kw of POSITIVE_KEYWORDS) {
    if (seenPos.has(kw.label)) continue;
    if (kw.pattern.test(haystack)) {
      seenPos.add(kw.label);
      posWeight += kw.weight;
      if (kw.weight >= 4) posStrong += 1;
    }
  }

  // 강 키워드(≥4) 가 한쪽에만 있으면 즉시 그쪽으로.
  if (posStrong > 0 && negStrong === 0) return "positive";
  if (negStrong > 0 && posStrong === 0) return "negative";

  // 차이 1.5 미만 → neutral (호재/악재 양쪽이 비슷하면 판단 보류).
  if (Math.abs(posWeight - negWeight) < 1.5) return "neutral";
  return posWeight > negWeight ? "positive" : "negative";
}

const SYMBOL_MAP: Array<{ kw: string; code: string }> = [
  { kw: "삼성전자", code: "005930.KS" },
  { kw: "SK하이닉스", code: "000660.KS" },
  { kw: "삼성전기", code: "009150.KS" },
  { kw: "LG전자", code: "066570.KS" },
  { kw: "현대차", code: "005380.KS" },
  { kw: "기아", code: "000270.KS" },
  { kw: "LG에너지솔루션", code: "373220.KS" },
  { kw: "네이버", code: "035420.KS" },
  { kw: "카카오", code: "035720.KS" },
  { kw: "한화에어로스페이스", code: "012450.KS" },
  { kw: "한국항공우주", code: "047810.KS" },
  { kw: "두산에너빌리티", code: "034020.KS" },
  { kw: "대한항공", code: "003490.KS" },
  { kw: "삼성바이오로직스", code: "207940.KS" },
  // ── 2026-06 카탈로그 확장 ────────────────────────────────
  { kw: "두산로보틱스", code: "454910.KS" },
  { kw: "씨에스윈드", code: "112610.KS" },
  { kw: "휴젤", code: "145020.KQ" },
  { kw: "LG생활건강", code: "051900.KS" },
  { kw: "삼양식품", code: "003230.KS" },
  { kw: "스튜디오드래곤", code: "253450.KQ" },
  { kw: "현대건설", code: "000720.KS" },
  { kw: "더존비즈온", code: "012510.KS" },
  { kw: "LG디스플레이", code: "034220.KS" },
  { kw: "CJ대한통운", code: "000120.KS" },
  // 미국 빅테크 (한·영 모두)
  { kw: "엔비디아", code: "NVDA" },
  { kw: "nvidia", code: "NVDA" },
  { kw: "애플", code: "AAPL" },
  { kw: "apple", code: "AAPL" },
  { kw: "마이크로소프트", code: "MSFT" },
  { kw: "microsoft", code: "MSFT" },
  { kw: "알파벳", code: "GOOGL" },
  { kw: "alphabet", code: "GOOGL" },
  { kw: "구글", code: "GOOGL" },
  { kw: "google", code: "GOOGL" },
  { kw: "메타", code: "META" },
  { kw: "meta platforms", code: "META" },
  { kw: "아마존", code: "AMZN" },
  { kw: "amazon", code: "AMZN" },
  { kw: "테슬라", code: "TSLA" },
  { kw: "tesla", code: "TSLA" },
  { kw: "tsmc", code: "TSM" },
  { kw: "팔란티어", code: "PLTR" },
  { kw: "palantir", code: "PLTR" },
  // ── 2026-06 미국 카탈로그 확장 (한·영 키워드 매핑) ───────
  // 반도체/AI 인프라
  { kw: "브로드컴", code: "AVGO" },
  { kw: "broadcom", code: "AVGO" },
  { kw: "퀄컴", code: "QCOM" },
  { kw: "qualcomm", code: "QCOM" },
  { kw: "마이크론", code: "MU" },
  { kw: "micron", code: "MU" },
  { kw: "arm holdings", code: "ARM" },
  { kw: "마벨", code: "MRVL" },
  { kw: "marvell", code: "MRVL" },
  { kw: "슈퍼마이크로", code: "SMCI" },
  { kw: "super micro", code: "SMCI" },
  // AI 소프트웨어
  { kw: "오라클", code: "ORCL" },
  { kw: "oracle", code: "ORCL" },
  { kw: "세일즈포스", code: "CRM" },
  { kw: "salesforce", code: "CRM" },
  { kw: "서비스나우", code: "NOW" },
  { kw: "servicenow", code: "NOW" },
  { kw: "어도비", code: "ADBE" },
  { kw: "adobe", code: "ADBE" },
  // 헬스케어
  { kw: "일라이릴리", code: "LLY" },
  { kw: "eli lilly", code: "LLY" },
  { kw: "유나이티드헬스", code: "UNH" },
  { kw: "unitedhealth", code: "UNH" },
  // 핀테크
  { kw: "비자카드", code: "V" },
  { kw: "마스터카드", code: "MA" },
  { kw: "mastercard", code: "MA" },
  // 소비/리테일
  { kw: "코스트코", code: "COST" },
  { kw: "costco", code: "COST" },
  { kw: "월마트", code: "WMT" },
  { kw: "walmart", code: "WMT" },
  { kw: "홈디포", code: "HD" },
  { kw: "home depot", code: "HD" },
  // 중국 ADR
  { kw: "알리바바", code: "BABA" },
  { kw: "alibaba", code: "BABA" },
  { kw: "테무", code: "PDD" },
  { kw: "pdd holdings", code: "PDD" },
  { kw: "pinduoduo", code: "PDD" },
  // 에너지
  { kw: "엑손모빌", code: "XOM" },
  { kw: "exxon", code: "XOM" },
  { kw: "셰브론", code: "CVX" },
  { kw: "chevron", code: "CVX" },
  // 핫 테마 — BTC 노출·코인 거래소
  { kw: "마이크로스트래티지", code: "MSTR" },
  { kw: "microstrategy", code: "MSTR" },
  { kw: "코인베이스", code: "COIN" },
  { kw: "coinbase", code: "COIN" },
];

function matchSymbol(text: string): string | null {
  const t = text.toLowerCase();
  for (const { kw, code } of SYMBOL_MAP) {
    if (t.includes(kw.toLowerCase())) return code;
  }
  return null;
}

const KEYWORDS = [
  "반도체", "HBM", "AI", "엔비디아", "TSMC", "감산",
  "환율", "원달러", "트럼프", "관세", "전쟁", "Fed", "금리",
];
function extractKeywords(text: string): string[] {
  return KEYWORDS.filter((k) => text.toLowerCase().includes(k.toLowerCase()));
}

// 시장 분위기에 영향 줄 만한 리스크 키워드 추출
export function riskKeywords(items: NewsItem[]): string[] {
  const all = items.flatMap((i) => i.keywords ?? []);
  const counts = new Map<string, number>();
  for (const k of all) counts.set(k, (counts.get(k) ?? 0) + 1);
  const risky = ["전쟁", "관세", "트럼프", "감산", "환율"];
  return risky.filter((k) => (counts.get(k) ?? 0) >= 1);
}
