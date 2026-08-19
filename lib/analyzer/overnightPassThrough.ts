/**
 * 해외 야간(ADR/GDR) → 원주 단기 알파 전달 (SSOT).
 *
 * 종가·세션 등락률 기준. 갭 확정·“최소 N%” 식 문구는 쓰지 않는다.
 *
 * 신규상장 ADR: Yahoo regularMarketChangePercent 가 시가→종가(소폭 되돌림)만
 * 보여 공모가 대비 급등(+두 자릿수)을 놓칠 수 있음 → resolveOvernightProxyRate 로
 * 공모가·최근 누적 급등을 우선한다.
 */

export type OvernightProxyKind = "adr" | "gdr";

/** 원주는 ADR/GDR을 1:1로 안 따라감 — 시차·유동성·헤지로 할인 전달 */
export const OVERNIGHT_TRANSFER_RATIO = 0.4; // 40% (허용 30~50%)

/** 단일 요인 상한 — 급등 세션이 일간 drift를 독점하지 않게 */
export const OVERNIGHT_BPS_CAP = 200; // ±2.0%

/** 최근·공모 대비 이 이상이면 “급등 세션” — 당일 소폭 되돌림보다 우선 */
export const LISTING_SURGE_THRESHOLD = 0.1; // +10%

/** 시초 예상 밴드 — 전달률×할인, 단일 세션 절대 캡 */
export const OVERNIGHT_OPEN_BAND_ABS_CAP = 0.1; // ±10%
export const OVERNIGHT_OPEN_BAND_LOW_RATIO = 0.55;
export const OVERNIGHT_OPEN_BAND_HIGH_RATIO = 0.9;

const MIN_ABS_RATE = 0.003; // 0.3% 미만은 노이즈

export interface OvernightPassThroughResult {
  id: "overnight";
  kind: OvernightProxyKind;
  /** 전달 후·캡 적용 bps (예측 알파) */
  bps: number;
  /** UI 칩 — 예: ADR 야간 +1.8% 반영 */
  label: string;
  /** 전달 전 raw bps (캡 전) */
  rawBps: number;
  transferRatio: number;
}

export interface OvernightProxyRateInput {
  /** 정규장 등락률 (Yahoo/KIS changeRate) */
  sessionRate: number;
  /** 프리/애프터 등락률 (정규장 종가 대비) */
  extendedRate?: number | null;
  extendedActive?: boolean;
  /** 최근 종가 (오래된 → 최신) */
  recentCloses?: number[] | null;
  sessionOpen?: number | null;
  /** 공모가 등 상장 기준가 */
  listingReferencePrice?: number | null;
  lastPrice?: number | null;
}

function clampBps(bps: number, cap = OVERNIGHT_BPS_CAP): number {
  return Math.max(-cap, Math.min(cap, bps));
}

