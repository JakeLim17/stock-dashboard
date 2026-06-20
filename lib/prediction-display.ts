import type { Quote, StockSnapshot } from "./types";

/** Ticker 자체 추정가 — GDR·σ드리프트·현재가 가중 혼합 (kospilab Binance 방식 아님) */
export interface FairValueEstimate {
  price: number;
  /** 전일 종가 대비 */
  vsCloseRate: number;
  /** 현재가 대비 */
  vsLiveRate: number;
  methodLabel: string;
  detail: string;
}

function isKrMarketClosed(quote: Quote): boolean {
  const s = (quote.marketState ?? "").toUpperCase();
  return (
    s === "PREPRE" ||
    s === "POSTPOST" ||
    s === "CLOSED" ||
    s === "PRE"
  );
}

/** 우리식 추정가 — overseasNight(GDR) + predictions.ranges 중심 + 현재가 블렌드 */
export function buildFairValueEstimate(
  snap: StockSnapshot
): FairValueEstimate | null {
  const { quote, overseasNight, predictions } = snap;
  const live = quote.price;
  const prevClose = quote.prevClose;
  if (!live || live <= 0 || !prevClose || prevClose <= 0) return null;

  const oneDay = predictions?.ranges.find((r) => r.horizonDays === 1);
  const driftCenter = oneDay?.center ?? live;
  const gdr = overseasNight?.impliedKrwPrice ?? null;
  const closed = isKrMarketClosed(quote);

  let price: number;
  let methodLabel: string;
  let detail: string;

  if (gdr != null && gdr > 0) {
    if (closed) {
      price = gdr * 0.55 + driftCenter * 0.3 + live * 0.15;
      methodLabel = "야간 혼합";
      detail = "GDR 55% · σ드리프트 30% · 종가 15%";
    } else {
      price = gdr * 0.25 + driftCenter * 0.35 + live * 0.4;
      methodLabel = "장중 혼합";
      detail = "GDR 25% · σ드리프트 35% · 현재가 40%";
    }
  } else if (oneDay) {
    price = driftCenter * 0.4 + live * 0.6;
    methodLabel = "σ 드리프트";
    detail = "1일 통계 중심 40% · 현재가 60%";
  } else {
    return null;
  }

  return {
    price: Math.round(price),
    vsCloseRate: price / prevClose - 1,
    vsLiveRate: price / live - 1,
    methodLabel,
    detail,
  };
}

/** TP2 산출 근거 한국어 라벨 */
export function takeProfit2SourceLabel(
  source?: "atr" | "resistance" | "floor" | null
): string | null {
  switch (source) {
    case "atr":
      return "ATR 3.5×";
    case "resistance":
      return "20일 저항";
    case "floor":
      return "보수적 floor";
    default:
      return null;
  }
}

/** ATR% 추정 — TP1 = entry + 2·ATR 이므로 역산 */
export function estimateAtrPct(
  entry: number,
  takeProfit1: number
): number | null {
  if (entry <= 0 || takeProfit1 <= entry) return null;
  const atr = (takeProfit1 - entry) / 2;
  return atr / entry;
}

/** 모델 신뢰도 breakdown — 기존 스냅샷 점수만 조합 (새 API 없음) */
export function buildConfidenceBreakdown(snap: StockSnapshot): Array<{
  label: string;
  score: number;
}> {
  const a = snap.analysis;
  const p = snap.predictions;
  const out: Array<{ label: string; score: number }> = [];

  const volScore = a.volatility?.score;
  if (volScore != null) {
    out.push({
      label: "변동성 적합",
      score: Math.max(0, Math.min(100, 100 - volScore)),
    });
  }

  out.push({
    label: "매수·수급",
    score: Math.round(a.buyScore),
  });

  const macroR2 = maxMacroR2(p?.macroBetas);
  if (macroR2 != null) {
    out.push({
      label: "매크로 연동",
      score: Math.round(macroR2 * 100),
    });
  }

  const modelConf = p?.modelConfidence?.score;
  if (modelConf != null) {
    out.push({
      label: "모델 신뢰",
      score: Math.round(modelConf * 100),
    });
  }

  return out;
}

