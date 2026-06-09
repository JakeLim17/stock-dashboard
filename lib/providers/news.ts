import "server-only";
import Parser from "rss-parser";
import crypto from "node:crypto";
import type { NewsItem } from "../types";
import { RISK_KEYWORDS } from "../news/keywords";
import { POSITIVE_KEYWORDS } from "../news/positiveKeywords";

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

// 종목/시장 키워드별 fetch.
// 추천에 자주 등장하는 시총 상위 종목 + 사용자 관심 종목 위주.
// 한·영 두 쿼리를 잡아 글로벌 매체 호재(예: "Hyundai Motor wins order")까지 커버.
const QUERIES: Array<{ q: string; symbol?: string; lang: "ko" | "en" }> = [
  // ── 반도체 핵심 ──────────────────────────────────────────
  { q: "삼성전자", symbol: "005930.KS", lang: "ko" },
  { q: "Samsung Electronics", symbol: "005930.KS", lang: "en" },
  { q: "SK하이닉스", symbol: "000660.KS", lang: "ko" },
  { q: "SK Hynix HBM", symbol: "000660.KS", lang: "en" },
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

  // ── 시장 전반 ───────────────────────────────────────────
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

// sentiment 분류는 RISK_KEYWORDS / POSITIVE_KEYWORDS 의 정규식+가중치를 그대로 재사용.
// 두 사전이 단일 진실의 소스(SSOT)이므로 키워드 추가/수정이 sentiment 분류에도 즉시 반영된다.
//
// 가중치 합계가 큰 쪽으로 결론. 비슷하면 neutral.
function classifySentiment(text: string): NewsItem["sentiment"] {
  let posWeight = 0;
  let negWeight = 0;
  for (const kw of RISK_KEYWORDS) {
    if (kw.pattern.test(text)) negWeight += kw.weight;
  }
  for (const kw of POSITIVE_KEYWORDS) {
    if (kw.pattern.test(text)) posWeight += kw.weight;
  }
  // 차이가 2점 미만이면 neutral — 호재/악재 양쪽이 비슷하면 판단 보류.
  if (Math.abs(posWeight - negWeight) < 2) return "neutral";
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
