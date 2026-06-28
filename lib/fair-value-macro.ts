import type { StockSnapshot } from "./types";

export interface MacroAdjustmentFactor {
  label: string;
  /** basis points (0.01% 단위) */
  bps: number;
}

export interface MacroFairValueAdjustment {
  /** 가격에 곱할 비율 보정 (0.01 = +1%) */
  rate: number;
  factors: MacroAdjustmentFactor[];
}

const MAX_MACRO_RATE = 0.035;

function clampRate(r: number): number {
  return Math.max(-MAX_MACRO_RATE, Math.min(MAX_MACRO_RATE, r));
}

/** 다가올 종목 일정 → 익일 추정 보정 (ADR·실적·커스텀 호재) */
function calendarCatalystBps(
  events: StockSnapshot["upcomingEvents"],
  symbolCode: string
): number {
  if (!events?.length) return 0;
  const now = Date.now();
  let bps = 0;

  for (const e of events) {
    if (e.symbolCode && e.symbolCode !== symbolCode) continue;
    const daysUntil = (e.date - now) / 86_400_000;
    if (daysUntil < -2 || daysUntil > 21) continue;

    const label = `${e.label} ${e.detail ?? ""}`;
    const isAdr =
      /ADR|예탁증권|나스닥|NASDAQ|상장/i.test(label) || e.detail?.includes("ipo");
    const isEarnings = e.kind === "earnings" && /실적|어닝|earnings/i.test(label);
    const isCustomCatalyst =
      /기대|수혜|서프라이즈|리밸런싱|매입/i.test(label) && e.importance !== "low";

    const imp =
      e.importance === "high" ? 1 : e.importance === "medium" ? 0.65 : 0.35;

    // D-day 가까울수록 기대감 반영 (7일 이내 피크)
    const proximity =
      daysUntil <= 0 ? 0.5 : daysUntil <= 7 ? 1 : daysUntil <= 14 ? 0.7 : 0.45;

    if (isAdr) bps += Math.round(32 * imp * proximity);
    else if (isEarnings && daysUntil >= 0 && daysUntil <= 10)
      bps += Math.round(18 * imp * proximity);
    else if (isCustomCatalyst)
      bps += Math.round(14 * imp * proximity);
  }

  return Math.min(bps, 45);
}

function pushFactor(
  factors: MacroAdjustmentFactor[],
  label: string,
  bps: number
): number {
  if (Math.abs(bps) < 1) return 0;
  factors.push({ label, bps });
  return bps / 10_000;
}

export interface MacroFairValueOptions {
  /** GDR 혼합(blendFairValuePrice)에 이미 반영됐으면 괴리 중복 보정 생략 */
  skipGdrPremium?: boolean;
  /** 금→월 등 멀티데이 갭일 때 매크로 과대 보정 완화 (0~1) */
  gapScale?: number;
}

