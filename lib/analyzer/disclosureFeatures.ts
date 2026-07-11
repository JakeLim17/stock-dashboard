import type { ChronoPulseFactor } from "./chronoPulse";
import type { DartEventKind } from "../providers/opendartClassify";

/** 테스트·런타임 공용 — server-only 의존 없음 */
export interface DartFilingLike {
  kind: DartEventKind;
  label: string;
  dateMs: number;
}

export interface EdgarFilingLike {
  kind: string;
  label: string;
  dateMs: number;
}

/**
 * 공시 이벤트 → ChronoPulse 알파 팩터 (약한~중간 시그널).
 * UI 라벨은 「공시 …」 — 엔진명 비노출.
 */

const DAY = 86_400_000;

function freshness(ageMs: number): number {
  const days = ageMs / DAY;
  if (days <= 1) return 1;
  if (days <= 3) return 0.75;
  if (days <= 7) return 0.45;
  if (days <= 14) return 0.25;
  if (days <= 21) return 0.12;
  return 0;
}

function dartBps(f: DartFilingLike, now: number): number {
  const age = now - f.dateMs;
  const w = freshness(age);
  if (w <= 0) return 0;
  switch (f.kind) {
    case "dilution":
      return Math.round(-42 * w);
    case "risk":
      return Math.round(-55 * w);
    case "merger":
      return Math.round(18 * w); // 방향 불확실 — 약한 관심 가산
    case "buyback":
      return Math.round(32 * w);
    case "bonus":
      return Math.round(12 * w);
    case "ownership":
      return Math.round(8 * w); // 지분변동은 약한 관심
    case "earnings":
      return Math.round(14 * w); // 실적 임박/발표 — 기대(방향은 뉴스와 함께)
    default:
      return 0;
  }
}

function edgarBps(f: EdgarFilingLike, now: number): number {
  const age = now - f.dateMs;
  const w = freshness(age);
  if (w <= 0) return 0;
  switch (f.kind) {
    case "offering":
      return Math.round(-35 * w);
    case "8k":
      return Math.round(10 * w); // 중요 공시 — 약한 관심(방향은 뉴스)
    case "earnings":
      return Math.round(16 * w);
    case "ownership":
      return Math.round(6 * w);
    case "insider":
      return Math.round(4 * w);
    default:
      return 0;
  }
}

/** 동일 kind는 가장 신선한 1건만 반영 */
export function disclosureFactorsFromDart(
  filings: DartFilingLike[],
  now: number = Date.now()
): ChronoPulseFactor[] {
  const best = new Map<string, { bps: number; label: string }>();
  for (const f of filings) {
    const bps = dartBps(f, now);
    if (Math.abs(bps) < 1) continue;
    const prev = best.get(f.kind);
    if (!prev || Math.abs(bps) > Math.abs(prev.bps)) {
      best.set(f.kind, { bps, label: f.label });
    }
  }
  return [...best.entries()].map(([id, v]) => ({
    id: `dart-${id}`,
    label: v.label,
    bps: v.bps,
  }));
}

export function disclosureFactorsFromEdgar(
  filings: EdgarFilingLike[],
  now: number = Date.now()
): ChronoPulseFactor[] {
  const best = new Map<string, { bps: number; label: string }>();
  for (const f of filings) {
    const bps = edgarBps(f, now);
    if (Math.abs(bps) < 1) continue;
    const prev = best.get(f.kind);
    if (!prev || Math.abs(bps) > Math.abs(prev.bps)) {
      best.set(f.kind, { bps, label: f.label });
    }
  }
  return [...best.entries()].map(([id, v]) => ({
    id: `sec-${id}`,
    label: v.label,
    bps: v.bps,
  }));
}

export function mergeDisclosureFactors(
  dart: ChronoPulseFactor[],
  edgar: ChronoPulseFactor[]
): ChronoPulseFactor[] {
  return [...dart, ...edgar]
    .filter((f) => Math.abs(f.bps) >= 1)
    .sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps))
    .slice(0, 4);
}
