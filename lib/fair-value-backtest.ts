import type { HistoricalPoint } from "./providers/yahoo";
import {
  blendFairValuePrice,
  blendCloseFromOpen,
  type FairValueWeights,
  type FairValueCloseExtension,
  FAIR_VALUE_WEIGHTS,
  FAIR_VALUE_CLOSE_EXTENSION,
  macroGapScale,
} from "./fair-value";
import { weekdayLabelInTz } from "./fair-value-trading-day";

export type FairValueScenario =
  | "openToClose"
  | "nightToNextClose"
  | "nightToNextOpen"
  | "ahCloseToNextOpen"
  | "ahCloseToNextClose";

export interface FairValueBacktestRow {
  date: number;
  scenario: FairValueScenario;
  estimate: number;
  actual: number;
  errorAbs: number;
  errorPct: number;
  directionHit: boolean;
  /** 기준가(live) 대비 하락 예측 여부 */
  predictedDown: boolean;
}

export interface FairValueBacktestSummary {
  scenario: FairValueScenario;
  samples: number;
  mae: number;
  mape: number;
  directionAccuracy: number;
  rows: FairValueBacktestRow[];
}

export interface FairValueBacktestInput {
  stockHist: HistoricalPoint[];
  gdrHist?: HistoricalPoint[] | null;
  usdKrwHist?: HistoricalPoint[] | null;
  sharesPerReceipt?: number;
  weights?: FairValueWeights;
  closeExtension?: FairValueCloseExtension;
}