function formatAppliedPct(bps: number): string {
  const pct = bps / 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * 야간 전달에 쓸 프록시 등락률 결정.
 * - 프리/애프터 활성이면 extended 우선
 * - 공모가·최근 1~3일 누적이 +10% 이상이면 그 급등을 하한으로 유지
 *   (상장일 시가→종가 −1% 같은 되돌림이 칩을 하방으로 뒤집지 않게)
 */
export function resolveOvernightProxyRate(
  input: OvernightProxyRateInput
): number {
  const session = Number.isFinite(input.sessionRate) ? input.sessionRate : 0;
  let base = session;
  if (
    input.extendedActive &&
    input.extendedRate != null &&
    Number.isFinite(input.extendedRate)
  ) {
    base = input.extendedRate;
  }

  const last =
    input.lastPrice != null && input.lastPrice > 0
      ? input.lastPrice
      : input.recentCloses?.length
        ? input.recentCloses[input.recentCloses.length - 1]
        : null;

  const surgeCandidates: number[] = [];

  if (
    last != null &&
    input.listingReferencePrice != null &&
    input.listingReferencePrice > 0
  ) {
    surgeCandidates.push(last / input.listingReferencePrice - 1);
  }

  const closes = (input.recentCloses ?? []).filter(
    (c) => Number.isFinite(c) && c > 0
  );
  if (closes.length >= 2) {
    const first = closes[Math.max(0, closes.length - 3)]!;
    const end = closes[closes.length - 1]!;
    if (first > 0) surgeCandidates.push(end / first - 1);
  } else if (
    closes.length === 1 &&
    input.sessionOpen != null &&
    input.sessionOpen > 0 &&
    input.listingReferencePrice != null &&
    input.listingReferencePrice > 0
  ) {
    // 상장 첫날: 시가 갭(공모→시가)도 급등 후보
    surgeCandidates.push(input.sessionOpen / input.listingReferencePrice - 1);
  }

  const surge = surgeCandidates
    .filter((r) => Number.isFinite(r) && r >= LISTING_SURGE_THRESHOLD)
    .reduce((a, b) => Math.max(a, b), 0);

  if (surge >= LISTING_SURGE_THRESHOLD) {
    // 급등 국면에서는 당일 되돌림이 음수여도 급등분을 하한으로 유지
    return Math.max(base, surge);
  }
  return base;
}

/**
 * ADR/GDR 세션 등락률 → 원주 단기(월·화·1~2거래일) 알파.
 * bps = clamp(changeRate × transferRatio × 10000, ±cap)
 */
export function computeOvernightPassThrough(
  changeRate: number | null | undefined,
  kind: OvernightProxyKind = "gdr"
): OvernightPassThroughResult | null {
  if (changeRate == null || !Number.isFinite(changeRate)) return null;
  if (Math.abs(changeRate) < MIN_ABS_RATE) return null;

  const rawBps = Math.round(changeRate * OVERNIGHT_TRANSFER_RATIO * 10_000);
  const bps = clampBps(rawBps);
  if (Math.abs(bps) < 1) return null;

  const tag = kind === "adr" ? "ADR" : "GDR";
  return {
    id: "overnight",
    kind,
    bps,
    label: `${tag} 야간 ${formatAppliedPct(bps)} 반영`,
    rawBps,
    transferRatio: OVERNIGHT_TRANSFER_RATIO,
  };
}

/** proxy 이름·거래소로 adr/gdr 추정 */
export function inferOvernightKind(input: {
  proxyCode?: string | null;
  name?: string | null;
  exchange?: string | null;
}): OvernightProxyKind {
  const blob = `${input.proxyCode ?? ""} ${input.name ?? ""} ${input.exchange ?? ""}`;
  if (/ADR|NASDAQ|SKHY/i.test(blob)) return "adr";
  return "gdr";
}

export interface OvernightOpenBand {
  /** 하한 등락률 (예: 0.031 = +3.1%) */
  lowPct: number;
  highPct: number;
  midPct: number;
  /** UI 한 줄 — 확정 아님 명시 */
  label: string;
  kind: OvernightProxyKind;
}

function formatSignedPct(rate: number): string {
  const sign = rate >= 0 ? "+" : "";
  return `${sign}${(rate * 100).toFixed(1)}%`;
}

/**
 * 시초 예상 밴드 = ADR/GDR 등락 × 전달률 × (저·고 할인).
 * 예측 알파 캡(±2%)과 별개 — UI 안내용. “갭상 N% 확정” 문구 금지.
 */
export function estimateOvernightOpenBand(
  changeRate: number | null | undefined,
  kind: OvernightProxyKind = "adr",
  opts?: { sessionLabel?: string }
): OvernightOpenBand | null {
  if (changeRate == null || !Number.isFinite(changeRate)) return null;
  if (Math.abs(changeRate) < MIN_ABS_RATE) return null;

  const transferred = changeRate * OVERNIGHT_TRANSFER_RATIO;
  const cap = OVERNIGHT_OPEN_BAND_ABS_CAP;
  const clamp = (x: number) => Math.max(-cap, Math.min(cap, x));

  let low = clamp(transferred * OVERNIGHT_OPEN_BAND_LOW_RATIO);
  let high = clamp(transferred * OVERNIGHT_OPEN_BAND_HIGH_RATIO);
  if (low > high) {
    const t = low;
    low = high;
    high = t;
  }
  if (Math.abs(low) < 0.001 && Math.abs(high) < 0.001) return null;

  const tag = kind === "adr" ? "ADR" : "GDR";
  const session = opts?.sessionLabel ?? "시초";
  return {
    lowPct: low,
    highPct: high,
    midPct: (low + high) / 2,
    label: `${session} 예상 ${formatSignedPct(low)}~${formatSignedPct(high)} (${tag} 반영, 확정 아님)`,
    kind,
  };
}

/**
 * 야간 선물 신호. HTML 스크래핑 없음.
 * 벤치(sonmul 갭 가이드): ① 코스피200 야간 vs 정규 종가 ② NQ·ES ③ 환율. SOX·ADR은 별도 칩.
 * 확정 시초가 아님. ADR/GDR 칩과 겹치면 가중을 줄인다.
 */
export const NIGHT_FUTURES_TRANSFER = 0.22;
export const NIGHT_FUTURES_BPS_CAP = 80; // ±0.8%
const NIGHT_FUTURES_MIN_ABS = 0.0025;

export interface NightFuturesRates {
  /** 코스피200 선물 야간 — 정규 15:45 종가 대비 (전일대비 아님) */
  k200?: number | null;
  nq?: number | null;
  es?: number | null;
  ym?: number | null;
  /** KRW=X 등락 — 양수=원화 약세 */
  fx?: number | null;
}

export function compositeNightFuturesRate(rates: NightFuturesRates): number | null {
  let wSum = 0;
  let acc = 0;
  const add = (r: number | null | undefined, w: number) => {
    if (r == null || !Number.isFinite(r)) return;
    acc += r * w;
    wSum += w;
  };
  const hasK200 = rates.k200 != null && Number.isFinite(rates.k200);
  if (hasK200) {
    add(rates.k200, 0.7);
    add(rates.nq, 0.1);
    add(rates.es, 0.08);
    add(rates.ym, 0.05);
    add(rates.fx != null ? -rates.fx * 0.35 : null, 0.07);
  } else {
    add(rates.nq, 0.45);
    add(rates.es, 0.3);
    add(rates.ym, 0.15);
    add(rates.fx != null ? -rates.fx * 0.35 : null, 0.1);
  }
  if (wSum < 0.3) return null;
  return acc / wSum;
}

export function computeNightFuturesPassThrough(
  rates: NightFuturesRates,
  opts?: { hasStockOvernight?: boolean }
): { id: "night-fut"; label: string; bps: number } | null {
  const composite = compositeNightFuturesRate(rates);
  if (composite == null) return null;
  if (Math.abs(composite) < NIGHT_FUTURES_MIN_ABS) return null;

  let rawBps = Math.round(composite * NIGHT_FUTURES_TRANSFER * 10_000);
  if (opts?.hasStockOvernight) rawBps = Math.round(rawBps * 0.35);
  const bps = Math.max(
    -NIGHT_FUTURES_BPS_CAP,
    Math.min(NIGHT_FUTURES_BPS_CAP, rawBps)
  );
  if (Math.abs(bps) < 1) return null;
  const pct = bps / 100;
  const sign = pct >= 0 ? "+" : "";
  const hasK200 = rates.k200 != null && Number.isFinite(rates.k200);
  return {
    id: "night-fut",
    label: hasK200
      ? `야간 코스피200 선물 ${sign}${pct.toFixed(1)}%`
      : `야간 선물 ${sign}${pct.toFixed(1)}% 반영`,
    bps,
  };
}

/** sharesPerReceipt 표시 — ADR 0.1 → "ADR 10주=원주 1주" */
export function formatSharesPerReceiptLabel(
  sharesPerReceipt: number,
  kind?: OvernightProxyKind | null
): string {
  if (!(sharesPerReceipt > 0)) return "환산";
  if (sharesPerReceipt < 1) {
    const n = Math.round(1 / sharesPerReceipt);
    const tag = kind === "gdr" ? "GDR" : "ADR";
    return `${tag} ${n}주=원주 1주`;
  }
  return `${sharesPerReceipt}주 환산`;
}
