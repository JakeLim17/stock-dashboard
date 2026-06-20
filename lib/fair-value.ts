import type { OverseasNightIndicator, Quote, StockSnapshot } from "./types";

/** 가중치 — 삼성전자 92영업일 백테스트(2026-06) 튜닝 */
export const FAIR_VALUE_WEIGHTS = {
  nightClosed: { gdr: 0.6, drift: 0.25, live: 0.15 },
  nightOpen: { gdr: 0.24, drift: 0.35, live: 0.41 },
  noGdr: { drift: 0.45, live: 0.55 },
} as const;

/** 백테스트 요약 — 삼성전자+SMSN.IL 92샘플 (scripts/backtest-fair-value.ts) */
export const FAIR_VALUE_BACKTEST_META = {
  symbol: "005930.KS",
  samples: 92,
  openToClose: { mape: 0.0216, direction: 0.837 },
  nightToNextClose: { mape: 0.0288, direction: 0.87 },
  nightToNextOpen: { mape: 0.0253, direction: 0.913 },
} as const;

export type FairValueWeightTriple = { gdr: number; drift: number; live: number };
export type FairValueWeightPair = { drift: number; live: number };

export type FairValueWeights = {
  nightClosed: FairValueWeightTriple;
  nightOpen: FairValueWeightTriple;
  noGdr: FairValueWeightPair;
};

export interface FairValueInput {
  live: number;
  prevClose: number;
  driftCenter: number;
  gdrImpliedKrw?: number | null;
  marketClosed: boolean;
  weights?: FairValueWeights;
}

/** Ticker 자체 추정가 — GDR·σ드리프트·현재가 가중 혼합 */
export interface FairValueEstimate {
  price: number;
  vsCloseRate: number;
  vsLiveRate: number;
  methodLabel: string;
  detail: string;
}

export function isKrMarketClosed(quote: Quote): boolean {
  const s = (quote.marketState ?? "").toUpperCase();
  return (
    s === "PREPRE" ||
    s === "POSTPOST" ||
    s === "CLOSED" ||
    s === "PRE"
  );
}

export function blendFairValuePrice(input: FairValueInput): {
  price: number;
  methodLabel: string;
  detail: string;
} | null {
  const { live, prevClose, driftCenter, gdrImpliedKrw, marketClosed } = input;
  const w = input.weights ?? FAIR_VALUE_WEIGHTS;
  if (!live || live <= 0 || !prevClose || prevClose <= 0) return null;

  const gdr = gdrImpliedKrw ?? null;

  if (gdr != null && gdr > 0) {
    const cfg = marketClosed ? w.nightClosed : w.nightOpen;
    const price = gdr * cfg.gdr + driftCenter * cfg.drift + live * cfg.live;
    return {
      price: Math.round(price),
      methodLabel: marketClosed ? "야간 혼합" : "장중 혼합",
      detail: marketClosed
        ? `GDR ${Math.round(cfg.gdr * 100)}% · σ드리프트 ${Math.round(cfg.drift * 100)}% · 종가 ${Math.round(cfg.live * 100)}%`
        : `GDR ${Math.round(cfg.gdr * 100)}% · σ드리프트 ${Math.round(cfg.drift * 100)}% · 현재가 ${Math.round(cfg.live * 100)}%`,
    };
  }

  if (driftCenter > 0) {
    const cfg = w.noGdr;
    const price = driftCenter * cfg.drift + live * cfg.live;
    return {
      price: Math.round(price),
      methodLabel: "σ 드리프트",
      detail: `1일 통계 중심 ${Math.round(cfg.drift * 100)}% · 현재가 ${Math.round(cfg.live * 100)}%`,
    };
  }

  return null;
}

export function buildFairValueEstimate(
  snap: StockSnapshot,
  weights?: FairValueWeights
): FairValueEstimate | null {
  const { quote, overseasNight, predictions } = snap;
  const oneDay = predictions?.ranges.find((r) => r.horizonDays === 1);
  const driftCenter = oneDay?.center ?? quote.price;

  const blended = blendFairValuePrice({
    live: quote.price,
    prevClose: quote.prevClose,
    driftCenter,
    gdrImpliedKrw: overseasNight?.impliedKrwPrice,
    marketClosed: isKrMarketClosed(quote),
    weights,
  });
  if (!blended) return null;

  return {
    price: blended.price,
    vsCloseRate: blended.price / quote.prevClose - 1,
    vsLiveRate: blended.price / quote.price - 1,
    methodLabel: blended.methodLabel,
    detail: blended.detail,
  };
}
