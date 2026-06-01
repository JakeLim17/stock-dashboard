// 헤드라인 → 외부 리스크 점수.
//
// 공식:
//   per-hit = weight * timeDecay(age)
//   timeDecay = 6h 내 1.0, 24h 내 0.7, 3d 내 0.35, 7d 내 0.15, 그 이후 0
//   score = clamp(round(sum(per-hit) * 6), 0, 100)
//     - weight 5짜리 하나(6h 내) → 30점 (medium 진입)
//     - weight 4 두 개(24h 내) → 4*0.7*6*2 ≈ 33점 (medium)
//     - weight 5 두 개(6h 내) → 60점 (high 진입)
//
// threshold:
//   score >= 60 → high
//   score >= 30 → medium
//   else        → low
//
// drivers: 점수 기여도(weight × decay) 큰 순으로 최대 5개. UI 배지/툴팁용.

import { matchRiskKeywords } from "./keywords";
import type {
  NewsRiskAssessment,
  NewsRiskDriver,
  NewsRiskLevel,
} from "../types";

export type { NewsRiskAssessment, NewsRiskDriver, NewsRiskLevel };

const H = 60 * 60 * 1000;
const D = 24 * H;

// 발행 시각이 얼마나 오래되었는지에 따라 가중치 감쇠.
// 24h 이내 뉴스 위주로 보고, 그 이전은 빠르게 떨어진다.
export function timeDecay(ageMs: number): number {
  if (ageMs < 0) return 1; // 미래 표기는 그냥 1로 처리
  if (ageMs <= 6 * H) return 1.0;
  if (ageMs <= 24 * H) return 0.7;
  if (ageMs <= 3 * D) return 0.35;
  if (ageMs <= 7 * D) return 0.15;
  return 0;
}

interface NewsLike {
  title: string;
  publishedAt: number;
}

export function assessNewsRisk(
  newsItems: NewsLike[],
  now: number = Date.now()
): NewsRiskAssessment {
  const drivers: NewsRiskDriver[] = [];
  let raw = 0;
  let matchCount = 0;

  // 동일 이벤트 클러스터링용 — 같은 키워드 라벨 + 정규화된 헤드라인(앞 20자) 해시로
  // 중복 제거. 하나의 사건이 여러 매체에 동일 헤드라인으로 올라오면 점수 부풀림이
  // 발생하는 결함을 방어한다. 같은 클러스터에서는 가장 큰 contribution만 카운트.
  const clusterMax = new Map<string, number>();
  // 같은 키워드 카테고리는 24h 내 최대 3개로 cap
  const categoryCount = new Map<string, number>();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // 헤드라인 정규화 — 공백·특수문자 제거 후 앞 20자.
  const normalize = (s: string): string =>
    s.replace(/[\s.,!?·…\-—()[\]"'""'']/g, "").slice(0, 20);

  for (const item of newsItems) {
    const age = now - item.publishedAt;
    const decay = timeDecay(age);
    if (decay === 0) continue;
    const hits = matchRiskKeywords(item.title);
    const headlineKey = normalize(item.title);
    for (const h of hits) {
      const contribution = h.weight * decay;
      const clusterKey = `${h.label}::${headlineKey}`;
      // 같은 클러스터(같은 라벨 + 동일/유사 헤드라인): 최대 contribution만 채택
      const prev = clusterMax.get(clusterKey) ?? 0;
      if (contribution <= prev) {
        // 약한 중복은 drivers에는 추가하되 raw 합산은 건너뜀 (UI 표시용)
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
      // 새 cluster 또는 기존보다 큰 contribution — 차이만큼 raw 가산
      // 24h 내 같은 카테고리 최대 3개 cap (이벤트 다중 보도 방어)
      if (age <= DAY_MS) {
        const cnt = categoryCount.get(h.category) ?? 0;
        if (cnt >= 3 && prev === 0) {
          // cap 초과 새 클러스터는 drivers만 기록하고 raw에는 가산하지 않음
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

  // 합산을 0~100 스케일로. 6배 곱하면 weight 5 한 건(6h 내) 30점.
  const score = clamp(Math.round(raw * 6), 0, 100);

  // 같은 label이 여러 헤드라인에서 잡힐 수 있다. 같은 라벨이면 가장 contribution 큰 것만 남긴다.
  const byLabel = new Map<string, NewsRiskDriver>();
  for (const d of drivers) {
    const prev = byLabel.get(d.label);
    if (!prev || prev.contribution < d.contribution) byLabel.set(d.label, d);
  }
  const dedupedDrivers = Array.from(byLabel.values())
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);

  let level: NewsRiskLevel;
  if (score >= 60) level = "high";
  else if (score >= 30) level = "medium";
  else level = "low";

  return { level, score, drivers: dedupedDrivers, matchCount };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// 비어있을 때의 기본값 — analyzer가 input 누락 시 안전하게 쓸 수 있게.
export function emptyRiskAssessment(): NewsRiskAssessment {
  return { level: "low", score: 0, drivers: [], matchCount: 0 };
}
