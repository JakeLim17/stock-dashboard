import {
  computeMacroFairValueAdjustment,
  type MacroAdjustmentFactor,
} from "./fair-value-macro";
import {
  calendarDaysToSessionOffset,
  formatTradingSessionLabel,
} from "./fair-value-trading-day";
import type {
  OverseasNightIndicator,
  PriceRange,
  Quote,
  StockSnapshot,
} from "./types";

export type { MacroAdjustmentFactor, MacroFairValueAdjustment } from "./fair-value-macro";
export { formatNextTradingSessionLabel, getNextTradingSessionDate } from "./fair-value-trading-day";

/** 가중치 — 삼성전자 92영업일 백테스트(2026-06) 튜닝 */
export const FAIR_VALUE_WEIGHTS = {
  nightClosed: { gdr: 0.6, drift: 0.25, live: 0.15 },
  nightOpen: { gdr: 0.24, drift: 0.35, live: 0.41 },
  // drift 비중을 높여 예측 점선이 현재가에 붙어 flat 되지 않게
  noGdr: { drift: 0.7, live: 0.3 },
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
        ? `야간 ${Math.round(cfg.gdr * 100)}% · σ드리프트 ${Math.round(cfg.drift * 100)}% · 종가 ${Math.round(cfg.live * 100)}%`
        : `야간 ${Math.round(cfg.gdr * 100)}% · σ드리프트 ${Math.round(cfg.drift * 100)}% · 현재가 ${Math.round(cfg.live * 100)}%`,
    };
  }

  if (driftCenter > 0 && live > 0) {
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

// predictor 실행 시점의 기준 가격.
// ranges center 는 이 가격 대비 로그 drift 로 저장된다.
// 예전엔 1주·1개월 center 를 “drift≈0 = entry” 로 썼는데, ADR/상장 알파가 있으면
// 주·월 center ≠ entry 라서 단기(1일) 비율이 뒤집히거나 희석됐다.
function predictorBasePrice(snap: StockSnapshot): number {
  const entry = snap.predictions?.targets?.entry;
  if (entry != null && entry > 0) return entry;
  if (snap.quote.price > 0) return snap.quote.price;
  return 0;
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

  // 정확한 horizon 없으면 가장 가까운 range 로 √t 스케일 외삽
  // (상장 직후 1·3·5일만 있을 때 주간·월간이 수평이 되지 않게)
  const usable = ranges
    .filter((r) => r.horizonDays >= 1 && r.center > 0)
    .sort(
      (a, b) =>
        Math.abs(a.horizonDays - rangeDays) - Math.abs(b.horizonDays - rangeDays)
    );
  if (usable.length > 0) {
    const src = usable[0]!;
    const srcLog = Math.log(src.center / base);
    if (Number.isFinite(srcLog) && src.horizonDays > 0) {
      const scale = Math.sqrt(rangeDays / src.horizonDays);
      return anchorPrice * Math.exp(srcLog * scale);
    }
  }

  const oneDay = ranges.find((r) => r.horizonDays === 1);
  if (oneDay && oneDay.center > 0) {
    const dailyLogDrift = Math.log(oneDay.center / base);
    const weight = rangeDays <= 1 ? 1 : rangeDays <= 3 ? 0.6 : 0.35;
    return anchorPrice * Math.exp(dailyLogDrift * weight);
  }
  return anchorPrice;
}

// 컨센서스 목표가 반영은 fair-value-macro 의 "컨센 목표" 팩터(횡단 상한·UI 칩 노출)
// 한 채널로만 한다. 기존엔 여기서 targetMean 을 가격에 22%(월)/12%(주) 직접 혼합해
// 이중 반영됐고, 국내 목표가가 현재가 대비 +40~85% 부풀어 있어 전 종목 1개월
// 추정이 +14~29% "무조건 우상향"으로 나오던 주범이었다 (2026-07-11 편향 분석).

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
    // today: drift 중심. week/month: live 혼합을 줄여 점선 center 가 flat 되지 않게.
    const closeBase =
      horizonId === "today"
        ? driftCenter
        : roundPrice(
            driftCenter * 0.82 + openBlend.price * 0.18,
            priceDecimals
          );
    const closePrice = applyMacroPrice(closeBase, macro.rate, priceDecimals);
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

// ─── 일별 예측 시리즈 (오늘 ~ 1개월, 거래일 단위) ─────────────────────────
//
// 4개 시계 앵커(오늘 0 · 내일 1 · 다음주 5 · 1개월 22거래일)를 가이드로 쓰되,
// 그 사이는 **일별 베이스 경로**를 깐다 (단순 로그 직선 보간 금지).
//   - 최근 로그수익률 EMA/부분합을 미래로 decay 연장 (종목별 shape)
//   - 요인(수급·뉴스·상장·미장 등) 일자별 가중 — peak day 는 요인·bps 별
//   - 공통 sine/bend 위상 템플릿 금지
// 밴드는 기존 √t 보간 유지. 앵커 시점 가격은 soft-snap 으로 라벨 일치.

export interface FairValueDailyPoint {
  /** 거래일 오프셋 — 0=오늘(현재 세션) */
  sessionOffset: number;
  isoDate: string;
  /** "7/13(월)" */
  label: string;
  price: number;
  low: number | null;
  high: number | null;
  /** 이 날짜가 4개 시계 앵커면 해당 id·라벨 */
  horizonId?: FairValueHorizonId;
  horizonLabel?: string;
  /** 내일(dual-leg) 앵커의 시가 추정 — 종가와 다를 때만 */
  openPrice?: number | null;
}

export type PathFactor = { id: string; label: string; bps: number };

/** 요인 id·bps → 피크 거래일 (종목·요인마다 다르게). 난수 없음. */
function factorPeakDay(id: string, bps: number, maxD: number): number {
  const absB = Math.abs(bps);
  let h = Math.round(absB * 17);
  for (let i = 0; i < id.length; i++) {
    h = (h * 33 + id.charCodeAt(i)) | 0;
  }
  const jitter = Math.abs(h) % 5; // 0..4
  let base: number;
  switch (id) {
    case "listing-adr":
    case "news-opp":
    case "earnings":
      base = 1 + (jitter % 3);
      break;
    case "supply":
    case "supply-f5":
    case "supply-f1":
    case "supply-i5":
    case "supply-fstreak":
    case "supply-istreak":
    case "sentiment":
    case "heat":
    case "heat-cool":
      base = 2 + Math.min(5, Math.floor(absB / 12)) + (jitter % 3);
      break;
    case "ixic":
    case "sox":
    case "kospi":
    case "dxy":
    case "us-lag":
    case "macro":
    case "gdr":
    case "overnight":
    case "sector":
      // 야간·미장 lag-0 는 다음 1거래일에 집중
      base = 1;
      break;
    case "valuation":
    case "consensus":
      base = Math.max(8, Math.floor(maxD * (0.45 + (jitter % 3) * 0.08)));
      break;
    case "news-risk":
    case "news-vol":
    case "geo-vol":
    case "vix":
    case "semi-heat":
    case "semi-cool":
      base = 3 + (jitter % 4) + Math.min(3, Math.floor(absB / 20));
      break;
    default:
      base = 2 + (jitter % 6);
  }
  return Math.max(1, Math.min(maxD, base));
}

/** 요인 id → 일자별 가중 (0~1). 피크일은 bps·id 로 종목마다 다름. */
function factorDayWeight(
  id: string,
  day: number,
  maxD: number,
  bps = 0
): number {
  const peak = factorPeakDay(id, bps, maxD);
  let sigma: number;
  switch (id) {
    case "listing-adr":
    case "news-opp":
    case "earnings":
      sigma = 2.2;
      break;
    case "ixic":
    case "sox":
    case "kospi":
    case "dxy":
    case "us-lag":
    case "macro":
    case "gdr":
    case "overnight":
    case "sector":
      sigma = 1.4;
      break;
    case "valuation":
    case "consensus":
      sigma = Math.max(4, maxD * 0.28);
      break;
    case "supply":
    case "supply-f5":
    case "supply-f1":
    case "supply-i5":
    case "supply-fstreak":
    case "supply-istreak":
    case "sentiment":
    case "heat":
    case "heat-cool":
      sigma = 3.2;
      break;
    default:
      sigma = 3.5;
  }
  return Math.exp(-0.5 * ((day - peak) / sigma) ** 2);
}

/**
 * 최근 일간 로그수익률 → 미래 누적 경로 (EMA decay + 부분합 shape 연장).
 * 종목별 실현 시계열 shape 를 복사·감쇠 — 공통 sine 템플릿 금지.
 * phase 는 수익률 합 기반(결정론)이라 종목마다 피크 위치가 달라짐.
 */
export function extendRecentLogReturns(
  rets: number[],
  maxOffset: number
): number[] {
  const out: number[] = new Array(maxOffset + 1).fill(0);
  if (maxOffset <= 0 || rets.length < 2) return out;

  const n = Math.min(12, rets.length);
  const slice = rets.slice(-n);

  let ema = slice[0]!;
  const alpha = 0.32;
  for (let i = 1; i < slice.length; i++) {
    ema = alpha * slice[i]! + (1 - alpha) * ema;
  }

  // 종목 fingerprint → 시작 위상 (같은 길이 sine 복붙 방지)
  let fingerprint = 0;
  for (let i = 0; i < slice.length; i++) {
    fingerprint += Math.round(slice[i]! * 12_000) * (i + 3);
  }
  const phase = Math.abs(fingerprint) % n;

  // 부분합 디트렌드 텍스처
  const parts: number[] = [];
  let s = 0;
  for (const r of slice) {
    s += r;
    parts.push(s);
  }
  const detrend = parts.map((p, i) => p - (s * (i + 1)) / n);

  let cum = 0;
  for (let d = 1; d <= maxOffset; d++) {
    const decay = Math.exp(-(d - 1) / 6.8);
    const shapeIdx = (phase + d - 1) % n;
    const cycle = Math.floor((phase + d - 1) / n);
    const shapeDecay = Math.exp(-cycle * 1.15);
    const rawRet = slice[shapeIdx]!;
    const shapeDelta =
      shapeIdx === 0
        ? detrend[0]!
        : detrend[shapeIdx]! - detrend[shapeIdx - 1]!;
    // 일별 수익률을 직접 섞어 선형 제거 후에도 텍스처가 남게
    const dayRet =
      ema * decay * 0.55 +
      rawRet * decay * shapeDecay * 0.85 +
      shapeDelta * decay * shapeDecay * 0.4;
    cum += dayRet;
    out[d] = cum;
  }
  const end = out[maxOffset]!;
  for (let d = 1; d <= maxOffset; d++) {
    out[d]! -= end * 0.35 * (d / maxOffset);
  }
  return out;
}

/**
 * 최근 종가 → 일간 실현 vol (로그수익 표준편차).
 * 미니차트 y스케일·경로 진폭 힌트용. 표본 부족 시 null.
 */
export function dailyVolFromCloses(closes: number[]): number | null {
  if (closes.length < 3) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1]!;
    const b = closes[i]!;
    if (!(a > 0 && b > 0)) continue;
    rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  let ss = 0;
  for (const r of rets) ss += (r - mean) ** 2;
  const vol = Math.sqrt(ss / Math.max(1, rets.length - 1));
  if (!(vol > 0) || !Number.isFinite(vol)) return null;
  return Math.max(0.006, Math.min(0.045, vol));
}

