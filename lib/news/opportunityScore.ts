// 헤드라인 → 외부 호재 점수. riskScore와 대칭 구조.
//
// 공식:
//   per-hit = weight * timeDecay(age)
//   timeDecay = 6h 내 1.0, 24h 내 0.7, 3d 내 0.35, 7d 내 0.15, 그 이후 0
//   score = clamp(round(sum(per-hit) * 6), 0, 100)
//
// threshold:
//   score >= 60 → high   (호재 매우 큼)
//   score >= 30 → medium (호재 의미 있음)
//   else        → low    (특이사항 없음)
//
// 차이점 (risk vs opportunity):
//   - "종목 관련성"이 risk보다 더 엄격. 헤드라인이 종목명 또는 종목 코드 직접 포함할 때만
//     매칭. 시장 전반 호재("코스피 사상 최대" 등)는 펌프 위험이 커서 제외.
//   - verdict shift는 절대 하지 않음 (안전장치 부족). reasons + UI 노출만.

import { matchOpportunityKeywords } from "./positiveKeywords";
import { dominantHeadlineSide } from "./headlineSide";
import { timeDecay } from "./riskScore";
import type {
  OpportunityAssessment,
  NewsOpportunityDriver,
  NewsOpportunityLevel,
} from "../types";

export type { OpportunityAssessment, NewsOpportunityDriver, NewsOpportunityLevel };

interface NewsLike {
  title: string;
  publishedAt: number;
  symbol?: string | null;
}

/**
 * 특정 종목의 호재 점수를 계산한다.
 *
 * @param newsItems  종목 관련 후보 뉴스 (snapshot에서 이미 필터링한 목록)
 * @param code       종목 코드 (예: "005930.KS") — 시장 전반 뉴스 제외 시 사용
 * @param name       종목명 (예: "삼성전자") — 헤드라인에 종목명 포함 여부 검증
 * @param now        현재 시각 (테스트용)
 *
 * 안전장치:
 *   - 시장 전반 뉴스(symbol == null이고 종목명도 안 포함)는 무시 → 펌프 방지
 *   - 동일 라벨·동일 헤드라인 클러스터 cap (riskScore와 동일)
 *   - 24h 내 같은 카테고리 최대 3개 cap
 */
export function assessOpportunity(
  newsItems: NewsLike[],
  code: string,
  name: string,
  now: number = Date.now()
): OpportunityAssessment {
  const drivers: NewsOpportunityDriver[] = [];
  let raw = 0;
  let matchCount = 0;

  const clusterMax = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const normalize = (s: string): string =>
    s.replace(/[\s.,!?·…\-—()[\]"'""'']/g, "").slice(0, 20);

  // 종목 관련성 엄격 판정 — symbol 일치 또는 헤드라인에 종목명 포함.
  const isRelated = (n: NewsLike): boolean => {
    if (n.symbol === code) return true;
    if (name && n.title && n.title.includes(name)) return true;
    return false;
  };

  for (const item of newsItems) {
    if (!isRelated(item)) continue;
    const age = now - item.publishedAt;
    const decay = timeDecay(age);
    if (decay === 0) continue;
    // 같은 헤드라인이 risk 키워드에 더 강하게 매칭되면 opportunity 카운트 skip.
    // ("실적 사상 최대에도 트럼프 관세 위협" 같은 양방향 부풀림 방지.) 동률·근접도 skip.
    if (dominantHeadlineSide(item.title) !== "opportunity") continue;
    const hits = matchOpportunityKeywords(item.title);
    const headlineKey = normalize(item.title);
    for (const h of hits) {
      const contribution = h.weight * decay;
      const clusterKey = `${h.label}::${headlineKey}`;
      const prev = clusterMax.get(clusterKey) ?? 0;
      if (contribution <= prev) {
        drivers.push({
          label: h.label,
          category: h.category,
          headline: item.title,
          date: item.publishedAt,
          weight: h.weight,
          contribution,
        });
        continue;
      }
      if (age <= DAY_MS) {
        const cnt = categoryCount.get(h.category) ?? 0;
        if (cnt >= 3 && prev === 0) {
          drivers.push({
            label: h.label,
            category: h.category,
            headline: item.title,
            date: item.publishedAt,
            weight: h.weight,
            contribution,
          });
          continue;
        }
        if (prev === 0) categoryCount.set(h.category, cnt + 1);
      }
      raw += contribution - prev;
      clusterMax.set(clusterKey, contribution);
      matchCount += 1;
      drivers.push({
        label: h.label,
        category: h.category,
        headline: item.title,
        date: item.publishedAt,
        weight: h.weight,
        contribution,
      });
    }
  }

  const score = clamp(Math.round(raw * 6), 0, 100);

  const byLabel = new Map<string, NewsOpportunityDriver>();
  for (const d of drivers) {
    const prev = byLabel.get(d.label);
    if (!prev || prev.contribution < d.contribution) byLabel.set(d.label, d);
  }
  const dedupedDrivers = Array.from(byLabel.values())
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);

  let level: NewsOpportunityLevel;
  if (score >= 60) level = "high";
  else if (score >= 30) level = "medium";
  else level = "low";

  return { level, score, drivers: dedupedDrivers, matchCount };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function emptyOpportunityAssessment(): OpportunityAssessment {
  return { level: "low", score: 0, drivers: [], matchCount: 0 };
}