/** 익일 추정가 매크로·심리·지정학 보정 — predictor 산출물 + 시장 컨텍스트 재조합 */
export function computeMacroFairValueAdjustment(
  snap: StockSnapshot,
  options: MacroFairValueOptions = {}
): MacroFairValueAdjustment {
  const { skipGdrPremium = false, gapScale = 1 } = options;
  const factors: MacroAdjustmentFactor[] = [];
  let rate = 0;
  const p = snap.predictions;
  const a = snap.analysis;
  const ctx = snap.marketContext;
  const flow = snap.flow;

  // ── VIX (공포지수) ─────────────────────────────────────
  const vix = ctx?.vix ?? null;
  if (vix != null && Number.isFinite(vix)) {
    if (vix >= 30) rate += pushFactor(factors, "VIX 공포", -90);
    else if (vix >= 25) rate += pushFactor(factors, "VIX 경계", -55);
    else if (vix >= 20) rate += pushFactor(factors, "VIX 상승", -25);
    else if (vix < 14) rate += pushFactor(factors, "VIX 안정", 15);
  }

  // ── 코스피 · SOX · 환율 — 회귀 베타 × 당일 지수 등락 ───
  if (ctx && p?.macroBetas) {
    const mb = p.macroBetas;
    if (mb.kospi && Math.abs(ctx.kospiRate) > 0.0001) {
      const r = mb.kospi.beta * ctx.kospiRate;
      const w = Math.min(1, mb.kospi.r2 + 0.2);
      rate += pushFactor(
        factors,
        `코스피 β${mb.kospi.beta.toFixed(2)}`,
        Math.round(r * w * 10_000)
      );
    }
    if (mb.sox && Math.abs(ctx.soxRate) > 0.0001) {
      const r = mb.sox.beta * ctx.soxRate;
      const w = Math.min(1, mb.sox.r2 + 0.2);
      rate += pushFactor(
        factors,
        `SOX β${mb.sox.beta.toFixed(2)}`,
        Math.round(r * w * 10_000)
      );
    }
    if (mb.dxy && Math.abs(ctx.fxRate) > 0.0001) {
      const r = mb.dxy.beta * ctx.fxRate;
      const w = Math.min(1, (mb.dxy.r2 ?? 0) + 0.15);
      rate += pushFactor(
        factors,
        `달러 β${mb.dxy.beta.toFixed(2)}`,
        Math.round(r * w * 10_000)
      );
    }
    if (mb.ixic && Math.abs(ctx.nasdaqRate) > 0.0001) {
      const r = mb.ixic.beta * ctx.nasdaqRate;
      const w = Math.min(1, mb.ixic.r2 + 0.15);
      rate += pushFactor(
        factors,
        `나스닥 β${mb.ixic.beta.toFixed(2)}`,
        Math.round(r * w * 10_000)
      );
    }
  }

  // ── predictor 시나리오 (환율·금리·지수 +1% 등) ─────────
  for (const s of p?.scenarios ?? []) {
    if (Math.abs(s.expected) < 0.0005) continue;
    const conf =
      s.confidence === "high" ? 0.35 : s.confidence === "medium" ? 0.2 : 0.1;
    rate += pushFactor(
      factors,
      s.label.replace(/ 시$/, ""),
      Math.round(s.expected * conf * 10_000)
    );
  }

  // ── 반도체 시장 과열 ───────────────────────────────────
  if (ctx?.semiHeat != null) {
    if (ctx.semiHeat >= 75) rate += pushFactor(factors, "반도체 과열", -35);
    else if (ctx.semiHeat >= 65) rate += pushFactor(factors, "반도체 과열", -18);
    else if (ctx.semiHeat <= 35) rate += pushFactor(factors, "반도체 냉각", 12);
  }

  // ── 지정학·관세 뉴스 리스크 ─────────────────────────────
  const risk = a.externalRisk;
  if (risk.level === "high") rate += pushFactor(factors, "지정학·이벤트", -70);
  else if (risk.level === "medium") rate += pushFactor(factors, "외부 리스크", -35);
  else if (risk.level === "low" && risk.score <= 5)
    rate += pushFactor(factors, "뉴스 안정", 8);

  // ── 호재 뉴스 ─────────────────────────────────────────
  const opp = a.externalOpportunity;
  if (opp?.level === "high") rate += pushFactor(factors, "호재 뉴스", 50);
  else if (opp?.level === "medium") rate += pushFactor(factors, "호재 뉴스", 25);

  // ── 다가올 캘린더 호재 (ADR·실적·커스텀) ───────────────
  const catalystBps = calendarCatalystBps(snap.upcomingEvents, snap.meta.code);
  if (catalystBps !== 0) {
    rate += pushFactor(factors, "일정 호재", catalystBps);
  }

  // ── 심리 — 매수우위·과열 ───────────────────────────────
  const sentimentBps = Math.round(((a.buyScore - 50) / 50) * 25);
  rate += pushFactor(factors, "매수 심리", sentimentBps);
  if (a.heatScore >= 75) rate += pushFactor(factors, "단기 과열", -30);
  else if (a.heatScore <= 35) rate += pushFactor(factors, "과열 완화", 15);

  // ── 수급 (외인 5일) ───────────────────────────────────
  const f5 = flow.foreignNet5d;
  if (f5 != null && flow.source !== "mock") {
    const eok = f5 / 1e8;
    if (eok >= 300) rate += pushFactor(factors, "외인 5일 순매수", 22);
    else if (eok <= -300) rate += pushFactor(factors, "외인 5일 순매도", -22);
  }

  // GDR 괴리는 blendFairValuePrice(야간 60% 가중)에 이미 반영 — 중복 시 월요일 하락 편향.
  if (!skipGdrPremium) {
    const prem = snap.overseasNight?.premiumRate;
    if (prem != null && Math.abs(prem) > 0.005) {
      rate += pushFactor(
        factors,
        "GDR 괴리",
        Math.round(prem * 0.25 * 10_000)
      );
    }
  }

  // ── 모델 신뢰도로 전체 축소 ───────────────────────────
  const confScore = p?.modelConfidence?.score;
  if (confScore != null && confScore < 0.7) {
    const scale = 0.55 + confScore * 0.5;
    rate *= scale;
    factors.push({
      label: `신뢰도 ${Math.round(confScore * 100)}%`,
      bps: 0,
    });
  }

  if (gapScale < 0.999) {
    rate *= gapScale;
    factors.push({
      label: `갭 ${gapScale < 1 ? "완화" : ""}×${gapScale.toFixed(2)}`,
      bps: 0,
    });
  }

  return { rate: clampRate(rate), factors };
}