/**
 * 경로 굴곡 목표 진폭(log). 실현 vol·밴드 폭으로 결정론적 스케일.
 * 앵커가 거의 수평이어도 중간 구간이 최근 변동성의 ~3.5× 정도로 보이게.
 * (밴드만 넓히지 않고 center 경로 진폭을 키운다.)
 */
export function resolvePathAmpLn(input: {
  realizedVol?: number | null;
  ranges?: PriceRange[] | null;
}): number {
  const fromVol =
    input.realizedVol != null && input.realizedVol > 0
      ? input.realizedVol * 3.5
      : null;
  // 월간 밴드 반폭 / √22 ≈ 일간 σ 대리
  let fromBand: number | null = null;
  const month = (input.ranges ?? []).find(
    (r) => r.horizonDays >= 18 && r.center > 0 && r.high > 0 && r.low > 0
  );
  if (month) {
    const half = 0.5 * Math.log(month.high / month.low);
    fromBand = (half / Math.sqrt(month.horizonDays)) * 3.2;
  }
  const raw = fromVol ?? fromBand ?? 0.028;
  return Math.max(0.022, Math.min(0.065, raw));
}

/**
 * 앵커 chord 위에 요인·최근수익률 굴곡을 얹은 일별 log-price.
 * 끝점은 월간 앵커에 soft-snap. **공통 sine/bend 템플릿 금지** —
 * shape 는 최근 로그수익률 연장 + 요인별(종목마다 다른) peak day.
 * 앵커 사이는 자유 경로 굴곡을 유지하고, 끝점 오차만 선형 보정.
 */
