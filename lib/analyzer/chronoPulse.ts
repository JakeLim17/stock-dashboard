import type {
  EventItem,
  FlowData,
  NewsRiskAssessment,
  Quote,
  StockSnapshot,
  SymbolMeta,
  ValuationMetrics,
} from "../types";
import { usMarketDrift } from "./marketDrift";
import type { HistoricalPoint } from "../providers/yahoo";
import { isHoldingCompanyCode } from "../symbols";

/** Chrono 전용 다요인 예측 엔진 — 양방향 drift·요인 분해 */
export const CHRONO_PULSE_NAME = "ChronoPulse";
export const CHRONO_PULSE_SUBTITLE = "가산 알파 레이어";

export interface ChronoPulseFactor {
  id: string;
  label: string;
  /** basis points (0.01% 단위, 음수 가능) */
  bps: number;
}

export interface ChronoPulseResult {
  name: string;
  subtitle: string;
  /** 일간 로그 drift (예: -0.005 = 약 -0.5%/일) — structural + lag0 */
  driftDaily: number;
  /** 수급·뉴스·밸류·컨센 등 — 장기로 √t 누적 */
  structuralDaily: number;
  /** 당일 미장·환율 등 lag-0 — 단기만 */
  lag0Daily: number;
  factors: ChronoPulseFactor[];
}

export interface ChronoPulseInput {
  meta?: SymbolMeta | null;
  quote: Quote;
  flow: FlowData;
  buyScore: number;
  heatScore: number;
  externalRisk: StockSnapshot["analysis"]["externalRisk"];
  externalOpportunity?: StockSnapshot["analysis"]["externalOpportunity"];
  valuation?: ValuationMetrics | null;
  consensusUpside?: number | null;
  marketContext?: StockSnapshot["marketContext"];
  predictions?: Pick<
    NonNullable<StockSnapshot["predictions"]>,
    "macroBetas" | "modelConfidence"
  > | null;
  history?: HistoricalPoint[];
  ixicHistory?: HistoricalPoint[] | null;
  soxHistory?: HistoricalPoint[] | null;
  dxyHistory?: HistoricalPoint[] | null;
  us10yHistory?: HistoricalPoint[] | null;
  todayChangeRate?: number | null;
  momentumActive?: boolean;
  newsRisk?: NewsRiskAssessment | null;
  events?: EventItem[] | null;
  overseasNightRate?: number | null;
  dxyLastReturn?: number | null;
  us10yLastReturn?: number | null;
}

const DAILY_DRIFT_CAP = 0.012;
const FACTOR_MIN_BPS = 1;

function clampDrift(d: number, cap = DAILY_DRIFT_CAP): number {
  return Math.max(-cap, Math.min(cap, d));
}

function pushFactor(
  factors: ChronoPulseFactor[],
  id: string,
  label: string,
  bps: number
): number {
  if (Math.abs(bps) < FACTOR_MIN_BPS) return 0;
  factors.push({ id, label, bps });
  return bps / 10_000;
}

/** lag-0(당일 시장) horizon 가중 — 1주 이상이면 0 */
export function chronoPulseLag0HorizonWeight(horizonDays: number): number {
  if (horizonDays <= 1) return 1;
  if (horizonDays <= 3) return 0.55;
  if (horizonDays <= 5) return 0.2;
  return 0;
}

/**
 * 구조 신호(수급·뉴스·밸류·컨센) horizon 지속률.
 * √t 누적에 곱해 장기 곡선이 완전히 평평해지지 않게 한다.
 * (구버전 0.15×√t 는 월간 ≈0.7×일간이라 그래프가 수평선처럼 보였음)
 */
export function chronoPulseStructuralPersist(horizonDays: number): number {
  if (horizonDays <= 1) return 1;
  if (horizonDays <= 3) return 0.9;
  if (horizonDays <= 5) return 0.78;
  if (horizonDays <= 10) return 0.65;
  return 0.55;
}

/** @deprecated lag0/structural 분리 후 호환용 — 구조 persist 와 동일 스케일 */
export function chronoPulseHorizonWeight(horizonDays: number): number {
  return chronoPulseStructuralPersist(horizonDays);
}

/** N거래일 누적 로그 drift — 구조는 √t 누적, lag-0는 단기만 */
export function chronoPulseDriftForHorizon(
  driftDaily: number,
  horizonDays: number,
  parts?: { structuralDaily?: number; lag0Daily?: number }
): number {
  const structural =
    parts?.structuralDaily ??
    (parts?.lag0Daily != null ? driftDaily - parts.lag0Daily : driftDaily * 0.7);
  const lag0 =
    parts?.lag0Daily ??
    (parts?.structuralDaily != null
      ? driftDaily - parts.structuralDaily
      : driftDaily * 0.3);
  const structuralCum =
    structural *
    Math.sqrt(Math.max(1, horizonDays)) *
    chronoPulseStructuralPersist(horizonDays);
  const lag0Cum = lag0 * chronoPulseLag0HorizonWeight(horizonDays);
  return clampDrift(structuralCum + lag0Cum, 0.09);
}