/** 정규장 일봉으로 앱장 종가 근사 — 장중 방향의 25%가 앱장에 이어진다고 가정 */
export function estimateAhClose(bar: HistoricalPoint): number {
  const reg = bar.close;
  if (reg <= 0) return reg;
  if (bar.open <= 0) return reg;
  const intraday = (reg - bar.open) / bar.open;
  return Math.round(reg * (1 + intraday * 0.25));
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** 히스토리만으로 1일 drift 중심 추정 (predictor 1일 center 근사) */
export function estimateDriftCenter(
  history: HistoricalPoint[],
  livePrice: number
): number {
  if (history.length < 15 || livePrice <= 0) return livePrice;
  const closes = history.map((p) => p.close).filter((c) => c > 0);
  if (closes.length < 15) return livePrice;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const recent = returns.slice(-20);
  const mu = recent.reduce((a, b) => a + b, 0) / recent.length;
  const drift = Math.max(-0.02, Math.min(0.02, mu));
  return livePrice * Math.exp(drift);
}

/** 날짜 정확 일치가 어려우면 끝에서부터 인덱스 정렬 (영업일 수 근사) */
function alignByIndex(
  stock: HistoricalPoint[],
  other: HistoricalPoint[]
): Array<{ stock: HistoricalPoint; other: HistoricalPoint }> {
  const a = [...stock].sort((x, y) => x.date - y.date);
  const b = [...other].sort((x, y) => x.date - y.date);
  const n = Math.min(a.length, b.length);
  const out: Array<{ stock: HistoricalPoint; other: HistoricalPoint }> = [];
  for (let i = 0; i < n; i++) {
    out.push({
      stock: a[a.length - n + i],
      other: b[b.length - n + i],
    });
  }
  return out;
}

function impliedGdrKrw(
  gdrClose: number,
  usdKrw: number,
  sharesPerReceipt: number
): number {
  return (gdrClose * usdKrw) / sharesPerReceipt;
}

function runScenario(
  stockHist: HistoricalPoint[],
  gdrPairs: Array<{ stock: HistoricalPoint; other: HistoricalPoint }> | null,
  fxPairs: Array<{ stock: HistoricalPoint; other: HistoricalPoint }> | null,
  scenario: FairValueScenario,
  weights: FairValueWeights,
  sharesPerReceipt: number,
  closeExtension: FairValueCloseExtension = FAIR_VALUE_CLOSE_EXTENSION
): FairValueBacktestRow[] {
  const rows: FairValueBacktestRow[] = [];
  const minIdx = 25;

  for (let i = minIdx; i < stockHist.length - 1; i++) {
    const histSlice = stockHist.slice(0, i + 1);
    const prev = stockHist[i - 1];
    const cur = stockHist[i];
    const next = stockHist[i + 1];
    if (!prev || !cur || !next) continue;

    let live: number;
    let prevClose: number;
    let actual: number;
    let marketClosed: boolean;
    let gdrImplied: number | null = null;

    if (scenario === "openToClose") {
      live = cur.open > 0 ? cur.open : cur.close;
      prevClose = prev.close;
      actual = cur.close;
      marketClosed = false;
    } else if (
      scenario === "ahCloseToNextOpen" ||
      scenario === "ahCloseToNextClose"
    ) {
      live = estimateAhClose(cur);
      prevClose = prev.close;
      actual =
        scenario === "ahCloseToNextClose" ? next.close : next.open;
      marketClosed = true;
    } else {
      live = cur.close;
      prevClose = prev.close;
      actual =
        scenario === "nightToNextClose" ? next.close : next.open;
      marketClosed = true;
    }

    if (live <= 0 || prevClose <= 0 || actual <= 0) continue;

    if (gdrPairs && fxPairs) {
      const gdrPair = gdrPairs.find((p) => p.stock.date === cur.date);
      const fxPair = fxPairs.find((p) => p.stock.date === cur.date);
      const gdrRow = gdrPair ?? gdrPairs[i - minIdx];
      const fxRow = fxPair ?? fxPairs[i - minIdx];
      if (
        gdrRow &&
        fxRow &&
        gdrRow.other.close > 0 &&
        fxRow.other.close > 0
      ) {
        gdrImplied = impliedGdrKrw(
          gdrRow.other.close,
          fxRow.other.close,
          sharesPerReceipt
        );
      }
    }

    const driftCenter = estimateDriftCenter(histSlice, live);
    const openBlend = blendFairValuePrice({
      live,
      prevClose,
      driftCenter,
      gdrImpliedKrw: gdrImplied,
      marketClosed,
      weights,
    });
    if (!openBlend) continue;

    const estimate =
      scenario === "nightToNextClose" || scenario === "ahCloseToNextClose"
        ? blendCloseFromOpen(openBlend.price, driftCenter, closeExtension).price
        : openBlend.price;

    const errorAbs = Math.abs(estimate - actual);
    const errorPct = errorAbs / actual;
    const estDir = estimate - live;
    const actDir = actual - live;
    const directionHit =
      (estDir >= 0 && actDir >= 0) || (estDir < 0 && actDir < 0);

    rows.push({
      date: cur.date,
      scenario,
      estimate,
      actual,
      errorAbs,
      errorPct,
      directionHit,
      predictedDown: estDir < 0,
    });
  }

  return rows;
}

function summarize(
  scenario: FairValueScenario,
  rows: FairValueBacktestRow[]
): FairValueBacktestSummary {
  if (rows.length === 0) {
    return {
      scenario,
      samples: 0,
      mae: 0,
      mape: 0,
      directionAccuracy: 0,
      rows: [],
    };
  }
  return {
    scenario,
    samples: rows.length,
    mae: mean(rows.map((r) => r.errorAbs)),
    mape: mean(rows.map((r) => r.errorPct)),
    directionAccuracy: mean(rows.map((r) => (r.directionHit ? 1 : 0))),
    rows,
  };
}

export interface WeekdayBacktestBucket {
  weekday: string;
  samples: number;
  directionAccuracy: number;
  bearishPredictions: number;
  bearishRate: number;
  mape: number;
}

/** 익일(다음 봉) 요일별 방향 적중률 — 월요일 하락 편향 검증용 */
export function backtestFairValueByTargetWeekday(
  input: FairValueBacktestInput,
  scenario: FairValueScenario = "nightToNextOpen"
): WeekdayBacktestBucket[] {
  const summaries = backtestFairValue(input);
  const target = summaries.find((s) => s.scenario === scenario);
  if (!target || target.rows.length === 0) return [];

  const buckets = new Map<
    string,
    { hits: number; n: number; bearish: number; mapeSum: number }
  >();

  for (const row of target.rows) {
    const nextIdx = input.stockHist.findIndex((p) => p.date === row.date);
    if (nextIdx < 0 || nextIdx >= input.stockHist.length - 1) continue;
    const nextBar = input.stockHist[nextIdx + 1];
    if (!nextBar) continue;

    const wd = weekdayLabelInTz(new Date(nextBar.date), "Asia/Seoul");
    const b = buckets.get(wd) ?? { hits: 0, n: 0, bearish: 0, mapeSum: 0 };
    b.n += 1;
    if (row.directionHit) b.hits += 1;
    if (row.predictedDown) b.bearish += 1;
    b.mapeSum += row.errorPct;
    buckets.set(wd, b);
  }

  const order = ["월", "화", "수", "목", "금"];
  return order
    .filter((wd) => buckets.has(wd))
    .map((wd) => {
      const b = buckets.get(wd)!;
      return {
        weekday: wd,
        samples: b.n,
        directionAccuracy: b.n > 0 ? b.hits / b.n : 0,
        bearishPredictions: b.bearish,
        bearishRate: b.n > 0 ? b.bearish / b.n : 0,
        mape: b.n > 0 ? b.mapeSum / b.n : 0,
      };
    });
}

/** 금→월(3일 갭) vs 평일(1일) 시나리오 비교 */
export function summarizeGapBias(
  input: FairValueBacktestInput,
  scenario: FairValueScenario = "nightToNextOpen"
): { weekdayGap: number; weekendGap: number; weekdayDir: number; weekendDir: number } {
  const summaries = backtestFairValue(input);
  const target = summaries.find((s) => s.scenario === scenario);
  if (!target) {
    return { weekdayGap: 1, weekendGap: 3, weekdayDir: 0, weekendDir: 0 };
  }

  let wdHits = 0;
  let wdN = 0;
  let weHits = 0;
  let weN = 0;

  for (const row of target.rows) {
    const curIdx = input.stockHist.findIndex((p) => p.date === row.date);
    if (curIdx < 0) continue;
    const curBar = input.stockHist[curIdx];
    const curWd = new Date(curBar.date).getUTCDay();
    const isFriday = curWd === 5;
    if (isFriday) {
      weN += 1;
      if (row.directionHit) weHits += 1;
    } else if (curWd >= 1 && curWd <= 4) {
      wdN += 1;
      if (row.directionHit) wdHits += 1;
    }
  }

  return {
    weekdayGap: 1,
    weekendGap: 3,
    weekdayDir: wdN > 0 ? wdHits / wdN : 0,
    weekendDir: weN > 0 ? weHits / weN : 0,
  };
}

export { macroGapScale };

export function backtestFairValue(
  input: FairValueBacktestInput
): FairValueBacktestSummary[] {
  const weights = input.weights ?? FAIR_VALUE_WEIGHTS;
  const closeExtension = input.closeExtension ?? FAIR_VALUE_CLOSE_EXTENSION;
  const shares = input.sharesPerReceipt ?? 25;
  const stockHist = [...input.stockHist].sort((a, b) => a.date - b.date);

  const gdrPairs =
    input.gdrHist && input.gdrHist.length > 0
      ? alignByIndex(stockHist, input.gdrHist)
      : null;
  const fxPairs =
    input.usdKrwHist && input.usdKrwHist.length > 0
      ? alignByIndex(stockHist, input.usdKrwHist)
      : null;

  const scenarios: FairValueScenario[] = [
    "openToClose",
    "nightToNextClose",
    "nightToNextOpen",
    "ahCloseToNextOpen",
    "ahCloseToNextClose",
  ];

  return scenarios.map((scenario) =>
    summarize(
      scenario,
      runScenario(
        stockHist,
        gdrPairs,
        fxPairs,
        scenario,
        weights,
        shares,
        closeExtension
      )
    )
  );
}

/** 그리드 서치로 시나리오별 MAPE 최소 가중치 탐색 */
export function optimizeFairValueWeights(
  input: FairValueBacktestInput,
  scenario: FairValueScenario = "nightToNextClose"
): { weights: FairValueWeights; mape: number; summary: FairValueBacktestSummary } {
  let best: FairValueWeights = FAIR_VALUE_WEIGHTS;
  let bestMape = Infinity;
  let bestSummary: FairValueBacktestSummary | null = null;

  const gdrVals = [0.4, 0.45, 0.5, 0.55, 0.6];
  const driftVals = [0.25, 0.3, 0.35, 0.4];
  const liveVals = [0.1, 0.15, 0.2, 0.25];

  for (const gdr of gdrVals) {
    for (const drift of driftVals) {
      for (const live of liveVals) {
        const sum = gdr + drift + live;
        if (Math.abs(sum - 1) > 0.02) continue;
        const weights: FairValueWeights = {
          nightClosed: { gdr, drift, live },
          nightOpen: {
            gdr: Math.round(gdr * 0.6 * 100) / 100,
            drift,
            live: Math.round((1 - gdr * 0.6 - drift) * 100) / 100,
          },
          noGdr: { ...FAIR_VALUE_WEIGHTS.noGdr },
        };
        const summaries = backtestFairValue({ ...input, weights });
        const target = summaries.find((s) => s.scenario === scenario);
        if (!target || target.samples < 10) continue;
        if (target.mape < bestMape) {
          bestMape = target.mape;
          best = weights;
          bestSummary = target;
        }
      }
    }
  }

  return {
    weights: best,
    mape: bestMape,
    summary: bestSummary ?? summarize(scenario, []),
  };
}

/** 익일 종가 혼합 비율 그리드 서치 */
export function optimizeCloseExtension(
  input: FairValueBacktestInput,
  scenario: FairValueScenario = "nightToNextClose"
): {
  extension: FairValueCloseExtension;
  mape: number;
  summary: FairValueBacktestSummary;
} {
  let best: FairValueCloseExtension = { ...FAIR_VALUE_CLOSE_EXTENSION };
  let bestMape = Infinity;
  let bestSummary: FairValueBacktestSummary | null = null;

  for (let openPct = 20; openPct <= 50; openPct += 2) {
    const openShare = openPct / 100;
    const driftShare = 1 - openShare;
    const target = backtestFairValue({
      ...input,
      closeExtension: { openShare, driftShare },
    }).find((s) => s.scenario === scenario);
    if (!target || target.samples < 10) continue;
    if (target.mape < bestMape) {
      bestMape = target.mape;
      best = { openShare, driftShare };
      bestSummary = target;
    }
  }

  return {
    extension: best,
    mape: bestMape,
    summary: bestSummary ?? summarize(scenario, []),
  };
}
