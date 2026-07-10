import {
  computeMacroFairValueAdjustment,
  type MacroAdjustmentFactor,
} from "./fair-value-macro";
import {
  calendarDaysToSessionOffset,
  formatTradingSessionLabel,
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
  /** 가격 반올림 자릿수 — KRW 0(정수), USD 2(센트). 기본 0. */
  decimals?: number;
}

/** 통화별 가격 반올림 — KRW 정수, USD 센트. (기존 Math.round 고정은 저가 달러 종목에서 큰 상대 오차) */
function roundPrice(v: number, decimals = 0): number {
  if (decimals <= 0) return Math.round(v);
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
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
  const { live, prevClose, driftCenter, gdrImpliedKrw, marketClosed, decimals } =
    input;
  const w = input.weights ?? FAIR_VALUE_WEIGHTS;
  if (!live || live <= 0 || !prevClose || prevClose <= 0) return null;

  const gdr = gdrImpliedKrw ?? null;

  if (gdr != null && gdr > 0) {
    const cfg = marketClosed ? w.nightClosed : w.nightOpen;
    const price = gdr * cfg.gdr + driftCenter * cfg.drift + live * cfg.live;
    return {
      price: roundPrice(price, decimals),
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
      price: roundPrice(price, decimals),
      methodLabel: "σ 드리프트",
      detail: `1일 통계 중심 ${Math.round(cfg.drift * 100)}% · 현재가 ${Math.round(cfg.live * 100)}%`,
    };
  }

  return null;
}

function applyMacroPrice(
  base: number,
  macroRate: number,
  decimals = 0
): number {
  return roundPrice(base * (1 + macroRate), decimals);
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
  extension: FairValueCloseExtension = FAIR_VALUE_CLOSE_EXTENSION,
  decimals = 0
): { price: number; methodLabel: string; detail: string } {
  const price = roundPrice(
    openBase * extension.openShare + driftCenter * extension.driftShare,
    decimals
  );
  return {
    price,
    methodLabel: "시가+장중드리프트",
    detail: `시가추정 ${Math.round(extension.openShare * 100)}% · 1일σ ${Math.round(extension.driftShare * 100)}%`,
  };
}

export type FairValueHorizonId = "today" | "tomorrow" | "week" | "month";

export interface FairValueHorizonItem {
  id: FairValueHorizonId;
  label: string;
  estimate: FairValueResult;
}

const HORIZON_META: Record<
  FairValueHorizonId,
  { sessionOffset: number; rangeDays: number; label: string; dualLeg: boolean }
> = {
  today: { sessionOffset: 0, rangeDays: 1, label: "오늘", dualLeg: false },
  tomorrow: { sessionOffset: 1, rangeDays: 1, label: "내일", dualLeg: true },
  week: { sessionOffset: 5, rangeDays: 5, label: "다음 주", dualLeg: false },
  month: { sessionOffset: 22, rangeDays: 22, label: "1개월", dualLeg: false },
};

function getSettlementForHorizon(
  quote: Quote,
  code: string,
  horizonId: FairValueHorizonId
): SettlementContext {
  const base = getSettlementContext(quote, code);
  if (horizonId !== "today") return base;

  const state = (quote.marketState ?? "").toUpperCase();
  if (state === "REGULAR") {
    return {
      settlementPrice: quote.price,
      prevSettlement: quote.prevClose,
      ready: true,
      settlementLabel: "현재가",
    };
  }
  if (quote.extendedHours?.active) {
    return {
      settlementPrice: quote.extendedHours.price,
      prevSettlement: quote.prevClose,
      ready: true,
      settlementLabel:
        quote.extendedHours.session === "kr-after" ? "앱장" : "시간외",
    };
  }
  return base;
}