function lastReturn(hist: HistoricalPoint[] | null | undefined): number {
  if (!hist || hist.length < 2) return 0;
  const last = hist[hist.length - 1];
  const prev = hist[hist.length - 2];
  if (!Number.isFinite(last.close) || !Number.isFinite(prev.close)) return 0;
  if (prev.close <= 0) return 0;
  return (last.close - prev.close) / prev.close;
}

type FactorCategory =
  | "kr-export"
  | "kr-domestic"
  | "us-growth"
  | "us-value"
  | "neutral";

const KR_EXPORT_SECTORS = new Set([
  "반도체",
  "반도체장비",
  "반도체소재",
  "자동차",
  "조선",
  "디스플레이",
  "화학",
  "신재생",
  "식음료",
  "글로벌반도체",
]);

function classifySector(meta: SymbolMeta | null | undefined): FactorCategory {
  const s = meta?.sector;
  if (!s) return "neutral";
  if (meta?.kind === "us-stock") {
    if (/글로벌IT|글로벌AI|글로벌소프트웨어|글로벌AI인프라/.test(s))
      return "us-growth";
    return "us-value";
  }
  if (KR_EXPORT_SECTORS.has(s)) return "kr-export";
  if (/금융|통신|유통|게임|건설/.test(s)) return "kr-domestic";
  return "neutral";
}

function macroHeuristicDrift(
  meta: SymbolMeta | null | undefined,
  dxyR: number,
  us10yR: number
): number {
  const cat = classifySector(meta);
  let dxyBeta = 0;
  let us10yBeta = 0;
  switch (cat) {
    case "kr-export":
      dxyBeta = -0.35;
      us10yBeta = -0.45;
      break;
    case "kr-domestic":
      dxyBeta = -0.08;
      us10yBeta = 0.12;
      break;
    case "us-growth":
      dxyBeta = -0.25;
      us10yBeta = -0.55;
      break;
    case "us-value":
      dxyBeta = -0.05;
      us10yBeta = -0.15;
      break;
    default:
      dxyBeta = -0.12;
      us10yBeta = -0.2;
  }
  const raw = dxyBeta * dxyR + us10yBeta * us10yR;
  return Math.max(-0.01, Math.min(0.01, raw));
}

function supplyFactor(flow: FlowData): number {
  let bps = 0;
  const useMock = flow.source === "mock";
  const mockScale = useMock ? 0.55 : 1;

  const f5 = flow.foreignNet5d;
  if (f5 != null) {
    const eok = f5 / 1e8;
    if (eok >= 500) bps += 28;
    else if (eok >= 200) bps += 14;
    else if (eok <= -500) bps -= 32;
    else if (eok <= -200) bps -= 16;
  } else if (flow.foreignNet != null) {
    const eok = flow.foreignNet / 1e8;
    if (eok >= 100) bps += 10;
    else if (eok <= -100) bps -= 12;
  }

  const i5 = flow.institutionNet5d;
  if (i5 != null) {
    const eok = i5 / 1e8;
    if (eok >= 300) bps += 10;
    else if (eok <= -300) bps -= 12;
  }

  return Math.round(bps * mockScale);
}

function valuationMeanReversionBps(
  v: ValuationMetrics | null | undefined,
  code?: string
): number {
  if (!v) return 0;
  let bps = 0;
  const isHolding = code ? isHoldingCompanyCode(code) : false;
  const perHigh = isHolding ? 100 : 75;
  const perLow = isHolding ? 18 : 14;

  if (v.per != null && v.per > 0) {
    if (v.per >= 120) bps -= 35;
    else if (v.per >= perHigh) bps -= 18;
    else if (v.per <= perLow) bps += 12;
  } else if (v.per != null && v.per <= 0) {
    bps -= 25;
  }

  if (v.forwardPer != null && v.forwardPer > 0) {
    if (v.forwardPer >= 55) bps -= 14;
    else if (v.forwardPer <= 12) bps += 8;
  }

  if (v.pbr != null && v.pbr > 4.5) bps -= 12;
  else if (v.pbr != null && v.pbr > 0 && v.pbr <= 1.2) bps += 6;

  return bps;
}

