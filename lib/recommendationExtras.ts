import "server-only";
import type {
  AnalystConsensus,
  NewsItem,
  RecommendationCatalystNews,
  RecommendationConsensusSnap,
} from "./types";

// 컨센서스 → 카드 펼침 영역용 미니 스냅샷.
// recommendationKey 또는 recommendationMean(1~5)을 한국어 라벨로 압축해서
// 사용자가 한 줄로 "강한매수" / "매수우위" / "중립" / "매도우위" / "강한매도" 처럼 읽을 수 있게 한다.
//
// Yahoo recommendationMean 척도(1=strong buy ~ 5=strong sell) 기준이라
// 낮을수록 매수 의견이 강하다는 점에 주의.
export function buildConsensusSnap(
  c: AnalystConsensus | null,
  currentPrice: number
): RecommendationConsensusSnap | null {
  if (!c) return null;
  const upside =
    c.upsidePercent ??
    (c.targetMean != null && currentPrice > 0
      ? c.targetMean / currentPrice - 1
      : null);
  let opinion: string | null = null;
  if (c.recommendationKey) {
    const m: Record<string, string> = {
      strong_buy: "강한매수",
      buy: "매수우위",
      hold: "중립",
      sell: "매도우위",
      strong_sell: "강한매도",
    };
    opinion = m[c.recommendationKey] ?? null;
  } else if (c.recommendationMean != null) {
    const mean = c.recommendationMean;
    if (mean <= 1.8) opinion = "강한매수";
    else if (mean <= 2.4) opinion = "매수우위";
    else if (mean <= 3.2) opinion = "중립";
    else if (mean <= 4.0) opinion = "매도우위";
    else opinion = "강한매도";
  }
  return {
    targetMean: c.targetMean,
    upsidePercent: upside,
    analystCount: c.analystCount ?? null,
    opinionLabel: opinion,
    domesticMean: c.domesticMean ?? null,
    domesticUpsidePercent: c.domesticUpsidePercent ?? null,
  };
}

// 종목 관련 뉴스 → 카드 펼침 영역용 카탈리스트 헤드라인 (최대 limit건).
// positive 우선, 그 다음 neutral. negative는 catalyst가 아니라 위험 쪽에서 외부 risk drivers
// 로 이미 노출되므로 여기선 제외한다.
export function pickCatalystNews(
  related: NewsItem[],
  symbol: string,
  name: string,
  limit = 2
): RecommendationCatalystNews[] {
  const matched = related.filter(
    (n) => n.symbol === symbol || (n.title || "").includes(name)
  );
  const sortByRecent = (a: NewsItem, b: NewsItem) =>
    b.publishedAt - a.publishedAt;
  const pos = matched
    .filter((n) => n.sentiment === "positive")
    .sort(sortByRecent);
  const neu = matched
    .filter((n) => n.sentiment !== "positive" && n.sentiment !== "negative")
    .sort(sortByRecent);
  const merged = [...pos, ...neu].slice(0, limit);
  return merged.map((n) => ({
    title: n.title,
    source: n.source,
    publishedAt: n.publishedAt,
    sentiment: n.sentiment ?? null,
  }));
}