function buildDailyLogPath(input: {
  maxOffset: number;
  anchorLn: Map<number, number>;
  baseLn: number;
  factors?: PathFactor[] | null;
  /** 1일 앵커 대비 시작가 — 단기 모멘텀 시드 */
  shortMomentumLn?: number;
  /** 중간 굴곡 목표 진폭 (log). 미지정 시 ~1.8% */
  pathAmpLn?: number;
  /** 최근 일간 로그수익률 (오래된→최신). 경로 shape 시드 */
  recentLogReturns?: number[] | null;
}): number[] {
  const { maxOffset, anchorLn, baseLn, factors, shortMomentumLn } = input;
  const endLn = anchorLn.get(maxOffset) ?? baseLn;
  const chordPerDay = maxOffset > 0 ? (endLn - baseLn) / maxOffset : 0;
  const targetAmp = Math.max(
    0.022,
    Math.min(0.065, input.pathAmpLn ?? 0.028)
  );

  const mom0 = shortMomentumLn ?? 0;
  const rawFactor: number[] = new Array(maxOffset + 1).fill(0);
  for (let d = 1; d <= maxOffset; d++) {
    let dayBps = 0;
    for (const f of factors ?? []) {
      if (!Number.isFinite(f.bps) || f.bps === 0) continue;
      dayBps += f.bps * factorDayWeight(f.id, d, maxOffset, f.bps);
    }
    const capped = Math.max(-95, Math.min(95, dayBps));
    rawFactor[d] = capped / 10_000;
  }
  let factorCum = 0;
  const factorPath: number[] = new Array(maxOffset + 1).fill(0);
  for (let d = 1; d <= maxOffset; d++) {
    factorCum += rawFactor[d];
    factorPath[d] = factorCum;
  }
  const factorEnd = factorPath[maxOffset] ?? 0;
  const detrendPer = maxOffset > 0 ? (factorEnd * 0.55) / maxOffset : 0;

  const retPath = extendRecentLogReturns(
    input.recentLogReturns ?? [],
    maxOffset
  );
  const hasRetShape = (input.recentLogReturns?.length ?? 0) >= 2;

  const rawWave: number[] = new Array(maxOffset + 1).fill(0);
  let peak = 0;
  for (let d = 1; d <= maxOffset; d++) {
    const factorWave = (factorPath[d]! - detrendPer * d) * 1.45;
    let retWave: number;
    if (hasRetShape) {
      retWave = retPath[d]! * 1.15;
    } else {
      const seed =
        Math.abs(mom0) >= 0.0012
          ? mom0
          : Math.sign(factorEnd || chordPerDay || 1) * targetAmp * 0.35;
      retWave = seed * Math.exp(-d / 7.5) * (1 - d / (maxOffset + 4));
    }
    rawWave[d] = retWave + factorWave - 0.08 * retWave;
    peak = Math.max(peak, Math.abs(rawWave[d]!));
  }
  const waveScale =
    peak > 1e-9 ? Math.min(5.5, Math.max(1, targetAmp / peak)) : 1;

  // 세그먼트 끝(앵커)에서 wave=0 이 되도록 선형 성분 제거 →
  // 이후 chord+wave 가 앵커에 자동 일치하고, 중간 비선형 굴곡만 남음
  const waveAdj: number[] = new Array(maxOffset + 1).fill(0);
  for (let d = 1; d <= maxOffset; d++) {
    waveAdj[d] = rawWave[d]! * waveScale;
  }
  const offsets = [...anchorLn.keys()].sort((a, b) => a - b);
  for (let s = 0; s < offsets.length - 1; s++) {
    const a1 = offsets[s]!;
    const a2 = offsets[s + 1]!;
    const w1 = waveAdj[a1]!;
    const w2 = waveAdj[a2]!;
    const span = a2 - a1;
    for (let d = a1; d <= a2; d++) {
      const t = span > 0 ? (d - a1) / span : 0;
      waveAdj[d]! -= (1 - t) * w1 + t * w2;
    }
  }

  // 종목 fingerprint 피크 펄스 — 긴 세그먼트 안에서 피크일이 달라지게 (육안 차별)
  {
    const rets = input.recentLogReturns ?? [];
    let fp = Math.round((mom0 || 0) * 50_000);
    for (let i = 0; i < rets.length; i++) {
      fp += Math.round((rets[i] ?? 0) * 8_000) * (i + 2);
    }
    for (const f of factors ?? []) {
      fp += Math.round(f.bps * 13) + f.id.length * 19;
    }
    let longA = 0;
    let longB = maxOffset;
    let longSpan = 0;
    for (let s = 0; s < offsets.length - 1; s++) {
      const a1 = offsets[s]!;
      const a2 = offsets[s + 1]!;
      if (a2 - a1 > longSpan) {
        longSpan = a2 - a1;
        longA = a1;
        longB = a2;
      }
    }
    const interior = longB - longA - 1;
    if (interior >= 3) {
      const peakAt = longA + 1 + (Math.abs(fp) % interior);
      const sign =
        Math.sign(mom0 || factorEnd || chordPerDay || fp || 1) || 1;
      const pulse = targetAmp * 0.7 * sign;
      for (let d = longA + 1; d < longB; d++) {
        const dist = Math.abs(d - peakAt);
        if (dist <= 3) waveAdj[d]! += pulse * (1 - dist / 4);
      }
    }
  }

  // 중간 굴곡 진폭 확보
  let midPeak = 0;
  for (let d = 1; d <= maxOffset; d++) {
    if (anchorLn.has(d)) continue;
    midPeak = Math.max(midPeak, Math.abs(waveAdj[d]!));
  }
  if (midPeak > 1e-9 && midPeak < targetAmp * 0.75) {
    const boost = (targetAmp * 0.75) / midPeak;
    for (let d = 1; d <= maxOffset; d++) {
      if (anchorLn.has(d)) continue;
      waveAdj[d]! *= boost;
    }
  }

  const out: number[] = new Array(maxOffset + 1);
  out[0] = anchorLn.get(0) ?? baseLn;
  for (let d = 1; d <= maxOffset; d++) {
    const anchor = anchorLn.get(d);
    if (anchor != null) {
      out[d] = anchor;
      continue;
    }
    let a1 = 0;
    let a2 = maxOffset;
    for (let i = 1; i < offsets.length; i++) {
      if (offsets[i]! >= d) {
        a1 = offsets[i - 1]!;
        a2 = offsets[i]!;
        break;
      }
    }
    const span = a2 - a1;
    const t = span > 0 ? (d - a1) / span : 0;
    const chordSeg =
      (1 - t) * (anchorLn.get(a1) ?? baseLn + chordPerDay * a1) +
      t * (anchorLn.get(a2) ?? baseLn + chordPerDay * a2);
    out[d] = chordSeg + waveAdj[d]!;
  }
  return out;
}

