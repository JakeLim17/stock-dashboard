import type { ChronoPulseFactor } from "../analyzer/chronoPulse";

/** 기습 주주환원·자사주·배당·소각 — OpenDART 키 없어도 뉴스에서 단기 알파. */

const DAY = 86_400_000;
const CAP_BPS = 80;
const WINDOW_MS = 36 * 60 * 60 * 1000;

const NEGATIVE_RE =
  /(환원\s*철회|배당\s*(삭감|축소|중단)|자사주\s*매입\s*(철회|취소)|배당락)/i;

const STRONG_RE =
  /(주주환원|환원\s*(계획|정책|확대)|자기주식\s*소각|자사주\s*소각|shareholder\s+return|treasury\s+share|share\s+cancellation)/i;

const BUYBACK_RE =
  /(자사주\s*매입|자기주식\s*취득|자기주식매입|buyback|share\s+repurchase)/i;

const DIVIDEND_RE =
  /(특별\s*배당|중간\s*배당|배당\s*(인상|확대|증액|결정)|dividend\s+(hike|increase|raise|boost)|special\s+dividend)/i;

interface NewsLike {
  title: string;
  titleKo?: string | null;
  summary?: string | null;
  publishedAt: number;
  symbol?: string | null;
}

function haystack(n: NewsLike): string {
  return [n.title, n.titleKo, n.summary].filter(Boolean).join("\n");
}

function freshness(ageMs: number): number {
  if (ageMs < 0) return 0;
  if (ageMs <= 12 * 60 * 60 * 1000) return 1;
  if (ageMs <= WINDOW_MS) return 0.7;
  if (ageMs <= 2 * DAY) return 0.35;
  return 0;
}

function formatAppliedPct(bps: number): string {
  const pct = bps / 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * 종목 관련 뉴스에서 환원·자사주·배당 호재를 잡아 ChronoPulse 칩 1개.
 * 악재(철회·삭감)면 스킵. 캡 ±80bps.
 */
export function shareholderReturnFactorFromNews(
  items: NewsLike[],
  now: number = Date.now()
): ChronoPulseFactor | null {
  let best = 0;
  for (const item of items) {
    const age = now - item.publishedAt;
    const w = freshness(age);
    if (w <= 0) continue;
    const text = haystack(item);
    if (!text) continue;
    if (NEGATIVE_RE.test(text)) continue;
    let raw = 0;
    if (STRONG_RE.test(text)) raw = 72;
    else if (BUYBACK_RE.test(text)) raw = 48;
    else if (DIVIDEND_RE.test(text)) raw = 32;
    if (raw === 0) continue;
    best = Math.max(best, Math.round(raw * w));
  }
  const bps = Math.min(CAP_BPS, best);
  if (bps < 4) return null;
  return {
    id: "disclosure-return",
    label: `공시·환원 호재 ${formatAppliedPct(bps)}`,
    bps,
  };
}
