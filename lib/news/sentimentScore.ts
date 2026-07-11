import { matchRiskKeywords } from "./keywords";
import { matchOpportunityKeywords } from "./positiveKeywords";
import { dominantHeadlineSide } from "./headlineSide";
import { timeDecay } from "./riskScore";

/**
 * 제목(+요약) 감성 점수화 — FinBERT 대체(키워드·규칙 고도화).
 * score: -1 ~ +1
 * UI/알파용 라벨: 뉴스 악재·호재 강도
 */

export interface SentimentScoreResult {
  /** -1(강악재) ~ +1(강호재) */
  score: number;
  posWeight: number;
  negWeight: number;
  label: string | null;
  /** ChronoPulse bps 환산 (약한~중간, ±40 cap) */
  alphaBps: number;
}

interface NewsLike {
  title: string;
  titleKo?: string | null;
  summary?: string | null;
  publishedAt: number;
  symbol?: string | null;
}

function haystack(item: NewsLike): string {
  const parts = [item.title];
  if (item.titleKo && item.titleKo !== item.title) parts.push(item.titleKo);
  if (item.summary) parts.push(item.summary);
  return parts.join("\n");
}

/** 단일 헤드라인 점수 (−1~+1) */
export function scoreHeadlineSentiment(
  title: string,
  titleKo?: string | null,
  summary?: string | null
): { score: number; posWeight: number; negWeight: number } {
  const text = [title, titleKo, summary].filter(Boolean).join("\n");
  const side = dominantHeadlineSide(text);
  const negHits = side === "opportunity" ? [] : matchRiskKeywords(text);
  const posHits = side === "risk" ? [] : matchOpportunityKeywords(text);

  let negWeight = 0;
  let posWeight = 0;
  const seenN = new Set<string>();
  const seenP = new Set<string>();
  for (const h of negHits) {
    if (seenN.has(h.label)) continue;
    seenN.add(h.label);
    negWeight += h.weight;
  }
  for (const h of posHits) {
    if (seenP.has(h.label)) continue;
    seenP.add(h.label);
    posWeight += h.weight;
  }

  const net = posWeight - negWeight;
  // weight 합 10 ≈ |score| 1
  const score = Math.max(-1, Math.min(1, net / 10));
  return { score, posWeight, negWeight };
}

/**
 * 종목 관련 뉴스 묶음 → 감성 알파.
 * 최근·강한 헤드라인에 가중. 종목별로 다른 점수.
 */
export function assessNewsSentimentAlpha(
  items: NewsLike[],
  symbolCode?: string | null,
  now: number = Date.now()
): SentimentScoreResult {
  let weighted = 0;
  let wSum = 0;
  let posWeight = 0;
  let negWeight = 0;

  for (const item of items) {
    if (symbolCode && item.symbol && item.symbol !== symbolCode) continue;
    const decay = timeDecay(now - item.publishedAt);
    if (decay <= 0) continue;
    const { score, posWeight: pw, negWeight: nw } = scoreHeadlineSentiment(
      item.title,
      item.titleKo,
      item.summary
    );
    if (Math.abs(score) < 0.05 && pw + nw === 0) continue;
    const w = decay * (0.6 + Math.min(1, (pw + nw) / 8) * 0.4);
    weighted += score * w;
    wSum += w;
    posWeight += pw * decay;
    negWeight += nw * decay;
  }

  const score = wSum > 0 ? Math.max(-1, Math.min(1, weighted / wSum)) : 0;
  // ±40 bps — 기존 news-opp/risk 와 겹치지만 종목별 세밀 차별화
  const alphaBps = Math.round(score * 40);

  let label: string | null = null;
  if (alphaBps >= 12) label = "뉴스 호조";
  else if (alphaBps >= 5) label = "뉴스 온기";
  else if (alphaBps <= -12) label = "뉴스 악재";
  else if (alphaBps <= -5) label = "뉴스 경계";

  return { score, posWeight, negWeight, label, alphaBps };
}
