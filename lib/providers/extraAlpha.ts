import "server-only";
import type { ChronoPulseFactor } from "../analyzer/chronoPulse";
import {
  disclosureFactorsFromDart,
  disclosureFactorsFromEdgar,
  mergeDisclosureFactors,
} from "../analyzer/disclosureFeatures";
import { computeOrderbookSignal } from "../analyzer/orderbookSignal";
import { assessNewsSentimentAlpha } from "../news/sentimentScore";
import {
  fetchOpenDartFilings,
  toDartStockCode,
} from "./opendart";
import { fetchEdgarFilings, isUsTickerCode } from "./edgar";
import { getKrAskingPriceCached } from "./kisExtraCache";
import { kisEnabled } from "./kis";
import { isKrStock } from "./naver";

interface NewsLike {
  title: string;
  titleKo?: string | null;
  summary?: string | null;
  publishedAt: number;
  symbol?: string | null;
}

/** OpenDART/SEC 공시 — full 예측 알파용. critical path 를 막지 않게 1s. */
const EXTRA_ALPHA_BUDGET_MS = 1_000;

/**
 * 종목별 추가 알파 팩터 수집 (공시·뉴스감성·호가).
 * API 키/데이터 없으면 해당 소스만 skip.
 * 느린 OpenDART/SEC 는 budget 안에서만 대기 — 예측 기본 경로는 막지 않음.
 */
export async function collectExtraAlphaFactors(opts: {
  code: string;
  relatedNews: NewsLike[];
  /** true 면 뉴스 감성만 (core 스냅샷) */
  skipSlowSources?: boolean;
}): Promise<ChronoPulseFactor[]> {
  const { code, relatedNews, skipSlowSources } = opts;
  const factors: ChronoPulseFactor[] = [];

  // 1) 뉴스 감성 (항상 — 키워드 규칙, 동기)
  const sent = assessNewsSentimentAlpha(relatedNews, code);
  if (sent.label && Math.abs(sent.alphaBps) >= 2) {
    factors.push({
      id: "news-sent",
      label: sent.label,
      bps: sent.alphaBps,
    });
  }

  if (skipSlowSources) {
    return factors;
  }

  const slow = (async (): Promise<ChronoPulseFactor[]> => {
    const out: ChronoPulseFactor[] = [];
    const dartCode = toDartStockCode(code);
    const [dartFilings, edgarFilings] = await Promise.all([
      dartCode
        ? fetchOpenDartFilings(dartCode).catch(() => [])
        : Promise.resolve([]),
      isUsTickerCode(code)
        ? fetchEdgarFilings(code).catch(() => [])
        : Promise.resolve([]),
    ]);
    out.push(
      ...mergeDisclosureFactors(
        disclosureFactorsFromDart(dartFilings),
        disclosureFactorsFromEdgar(edgarFilings)
      )
    );
    if (kisEnabled() && isKrStock(code)) {
      const asking = await getKrAskingPriceCached(code).catch(() => null);
      const ob = computeOrderbookSignal(asking);
      if (ob.factor) out.push(ob.factor);
    }
    return out;
  })();

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timed = await Promise.race([
    slow,
    new Promise<ChronoPulseFactor[]>((resolve) => {
      timer = setTimeout(() => resolve([]), EXTRA_ALPHA_BUDGET_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  factors.push(...timed);

  // 중복 id 병합 (절대값 큰 쪽)
  const best = new Map<string, ChronoPulseFactor>();
  for (const f of factors) {
    const prev = best.get(f.id);
    if (!prev || Math.abs(f.bps) > Math.abs(prev.bps)) best.set(f.id, f);
  }
  return [...best.values()].sort(
    (a, b) => Math.abs(b.bps) - Math.abs(a.bps)
  );
}