function earningsEventBps(events: EventItem[] | null | undefined): number {
  if (!events?.length) return 0;
  const now = Date.now();
  let bps = 0;
  for (const e of events) {
    if (e.kind !== "earnings") continue;
    const days = (e.date - now) / 86_400_000;
    if (days < -3 || days > 14) continue;
    const imp = e.importance === "high" ? 1 : e.importance === "medium" ? 0.6 : 0.35;
    if (days >= 0 && days <= 3) {
      bps += Math.round(12 * imp);
    } else if (days < 0 && days >= -2) {
      bps -= Math.round(8 * imp);
    }
  }
  return Math.min(25, Math.max(-20, bps));
}

/**
 * ChronoPulse — 수급·뉴스·밸류·매크로·모멘텀을 합산한 양방향 일간 drift.
 * 유료 LLM 없이 기존 데이터만 사용한다.
 */
const LAG0_FACTOR_IDS = new Set([
  "ixic",
  "sox",
  "kospi",
  "dxy",
  "sector",
  "us-lag",
  "macro",
  "gdr",
]);

export function computeChronoPulse(input: ChronoPulseInput): ChronoPulseResult {
  const factors: ChronoPulseFactor[] = [];
  let structural = 0;
  let lag0 = 0;

  const {
    meta,
    quote,
    flow,
    buyScore,
    heatScore,
    externalRisk,
    externalOpportunity,
    valuation,
    consensusUpside,
    marketContext,
    predictions,
    history,
    ixicHistory,
    soxHistory,
    dxyHistory,
    us10yHistory,
    todayChangeRate,
    momentumActive,
    newsRisk,
    events,
    overseasNightRate,
    dxyLastReturn,
    us10yLastReturn,
  } = input;

  const isUsStock = meta?.kind === "us-stock";
  const dxyHistForLag = isUsStock ? (dxyHistory ?? []).slice(0, -1) : dxyHistory;
  const us10yHistForLag = isUsStock
    ? (us10yHistory ?? []).slice(0, -1)
    : us10yHistory;
  const soxHistForLag = isUsStock ? (soxHistory ?? []).slice(0, -1) : soxHistory;
  const ixicHistForLag = isUsStock ? (ixicHistory ?? []).slice(0, -1) : ixicHistory;

  const add = (id: string, label: string, bps: number): void => {
    const d = pushFactor(factors, id, label, bps);
    if (LAG0_FACTOR_IDS.has(id)) lag0 += d;
    else structural += d;
  };

  // ── 1. 수급 ──
  const supplyBps = supplyFactor(flow);
  if (supplyBps !== 0) {
    add(
      "supply",
      supplyBps >= 0 ? "수급 순매수" : "수급 순매도",
      supplyBps
    );
  }

  // ── 2. 뉴스·지정학 (실제 리스크/호재만 — "뉴스 안정 +0.1%" 더미 제거) ──
  if (externalRisk.level === "high") {
    add("news-risk", "지정학·악재", -75);
  } else if (externalRisk.level === "medium") {
    add("news-risk", "외부 리스크", -38);
  }

  if (newsRisk?.level === "high") {
    add("news-vol", "뉴스 불확실", -15);
  }

  if (externalOpportunity?.level === "high") {
    add("news-opp", "호재 뉴스", 28);
  } else if (externalOpportunity?.level === "medium") {
    add("news-opp", "호재 뉴스", 14);
  }

  const geoDriver = externalRisk.drivers.some((d) =>
    /지정학|관세|제재|geo/i.test(d.category)
  );
  if (geoDriver && externalRisk.level !== "low") {
    add("geo-vol", "지정학 변동성", -22);
  }
  const valBps = valuationMeanReversionBps(valuation, meta?.code);
  if (valBps !== 0) {
    add(
      "valuation",
      valBps >= 0 ? "저평가 보정" : "고평가 보정",
      valBps
    );
  }

  const earnBps = earningsEventBps(events);
  if (earnBps !== 0) {
    add(
      "earnings",
      earnBps >= 0 ? "실적 기대" : "실적 소화",
      earnBps
    );
  }

  if (consensusUpside != null && Math.abs(consensusUpside) > 0.008) {
    const capped = Math.max(-80, Math.min(80, Math.round(consensusUpside * 180)));
    add(
      "consensus",
      capped >= 0 ? "컨센 상방" : "컨센 하방",
      capped
    );
  }

  // ── 4. 미장·섹터·매크로 (lag-0) ──
  const mb = predictions?.macroBetas;
  if (marketContext && mb) {
    if (mb.ixic && Math.abs(marketContext.nasdaqRate) > 0.0001) {
      const r = mb.ixic.beta * marketContext.nasdaqRate;
      const w = Math.min(1, mb.ixic.r2 + 0.15);
      add(
        "ixic",
        `나스닥 β${mb.ixic.beta.toFixed(1)}`,
        Math.round(r * w * 10_000)
      );
    }
    if (mb.sox && Math.abs(marketContext.soxRate) > 0.0001) {
      const r = mb.sox.beta * marketContext.soxRate;
      const w = Math.min(1, mb.sox.r2 + 0.15);
      add(
        "sox",
        `SOX β${mb.sox.beta.toFixed(1)}`,
        Math.round(r * w * 10_000)
      );
    }
    if (mb.kospi && Math.abs(marketContext.kospiRate) > 0.0001) {
      const r = mb.kospi.beta * marketContext.kospiRate;
      const w = Math.min(1, mb.kospi.r2 + 0.2);
      add(
        "kospi",
        `코스피 β${mb.kospi.beta.toFixed(1)}`,
        Math.round(r * w * 10_000)
      );
    }
    if (mb.dxy && Math.abs(marketContext.fxRate) > 0.0001) {
      const r = mb.dxy.beta * marketContext.fxRate;
      const w = Math.min(1, (mb.dxy.r2 ?? 0) + 0.12);
      add(
        "dxy",
        `달러 β${mb.dxy.beta.toFixed(1)}`,
        Math.round(r * w * 10_000)
      );
    }
  }

  // SOX는 위 mb.sox 채널로만 — sector 이중 가산 제거 (반도체 3종 flat·동일화 완화)

  const ixicBeta = mb?.ixic;
  const ixicDrift = usMarketDrift(
    ixicBeta?.beta,
    ixicBeta?.r2,
    ixicHistForLag ? lastReturn(ixicHistForLag) : 0
  );
  if (Math.abs(ixicDrift) >= 0.0001) {
    add(
      "us-lag",
      "미장 lag",
      Math.round(ixicDrift * 10_000)
    );
  }

  const dxyR = dxyLastReturn ?? lastReturn(dxyHistForLag);
  const us10yR = us10yLastReturn ?? lastReturn(us10yHistForLag);
  const macroDrift = macroHeuristicDrift(meta, dxyR, us10yR);
  if (Math.abs(macroDrift) >= 0.0001) {
    add(
      "macro",
      "달러·금리",
      Math.round(macroDrift * 10_000)
    );
  }

  const vix = marketContext?.vix;
  if (vix != null && Number.isFinite(vix)) {
    if (vix >= 28) add("vix", "VIX 공포", -55);
    else if (vix >= 22) add("vix", "VIX 경계", -28);
    else if (vix < 14) add("vix", "VIX 안정", 8);
  }

  if (marketContext?.semiHeat != null) {
    if (marketContext.semiHeat >= 72) {
      add("semi-heat", "반도체 과열", -22);
    } else if (marketContext.semiHeat <= 35) {
      add("semi-cool", "반도체 냉각", 10);
    }
  }

  if (
    overseasNightRate != null &&
    Math.abs(overseasNightRate) > 0.003 &&
    meta?.kind === "kr-stock"
  ) {
    add(
      "gdr",
      "해외 야간",
      Math.round(overseasNightRate * 0.35 * 10_000)
    );
  }

  // ── 5. 심리·과열 (모멘텀/당일 되돌림은 baseDrift 레이어 담당) ──
  const sentimentBps = Math.round(((buyScore - 50) / 50) * 18);
  add("sentiment", "매수 심리", sentimentBps);

  if (heatScore >= 78) {
    add("heat", "단기 과열", -28);
  } else if (heatScore <= 32) {
    add("heat-cool", "과열 완화", 10);
  }

  void quote;
  void history;
  void todayChangeRate;
  void momentumActive;

  const conf = predictions?.modelConfidence?.score;
  if (conf != null && conf < 0.65) {
    const scale = 0.55 + conf * 0.5;
    structural *= scale;
    lag0 *= scale;
    factors.push({ id: "confidence", label: `신뢰도 ${Math.round(conf * 100)}%`, bps: 0 });
  }

  const cap = momentumActive ? DAILY_DRIFT_CAP * 1.25 : DAILY_DRIFT_CAP;
  const structuralDaily = clampDrift(structural, cap);
  const lag0Daily = clampDrift(lag0, cap);
  const driftDaily = clampDrift(structuralDaily + lag0Daily, cap);

  return {
    name: CHRONO_PULSE_NAME,
    subtitle: CHRONO_PULSE_SUBTITLE,
    driftDaily,
    structuralDaily,
    lag0Daily,
    factors: factors
      .filter((f) => Math.abs(f.bps) >= FACTOR_MIN_BPS || f.bps === 0)
      .sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps)),
  };
}

/** UI용 — bps를 ±% 문자열로 */
export function formatChronoPulseBps(bps: number): string {
  const pct = bps / 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
