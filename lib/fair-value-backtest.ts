import type { HistoricalPoint } from "./providers/yahoo";
import {
  blendFairValuePrice,
  type FairValueWeights,
  FAIR_VALUE_WEIGHTS,
} from "./fair-value";

export type FairValueScenario =
  | "openToClose"
  | "nightToNextClose"
  | "nightToNextOpen";

export interface FairValueBacktestRow {
  date: number;
  scenario: FairValueScenario;
  estimate: number;
  actual: number;
  errorAbs: number;
  errorPct: number;
  directionHit: boolean;
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
  sharesPerReceipt: number
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
    } else {
      live = cur.close;
      prevClose = prev.close;
      actual = scenario === "nightToNextClose" ? next.close : next.open;
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
    const blended = blendFairValuePrice({
      live,
      prevClose,
      driftCenter,
      gdrImpliedKrw: gdrImplied,
      marketClosed,
      weights,
    });
    if (!blended) continue;

    const errorAbs = Math.abs(blended.price - actual);
    const errorPct = errorAbs / actual;
    const estDir = blended.price - prevClose;
    const actDir = actual - prevClose;
    const directionHit =
      (estDir >= 0 && actDir >= 0) || (estDir < 0 && actDir < 0);

    rows.push({
      date: cur.date,
      scenario,
      estimate: blended.price,
      actual,
      errorAbs,
      errorPct,
      directionHit,
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

export function backtestFairValue(
  input: FairValueBacktestInput
): FairValueBacktestSummary[] {
  const weights = input.weights ?? FAIR_VALUE_WEIGHTS;
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
        shares
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