function maxMacroR2(
  macroBetas?: NonNullable<
    NonNullable<StockSnapshot["predictions"]>["macroBetas"]
  > | null
): number | null {
  if (!macroBetas) return null;
  let m = 0;
  let any = false;
  for (const k of ["ixic", "kospi", "sox", "dxy"] as const) {
    const r = macroBetas[k]?.r2;
    if (r != null && r > m) {
      m = r;
      any = true;
    }
  }
  return any ? m : null;
}

/** VIX·달러/금리 매크로 영향 1줄 — predictor modelConfidence.factors 에서 추출 */
export function buildMacroImpactLine(snap: StockSnapshot): string | null {
  const factors = snap.predictions?.modelConfidence?.factors ?? [];
  const vixLine = factors.find((f) => /VIX/i.test(f));
  const parts: string[] = [];
  if (vixLine) parts.push(vixLine);

  const dxyScenario = snap.predictions?.scenarios.find(
    (s) => /환율|달러|DXY/i.test(s.label)
  );
  if (dxyScenario) {
    parts.push(
      `달러 ${dxyScenario.label.replace(/ 시$/, "")} → 종목 ${formatPctSigned(dxyScenario.expected)}`
    );
  }

  const rateScenario = snap.predictions?.scenarios.find((s) =>
    /금리|10년|US10Y/i.test(s.label)
  );
  if (rateScenario) {
    parts.push(
      `금리 ${rateScenario.label.replace(/ 시$/, "")} → ${formatPctSigned(rateScenario.expected)}`
    );
  }

  if (parts.length === 0) {
    const macroBetas = snap.predictions?.macroBetas;
    if (macroBetas?.dxy?.beta != null) {
      parts.push(`DXY β ${macroBetas.dxy.beta.toFixed(2)} (R² ${macroBetas.dxy.r2.toFixed(2)})`);
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatPctSigned(rate: number): string {
  const pct = rate * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** verdict 근거 bullet 2~3개 — analysis·flow·consensus·시장 semiHeat */
export function collectVerdictBullets(
  snap: StockSnapshot,
  marketSemiHeat?: number | null
): string[] {
  const bullets: string[] = [];
  const v = snap.analysis.verdict;

  if (v.reasonLine) bullets.push(v.reasonLine);

  if (v.momentumOverride) {
    bullets.push("단기 모멘텀 override 적용");
  }

  if (
    marketSemiHeat != null &&
    marketSemiHeat >= 65 &&
    !bullets.some((b) => b.includes("반도체"))
  ) {
    bullets.push(`시장 반도체 과열 ${marketSemiHeat}/100`);
  }

  for (const r of snap.analysis.shortTerm.reasons) {
    if (bullets.length >= 3) break;
    if (!bullets.includes(r)) bullets.push(r);
  }

  const flow = snap.flow;
  if (bullets.length < 3 && flow.foreignNet5d != null) {
    const eok = flow.foreignNet5d / 1e8;
    const sign = eok >= 0 ? "+" : "";
    bullets.push(`외인 5일 ${sign}${eok.toFixed(0)}억`);
  } else if (bullets.length < 3 && flow.foreignNet != null) {
    const eok = flow.foreignNet / 1e8;
    const sign = eok >= 0 ? "+" : "";
    bullets.push(`외인 당일 ${sign}${eok.toFixed(0)}억`);
  }

  const c = snap.consensus;
  if (bullets.length < 3 && c?.upsidePercent != null) {
    const pct = c.upsidePercent * 100;
    const sign = pct >= 0 ? "+" : "";
    bullets.push(`컨센 상승여력 ${sign}${pct.toFixed(0)}%`);
  }

  return bullets.slice(0, 3);
}

/** 카드 compact 1줄 — TP · SL · 신뢰% */
export function buildPredictionCompactLine(
  snap: StockSnapshot,
  decimals = 0
): string | null {
  const t = snap.predictions?.targets;
  const conf = snap.predictions?.modelConfidence?.score;
  if (!t && conf == null) return null;

  const parts: string[] = [];
  if (t?.takeProfit1 != null) {
    parts.push(`TP ${formatCompactPrice(t.takeProfit1, decimals)}`);
  }
  if (t?.stopLoss != null) {
    parts.push(`SL ${formatCompactPrice(t.stopLoss, decimals)}`);
  }
  if (conf != null) {
    parts.push(`신뢰 ${Math.round(conf * 100)}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatCompactPrice(v: number, decimals: number): string {
  if (decimals > 0) return v.toFixed(decimals);
  return Math.round(v).toLocaleString("ko-KR");
}