export function buildFairValueDailySeries(input: {
  code: string;
  horizons: FairValueHorizonItem[];
  ranges?: PriceRange[] | null;
  /** 오늘(offset 0) 앵커가 없을 때 곡선 시작점으로 쓸 기준가 (보통 현재가) */
  basePrice: number;
  now?: Date;
  /** 예측 요인 — 일자별 가중으로 굴곡 생성 (없으면 모멘텀·chord 만) */
  pathFactors?: PathFactor[] | null;
  /** 최근 실현 일간 vol (로그) — 경로 진폭 스케일. 없으면 ranges/기본값 */
  realizedVol?: number | null;
  /** 최근 일간 로그수익률 (오래된→최신) — 경로 shape. 없으면 모멘텀 decay */
  recentLogReturns?: number[] | null;
}): FairValueDailyPoint[] {
  const {
    code,
    horizons,
    ranges,
    basePrice,
    now,
    pathFactors,
    realizedVol,
    recentLogReturns,
  } = input;
  const decimals = isKrStockCode(code) ? 0 : 2;

  type Anchor = {
    offset: number;
    price: number;
    id?: FairValueHorizonId;
    label?: string;
    openPrice?: number | null;
  };
  const anchors: Anchor[] = [];
  for (const h of horizons) {
    const est = h.estimate;
    if (!est.ready || est.close.price <= 0) continue;
    anchors.push({
      offset: HORIZON_META[h.id].sessionOffset,
      price: est.close.price,
      id: h.id,
      label: h.label,
      openPrice:
        h.id === "tomorrow" && est.open.price !== est.close.price
          ? est.open.price
          : null,
    });
  }
  anchors.sort((a, b) => a.offset - b.offset);
  if (anchors.length === 0) return [];

  // 오늘 앵커가 없으면(예: 장중이라 today pending) 기준가로 가상 시작점을 둔다.
  if (anchors[0].offset > 0 && basePrice > 0) {
    anchors.unshift({ offset: 0, price: basePrice });
  }
  const maxOffset = anchors[anchors.length - 1].offset;
  const baseLn = Math.log(Math.max(anchors[0].price, 1e-9));
  const anchorLn = new Map<number, number>();
  for (const a of anchors) {
    if (a.price > 0) anchorLn.set(a.offset, Math.log(a.price));
  }

  // 단기 모멘텀 시드: 1일 앵커 vs 시작가
  const d1 = anchorLn.get(1);
  const shortMomentumLn =
    d1 != null ? Math.max(-0.055, Math.min(0.055, d1 - baseLn)) : 0;

  const pathAmpLn = resolvePathAmpLn({ realizedVol, ranges });
  const logPath = buildDailyLogPath({
    maxOffset,
    anchorLn,
    baseLn,
    factors: pathFactors,
    shortMomentumLn,
    pathAmpLn,
    recentLogReturns,
  });

  // ── 밴드 상대 폭 knots — √t 보간용 ──
  const knots = (ranges ?? [])
    .filter(
      (r) =>
        r.horizonDays >= 1 && r.center > 0 && r.low > 0 && r.high > 0
    )
    .map((r) => ({
      d: r.horizonDays,
      lnLow: Math.log(r.low / r.center),
      lnHigh: Math.log(r.high / r.center),
    }))
    .sort((a, b) => a.d - b.d);

  const bandAt = (d: number): { lnLow: number; lnHigh: number } | null => {
    if (d <= 0) return { lnLow: 0, lnHigh: 0 };
    if (knots.length === 0) return null;
    const first = knots[0];
    if (d <= first.d) {
      const s = Math.sqrt(d / first.d);
      return { lnLow: first.lnLow * s, lnHigh: first.lnHigh * s };
    }
    const last = knots[knots.length - 1];
    if (d >= last.d) {
      const s = Math.sqrt(d / last.d);
      return { lnLow: last.lnLow * s, lnHigh: last.lnHigh * s };
    }
    for (let i = 1; i < knots.length; i++) {
      const k1 = knots[i - 1];
      const k2 = knots[i];
      if (d > k2.d) continue;
      const t = (Math.sqrt(d) - Math.sqrt(k1.d)) / (Math.sqrt(k2.d) - Math.sqrt(k1.d));
      return {
        lnLow: k1.lnLow + (k2.lnLow - k1.lnLow) * t,
        lnHigh: k1.lnHigh + (k2.lnHigh - k1.lnHigh) * t,
      };
    }
    return null;
  };

  const out: FairValueDailyPoint[] = [];
  for (let d = 0; d <= maxOffset; d++) {
    const anchor = anchors.find((a) => a.offset === d);
    const price = anchor
      ? anchor.price
      : roundPrice(Math.exp(logPath[d] ?? baseLn), decimals);
    const session = formatTradingSessionLabel(code, d, now);
    const band = bandAt(d);
    out.push({
      sessionOffset: d,
      isoDate: session.isoDate,
      label: session.shortLabel,
      price,
      low: band ? roundPrice(price * Math.exp(band.lnLow), decimals) : null,
      high: band ? roundPrice(price * Math.exp(band.lnHigh), decimals) : null,
      horizonId: anchor?.id,
      horizonLabel: anchor?.label,
      openPrice: anchor?.openPrice ?? null,
    });
  }
  return out;
}
