import {
  computeMacroFairValueAdjustment,
  type MacroAdjustmentFactor,
} from "./fair-value-macro";
import {
  calendarDaysToNextSession,
  formatNextTradingSessionLabel,
} from "./fair-value-trading-day";
import type { OverseasNightIndicator, Quote, StockSnapshot } from "./types";

export type { MacroAdjustmentFactor, MacroFairValueAdjustment } from "./fair-value-macro";
export { formatNextTradingSessionLabel, getNextTradingSessionDate } from "./fair-value-trading-day";

/** 가중치 — 삼성전자 92영업일 백테스트(2026-06) 튜닝 */
export const FAIR_VALUE_WEIGHTS = {
  nightClosed: { gdr: 0.6, drift: 0.25, live: 0.15 },
  nightOpen: { gdr: 0.24, drift: 0.35, live: 0.41 },
  noGdr: { drift: 0.45, live: 0.55 },
} as const;

export type FairValueCloseExtension = { openShare: number; driftShare: number };

/** 익일 종가 = 시가 추정 + 1일 σ드리프트 혼합 비율 — nightToNextClose 튜닝 */
export const FAIR_VALUE_CLOSE_EXTENSION: FairValueCloseExtension = {
  openShare: 0.5,
  driftShare: 0.5,
};

/** 백테스트 요약 — 삼성전자+SMSN.IL 92샘플 */
export const FAIR_VALUE_BACKTEST_META = {
  symbol: "005930.KS",
  samples: 92,
  nightToNextClose: { mape: 0.0327, direction: 0.685 },
  nightToNextOpen: { mape: 0.0253, direction: 0.75 },
  ahCloseToNextOpen: { mape: 0.0251, direction: 0.772 },
  ahCloseToNextClose: { mape: 0.0358, direction: 0.685 },
} as const;

export type FairValueWeightTriple = { gdr: number; drift: number; live: number };
export type FairValueWeightPair = { drift: number; live: number };

export type FairValueWeights = {
  nightClosed: FairValueWeightTriple;
  nightOpen: FairValueWeightTriple;
  noGdr: FairValueWeightPair;
};

export interface SettlementContext {
  settlementPrice: number;
  prevSettlement: number;
  ready: boolean;
  pendingReason?: string;
  settlementLabel: string;
}

export interface FairValueInput {
  live: number;
  prevClose: number;
  driftCenter: number;
  gdrImpliedKrw?: number | null;
  marketClosed: boolean;
  weights?: FairValueWeights;
}

export interface FairValueLeg {
  price: number;
  /** GDR·σ 혼합 직후 가격 (매크로 보정 전) */
  baseBlendedPrice: number;
  /** 오늘 최종 기준가(앱장 포함) 대비 */
  vsSettlementRate: number;
  methodLabel: string;
  detail: string;
}

export interface FairValueEstimate {
  /** 익일 시가 추정 (갭) */
  open: FairValueLeg;
  /** 익일 종가 추정 (장중 포함) */
  close: FairValueLeg;
  /** @deprecated open.price — 하위 호환 */
  price: number;
  /** @deprecated open.baseBlendedPrice */
  baseBlendedPrice: number;
  /** @deprecated open.vsSettlementRate */
  vsSettlementRate: number;
  settlementPrice: number;
  settlementLabel: string;
  /** @deprecated open.methodLabel */
  methodLabel: string;
  /** @deprecated open.detail */
  detail: string;
  /** 익일 거래일 라벨 — "6/23(월)" */
  targetDateLabel: string;
  targetIsoDate: string;
  /** 매크로·심리·지정학 보정 합산 (0.01 = +1%) */
  macroRate: number;
  macroFactors: MacroAdjustmentFactor[];
  ready: true;
}

export interface FairValuePending {
  ready: false;
  pendingReason: string;
  settlementLabel?: string;
}

export type FairValueResult = FairValueEstimate | FairValuePending;

