import "server-only";
import Parser from "rss-parser";
import crypto from "node:crypto";
import type { NewsItem } from "../types";

const parser = new Parser({
  timeout: 6000,
  headers: { "User-Agent": "Mozilla/5.0 stock-dashboard/0.1" },
});

// 한국어 검색 (네이버 인덱스 기반) + 영어/글로벌 (Google News English)
function feedUrl(query: string, lang: "ko" | "en"): string {
  const q = encodeURIComponent(query);
  if (lang === "ko") {
    return `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
  }
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

// 종목/시장 키워드별 fetch
// 추천에 자주 등장하는 시총 상위 종목 위주로 회사별 뉴스 커버리지를 확대했다.
// (RSS fetch 비용을 고려해 약 18종목 수준)
const QUERIES: Array<{ q: string; symbol?: string; lang: "ko" | "en" }> = [
  // 반도체 핵심
  { q: "삼성전자", symbol: "005930.KS", lang: "ko" },
  { q: "SK하이닉스", symbol: "000660.KS", lang: "ko" },
  { q: "삼성전기", symbol: "009150.KS", lang: "ko" },
  // IT가전·자동차
  { q: "LG전자", symbol: "066570.KS", lang: "ko" },
  { q: "현대차", symbol: "005380.KS", lang: "ko" },
  { q: "기아", symbol: "000270.KS", lang: "ko" },
  // 배터리·인터넷
  { q: "LG에너지솔루션", symbol: "373220.KS", lang: "ko" },
  { q: "네이버 NAVER", symbol: "035420.KS", lang: "ko" },
  { q: "카카오", symbol: "035720.KS", lang: "ko" },
  // 방산·항공·조선·원전
  { q: "한화에어로스페이스", symbol: "012450.KS", lang: "ko" },
  { q: "한국항공우주", symbol: "047810.KS", lang: "ko" },
  { q: "두산에너빌리티", symbol: "034020.KS", lang: "ko" },
  { q: "대한항공", symbol: "003490.KS", lang: "ko" },
  // 바이오
  { q: "삼성바이오로직스", symbol: "207940.KS", lang: "ko" },
  // 시장 전반
  { q: "반도체", lang: "ko" },
  { q: "환율 달러", lang: "ko" },
  { q: "Nvidia semiconductor", lang: "en" },
  { q: "Fed rate", lang: "en" },
];

export async function fetchAllNews(limit = 40): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    QUERIES.map(async (cfg) => {
      const feed = await parser.parseURL(feedUrl(cfg.q, cfg.lang));
      return (feed.items ?? []).slice(0, 8).map((item) => toNewsItem(item, cfg.symbol));
    })
  );

  const merged: NewsItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") merged.push(...r.value);
  }

  // 중복 제거 (id 기준), 시간 역순, 상위 limit
  const seen = new Set<string>();
  const dedup: NewsItem[] = [];
  for (const n of merged.sort((a, b) => b.publishedAt - a.publishedAt)) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    dedup.push(n);
    if (dedup.length >= limit) break;
  }
  return dedup;
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

// 단순 키워드 매핑 기반 sentiment 분류
const POSITIVE = [
  "최고", "신고가", "급등", "호조", "흑자", "수주", "확대", "성장",
  "강세", "호황", "매수", "상향", "기대", "돌파", "투자 확대",
  "beat", "surge", "rally", "record high", "upgrade",
];
const NEGATIVE = [
  "급락", "하락", "약세", "부진", "적자", "위기", "우려", "충격",
  "폭락", "감산", "감소", "축소", "관세", "전쟁", "리스크", "둔화",
  "fall", "drop", "tumble", "miss", "downgrade", "war", "tariff",
];

function classifySentiment(text: string): NewsItem["sentiment"] {
  const t = text.toLowerCase();
  const pos = POSITIVE.some((k) => t.includes(k.toLowerCase()));
  const neg = NEGATIVE.some((k) => t.includes(k.toLowerCase()));
  if (pos && !neg) return "positive";
  if (neg && !pos) return "negative";
  if (pos && neg) return "neutral";
  return "neutral";
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
  { kw: "엔비디아", code: "NVDA" },
  { kw: "nvidia", code: "NVDA" },
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