// predictor 실행 시점의 기준 가격 — drift=0 인 horizon(1주·2주·1개월)의 center 는
// 정확히 predictor 시점 price 와 같다. 없으면 targets.entry(=price) → quote.price 폴백.
function predictorBasePrice(snap: StockSnapshot): number {
  const ranges = snap.predictions?.ranges ?? [];
  const zeroDrift =
    ranges.find((r) => r.horizonDays === 5) ??
    ranges.find((r) => r.horizonDays === 10) ??
    ranges.find((r) => r.horizonDays === 22);
  if (zeroDrift && zeroDrift.center > 0) return zeroDrift.center;
  const entry = snap.predictions?.targets?.entry;
  if (entry != null && entry > 0) return entry;
  return snap.quote.price;
}

// 예측 drift 를 "비율"로 뽑아 현재 기준가(anchor)에 다시 앵커링한다.
//   - 기존엔 predictor 캐시(최대 1시간 전) 시점의 절대 가격(center)을 그대로 썼는데,
//     장중 가격이 움직이면 주간·월간 추정이 옛 가격에 끌려가는 버그가 있었다.
//   - 폴백(정확한 horizon range 없음)도 기존엔 1일 drift × rangeDays 선형 복리 외삽이라
//     (일 ±3% → 22일 ≈ ±90%) 통계적으로 무의미한 값이 나올 수 있었다. lag-0 하루짜리
//     신호는 예측기 driftWeight 스케줄(1일=1.0, ≤3일=0.6, 그 이상=0)대로만 반영한다.
function driftCenterForHorizon(
  snap: StockSnapshot,
  rangeDays: number,
  anchorPrice: number
): number {
  const ranges = snap.predictions?.ranges ?? [];
  const base = predictorBasePrice(snap);
  if (anchorPrice <= 0 || base <= 0) return anchorPrice;

  const exact = ranges.find((r) => r.horizonDays === rangeDays);
  if (exact && exact.center > 0) {
    return anchorPrice * (exact.center / base);
  }

  const oneDay = ranges.find((r) => r.horizonDays === 1);
  if (oneDay && oneDay.center > 0) {
    const dailyLogDrift = Math.log(oneDay.center / base);
    const weight = rangeDays <= 1 ? 1 : rangeDays <= 3 ? 0.6 : 0;
    return anchorPrice * Math.exp(dailyLogDrift * weight);
  }
  return anchorPrice;
}

function applyConsensusBlend(
  price: number,
  snap: StockSnapshot,
  horizonId: FairValueHorizonId,
  decimals = 0
): number {
  const target = snap.consensus?.targetMean;
  if (target == null || target <= price) return price;
  const weight = horizonId === "month" ? 0.3 : horizonId === "week" ? 0.18 : 0;
  if (weight <= 0) return price;
  return roundPrice(price * (1 - weight) + target * weight, decimals);
}