function isKrStockCode(code: string): boolean {
  return /^\d{6}\.K[SQ]$/.test(code);
}

/** KST 기준 앱장(시간외 단일가) 거래 시간대 — 평일 15:30~18:00 */
function isKrAfterHoursWindow(now = new Date()): boolean {
  const kst = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Seoul" })
  );
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const mins = kst.getHours() * 60 + kst.getMinutes();
  return mins >= 15 * 60 + 30 && mins < 18 * 60;
}

/**
 * 오늘 "진짜 종가" — 정규장 15:30이 아니라 앱장(시간외 단일가)까지 끝난 뒤 확정가.
 * 익일 추정가는 ready=true 일 때만 산출한다.
 */
export function getSettlementContext(
  quote: Quote,
  code: string
): SettlementContext {
  const state = (quote.marketState ?? "").toUpperCase();
  const ext = quote.extendedHours ?? null;
  const regular = quote.price;
  const prev = quote.prevClose;
  const isKr = isKrStockCode(code);

  if (state === "REGULAR") {
    return {
      settlementPrice: regular,
      prevSettlement: prev,
      ready: false,
      pendingReason: "장중 — 앱장 마감 후 익일 추정가 공개",
      settlementLabel: "정규장",
    };
  }

  if (ext?.active) {
    return {
      settlementPrice: ext.price,
      prevSettlement: prev,
      ready: false,
      pendingReason:
        ext.session === "kr-after"
          ? "앱장 거래중 — 확정 후 익일 추정가 공개"
          : "시간외 거래중 — 확정 후 익일 추정가 공개",
      settlementLabel:
        ext.session === "kr-after" ? "앱장" : "시간외",
    };
  }

  // 앱장·장전 시간외 종료 — kr-after 종가가 오늘 최종 기준가
  if (ext && !ext.active) {
    const afterClose =
      ext.session === "kr-after" || ext.session === "post"
        ? ext.price
        : regular;
    return {
      settlementPrice: afterClose,
      prevSettlement: prev,
      ready: true,
      settlementLabel:
        ext.session === "kr-after"
          ? "앱장 종가"
          : ext.session === "post"
            ? "애프터마켓 종가"
            : "정규장 종가",
    };
  }

  if (isKr && isKrAfterHoursWindow()) {
    return {
      settlementPrice: regular,
      prevSettlement: prev,
      ready: false,
      pendingReason: "앱장 데이터 수집 중 — 종가 확정 후 공개",
      settlementLabel: "정규장 종가(임시)",
    };
  }

  return {
    settlementPrice: regular,
    prevSettlement: prev,
    ready: true,
    settlementLabel: "정규장 종가",
  };
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

/** GDR 시세가 18h+ 지나면 주말·월요일 새벽에 금요일 값으로 편향될 수 있음 */
const GDR_STALE_MS = 18 * 3_600_000;

function isGdrQuoteStale(fetchedAt?: number | null): boolean {
  if (fetchedAt == null) return false;
  return Date.now() - fetchedAt > GDR_STALE_MS;
}

/** 금→월 등 달력 갭이 클 때 매크로 보정 축소 */
export function macroGapScale(calendarDays: number): number {
  if (calendarDays <= 1.25) return 1;
  return Math.min(1, 1 / Math.sqrt(calendarDays));
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

function applyMacroPrice(base: number, macroRate: number): number {
  return Math.round(base * (1 + macroRate));
}

function withMacroLabel(baseLabel: string, macroRate: number): string {
  return Math.abs(macroRate) >= 0.0005 ? `${baseLabel}+매크로` : baseLabel;
}

function macroDetailSuffix(macroRate: number): string {
  return Math.abs(macroRate) >= 0.0001
    ? ` · 매크로 ${macroRate >= 0 ? "+" : ""}${(macroRate * 100).toFixed(2)}%`
    : "";
}

/** 익일 종가 — 시가 추정 + 1일 σ드리프트 혼합 */
export function blendCloseFromOpen(
  openBase: number,
  driftCenter: number,
  extension: FairValueCloseExtension = FAIR_VALUE_CLOSE_EXTENSION
): { price: number; methodLabel: string; detail: string } {
  const price = Math.round(
    openBase * extension.openShare + driftCenter * extension.driftShare
  );
  return {
    price,
    methodLabel: "시가+장중드리프트",
    detail: `시가추정 ${Math.round(extension.openShare * 100)}% · 1일σ ${Math.round(extension.driftShare * 100)}%`,
  };
}

export function buildFairValueEstimate(
  snap: StockSnapshot,
  weights?: FairValueWeights
): FairValueResult {
  const { quote, overseasNight, predictions, meta } = snap;
  const settlement = getSettlementContext(quote, meta.code);

  if (!settlement.ready) {
    return {
      ready: false,
      pendingReason: settlement.pendingReason ?? "종가 확정 대기",
      settlementLabel: settlement.settlementLabel,
    };
  }

  const oneDay = predictions?.ranges.find((r) => r.horizonDays === 1);
  const driftCenter = oneDay?.center ?? settlement.settlementPrice;

  const gdrStale = isGdrQuoteStale(overseasNight?.fetchedAt);
  const gdrImplied =
    gdrStale || overseasNight?.impliedKrwPrice == null
      ? null
      : overseasNight.impliedKrwPrice;
  const usedGdrInBlend = gdrImplied != null && gdrImplied > 0;

  const openBlend = blendFairValuePrice({
    live: settlement.settlementPrice,
    prevClose: settlement.prevSettlement,
    driftCenter,
    gdrImpliedKrw: gdrImplied,
    marketClosed: isKrMarketClosed(quote),
    weights,
  });

  if (!openBlend) {
    return {
      ready: false,
      pendingReason: "예측 데이터 부족",
      settlementLabel: settlement.settlementLabel,
    };
  }

  const gapDays = calendarDaysToNextSession(meta.code);
  const macro = computeMacroFairValueAdjustment(snap, {
    skipGdrPremium: usedGdrInBlend,
    gapScale: macroGapScale(gapDays),
  });
  const openBase = openBlend.price;
  const openPrice = applyMacroPrice(openBase, macro.rate);
  const closeBlend = blendCloseFromOpen(openBase, driftCenter);
  const closePrice = applyMacroPrice(closeBlend.price, macro.rate);
  const session = formatNextTradingSessionLabel(meta.code);
  const macroSuffix = macroDetailSuffix(macro.rate);
  const settlementPrice = settlement.settlementPrice;

  const openLeg: FairValueLeg = {
    price: openPrice,
    baseBlendedPrice: openBase,
    vsSettlementRate: openPrice / settlementPrice - 1,
    methodLabel: withMacroLabel(openBlend.methodLabel, macro.rate),
    detail: openBlend.detail + macroSuffix,
  };

  const closeLeg: FairValueLeg = {
    price: closePrice,
    baseBlendedPrice: closeBlend.price,
    vsSettlementRate: closePrice / settlementPrice - 1,
    methodLabel: withMacroLabel(closeBlend.methodLabel, macro.rate),
    detail: closeBlend.detail + macroSuffix,
  };

  return {
    ready: true,
    open: openLeg,
    close: closeLeg,
    price: openLeg.price,
    baseBlendedPrice: openLeg.baseBlendedPrice,
    vsSettlementRate: openLeg.vsSettlementRate,
    settlementPrice,
    settlementLabel: settlement.settlementLabel,
    methodLabel: openLeg.methodLabel,
    detail: openLeg.detail,
    targetDateLabel: session.shortLabel,
    targetIsoDate: session.isoDate,
    macroRate: macro.rate,
    macroFactors: macro.factors,
  };
}