export function buildFairValueEstimateForHorizon(
  snap: StockSnapshot,
  horizonId: FairValueHorizonId,
  weights?: FairValueWeights
): FairValueResult {
  const meta = HORIZON_META[horizonId];
  const { quote, overseasNight, meta: sym } = snap;
  let settlement = getSettlementForHorizon(quote, sym.code, horizonId);

  if (!settlement.ready && horizonId === "tomorrow") {
    return {
      ready: false,
      pendingReason: settlement.pendingReason ?? "종가 확정 대기",
      settlementLabel: settlement.settlementLabel,
    };
  }

  if (!settlement.ready && (horizonId === "week" || horizonId === "month")) {
    if (quote.price > 0) {
      settlement = {
        settlementPrice: quote.price,
        prevSettlement: quote.prevClose,
        ready: true,
        settlementLabel: "현재가(근사)",
      };
    }
  }

  if (!settlement.ready && horizonId === "today") {
    return {
      ready: false,
      pendingReason: "장 마감 후 오늘 종가 추정 공개",
      settlementLabel: settlement.settlementLabel,
    };
  }

  if (!settlement.ready) {
    return {
      ready: false,
      pendingReason: settlement.pendingReason ?? "데이터 부족",
      settlementLabel: settlement.settlementLabel,
    };
  }

  const priceDecimals = isKrStockCode(sym.code) ? 0 : 2;

  const driftCenter = driftCenterForHorizon(
    snap,
    meta.rangeDays,
    settlement.settlementPrice
  );

  const gdrStale = isGdrQuoteStale(overseasNight?.fetchedAt);
  const gdrImplied =
    horizonId === "tomorrow" && !gdrStale && overseasNight?.impliedKrwPrice != null
      ? overseasNight.impliedKrwPrice
      : null;
  const usedGdrInBlend = gdrImplied != null && gdrImplied > 0;

  const openBlend = blendFairValuePrice({
    live: settlement.settlementPrice,
    prevClose: settlement.prevSettlement,
    driftCenter,
    gdrImpliedKrw: gdrImplied,
    marketClosed: horizonId === "tomorrow" && isKrMarketClosed(quote),
    weights,
    decimals: priceDecimals,
  });

  if (!openBlend) {
    return {
      ready: false,
      pendingReason: "예측 데이터 부족",
      settlementLabel: settlement.settlementLabel,
    };
  }

  const gapDays = calendarDaysToSessionOffset(sym.code, meta.sessionOffset);
  const macro = computeMacroFairValueAdjustment(snap, {
    skipGdrPremium: usedGdrInBlend,
    gapScale: macroGapScale(gapDays),
    horizon: horizonId,
  });

  const session = formatTradingSessionLabel(sym.code, meta.sessionOffset);
  const macroSuffix = macroDetailSuffix(macro.rate);
  const settlementPrice = settlement.settlementPrice;

  if (!meta.dualLeg) {
    const closeBase =
      horizonId === "today"
        ? driftCenter
        : blendCloseFromOpen(
            openBlend.price,
            driftCenter,
            undefined,
            priceDecimals
          ).price;
    const closePrice = applyConsensusBlend(
      applyMacroPrice(closeBase, macro.rate, priceDecimals),
      snap,
      horizonId,
      priceDecimals
    );
    const closeLeg: FairValueLeg = {
      price: closePrice,
      baseBlendedPrice: closeBase,
      vsSettlementRate: closePrice / settlementPrice - 1,
      methodLabel: withMacroLabel(
        horizonId === "today" ? "σ드리프트" : "장기드리프트",
        macro.rate
      ),
      detail:
        (horizonId === "today"
          ? `오늘 종가 σ·${meta.rangeDays}일`
          : `${meta.rangeDays}거래일 드리프트`) + macroSuffix,
    };
    return {
      ready: true,
      open: closeLeg,
      close: closeLeg,
      price: closeLeg.price,
      baseBlendedPrice: closeLeg.baseBlendedPrice,
      vsSettlementRate: closeLeg.vsSettlementRate,
      settlementPrice,
      settlementLabel: settlement.settlementLabel,
      methodLabel: closeLeg.methodLabel,
      detail: closeLeg.detail,
      targetDateLabel: session.shortLabel,
      targetIsoDate: session.isoDate,
      macroRate: macro.rate,
      macroFactors: macro.factors,
    };
  }

  const openBase = openBlend.price;
  const openPrice = applyMacroPrice(openBase, macro.rate, priceDecimals);
  const closeBlend = blendCloseFromOpen(
    openBase,
    driftCenter,
    undefined,
    priceDecimals
  );
  const closePrice = applyMacroPrice(closeBlend.price, macro.rate, priceDecimals);

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

/** 오늘·내일·다음 주·1개월 — 다중 시계 추정 */
export function buildMultiHorizonFairValue(
  snap: StockSnapshot,
  weights?: FairValueWeights
): FairValueHorizonItem[] {
  const ids: FairValueHorizonId[] = ["today", "tomorrow", "week", "month"];
  return ids.map((id) => ({
    id,
    label: HORIZON_META[id].label,
    estimate: buildFairValueEstimateForHorizon(snap, id, weights),
  }));
}

export function buildFairValueEstimate(
  snap: StockSnapshot,
  weights?: FairValueWeights
): FairValueResult {
  return buildFairValueEstimateForHorizon(snap, "tomorrow", weights);
}
