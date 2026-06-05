import "server-only";
import type { HistoricalPoint } from "../providers/yahoo";
import type {
  PriceRange,
  PriceTargets,
  Predictions,
  Quote,
  ScenarioRow,
  OverseasNightIndicator,
  ValuationMetrics,
} from "../types";

// ─── 기본 통계 유틸 ────────────────────────────────────────

function dailyReturns(hist: HistoricalPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const prev = hist[i - 1].close;
    const cur = hist[i].close;
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
      out.push((cur - prev) / prev);
    }
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function covariance(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const x = xs.slice(-n);
  const y = ys.slice(-n);
  const mx = mean(x);
  const my = mean(y);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}

// 단순 회귀의 베타 = Cov(stock, market) / Var(market)
// R² = corr(stock, market)² — 회귀 적합도(설명력). 0.6 이상이면 시장 방향이 종목 수익률을
// 잘 설명한다고 본다. 낮으면 시나리오 자체의 신뢰도가 낮아 UI에서 회색/숨김 처리.
function regressionStats(
  stockReturns: number[],
  marketReturns: number[]
): { beta: number; r2: number } {
  const sM = stddev(marketReturns);
  const sS = stddev(stockReturns);
  if (sM === 0 || sS === 0) return { beta: 0, r2: 0 };
  const cov = covariance(stockReturns, marketReturns);
  const beta = cov / (sM * sM);
  const corr = cov / (sM * sS);
  const r2 = clamp(corr * corr, 0, 1);
  return { beta, r2 };
}

function confidenceFromR2(r2: number): "high" | "medium" | "low" {
  if (r2 >= 0.6) return "high";
  if (r2 >= 0.3) return "medium";
  return "low";
}

// ─── 일자별 inner join 회귀 베타 ───────────────────────────
// 한·미 휴장일이 다르므로 단순 tail join 시 인덱스가 어긋나 베타가 편향된다.
// 날짜(epoch ms)를 키로 inner join 후 dailyReturns로 계산해야 정확.
function alignedDailyReturns(
  stockHist: HistoricalPoint[],
  marketHist: HistoricalPoint[]
): { stock: number[]; market: number[] } {
  // Yahoo는 timestamp를 일별 동일 시각(예: 한국 09:00 / 미국 16:00 close)으로 주지만
  // ms 단위가 정확히 같다는 보장은 없다. YYYY-MM-DD 키로 정규화해서 join.
  const dayKey = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  };
  const mMap = new Map<string, number>();
  for (const p of marketHist) {
    if (Number.isFinite(p.close) && p.close > 0) {
      mMap.set(dayKey(p.date), p.close);
    }
  }
  const aligned: { date: number; s: number; m: number }[] = [];
  for (const p of stockHist) {
    if (!Number.isFinite(p.close) || p.close <= 0) continue;
    const m = mMap.get(dayKey(p.date));
    if (m == null) continue;
    aligned.push({ date: p.date, s: p.close, m });
  }
  aligned.sort((a, b) => a.date - b.date);

  const sRet: number[] = [];
  const mRet: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const ps = aligned[i - 1].s;
    const cs = aligned[i].s;
    const pm = aligned[i - 1].m;
    const cm = aligned[i].m;
    if (ps > 0 && pm > 0) {
      sRet.push((cs - ps) / ps);
      mRet.push((cm - pm) / pm);
    }
  }
  return { stock: sRet, market: mRet };
}

// ATR (Average True Range, 14일 기본)
function averageTrueRange(hist: HistoricalPoint[], period = 14): number {
  if (hist.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const h = hist[i].high;
    const l = hist[i].low;
    const pc = hist[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  return mean(trs.slice(-period));
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function valuationRisk(v?: ValuationMetrics | null): Predictions["valuation"] {
  if (!v) return null;

  const reasons: string[] = [];
  let riskScore = 0;

  // 음수 PER/PBR 가드 — 적자기업·자본잠식 회사가 "낮은 값 = 저평가"로 잘못 분류되는
  // 결함을 방어한다. 음수일 때는 별도 reason으로 노출하고 감산 분기에 들어가지 않게 한다.
  if (v.per != null && v.per > 0) {
    if (v.per >= 150) {
      riskScore += 55;
      reasons.push(`PER ${v.per.toFixed(0)}배: 실적 기대가 크게 선반영`);
    } else if (v.per >= 80) {
      riskScore += 35;
      reasons.push(`PER ${v.per.toFixed(0)}배: 고평가 부담`);
    } else if (v.per >= 40) {
      riskScore += 20;
      reasons.push(`PER ${v.per.toFixed(0)}배: 다소 부담`);
    } else if (v.per <= 12) {
      riskScore -= 8;
      reasons.push(`PER ${v.per.toFixed(1)}배: 밸류 부담 낮음`);
    }
  } else if (v.per != null && v.per <= 0) {
    riskScore += 30;
    reasons.push("적자(PER 음수): 펀더 부담 매우 큼 — 컨센 PER 적용 불가");
  }

  if (v.forwardPer != null && v.forwardPer > 0) {
    if (v.forwardPer >= 60) {
      riskScore += 20;
      reasons.push(`추정PER ${v.forwardPer.toFixed(0)}배: 다음 실적 기준도 부담`);
    } else if (v.forwardPer <= 15 && (v.per == null || v.per < 40)) {
      riskScore -= 6;
      reasons.push(`추정PER ${v.forwardPer.toFixed(1)}배: 실적 개선 기대`);
    }
  } else if (v.forwardPer != null && v.forwardPer <= 0) {
    riskScore += 20;
    reasons.push("적자 컨센(추정PER 음수): 실적 개선 기대 데이터 없음");
  }

  if (v.pbr != null && v.pbr > 0) {
    if (v.pbr >= 5) {
      riskScore += 20;
      reasons.push(`PBR ${v.pbr.toFixed(1)}배: 자산가치 대비 부담`);
    } else if (v.pbr >= 3) {
      riskScore += 10;
      reasons.push(`PBR ${v.pbr.toFixed(1)}배: 다소 부담`);
    }
  } else if (v.pbr != null && v.pbr <= 0) {
    riskScore += 25;
    reasons.push("자본잠식(PBR 음수): 큰 위험");
  }

  riskScore = clamp(Math.round(riskScore), 0, 100);
  const label =
    riskScore >= 70
      ? "높음"
      : riskScore >= 45
        ? "주의"
        : riskScore >= 20
          ? "보통"
          : "낮음";

  return {
    per: v.per,
    forwardPer: v.forwardPer,
    pbr: v.pbr,
    riskScore,
    label,
    reasons: reasons.slice(0, 3),
  };
}

// ─── Predictor 본체 ────────────────────────────────────────

export interface PredictorInput {
  quote: Quote;
  history: HistoricalPoint[];
  // 시장 베타 시나리오용 (없으면 시나리오 생략)
  nasdaqHistory?: HistoricalPoint[] | null;
  fxHistory?: HistoricalPoint[] | null;
  // 기존 analyze() 결과에서 가져옴
  buyScore: number;
  heatScore: number;
  overseasNight?: OverseasNightIndicator | null;
  // 한국 종목 + 장중일 때만 채워지는 1분봉 기반 vol. intradayRange 정밀화에 사용.
  intradayDailyVol?: number | null;
}

export function predict(input: PredictorInput): Predictions {
  const {
    quote,
    history,
    nasdaqHistory,
    fxHistory,
    buyScore,
    heatScore,
    overseasNight,
    intradayDailyVol,
  } = input;

  const closes = history.map((h) => h.close).filter((c) => Number.isFinite(c) && c > 0);
  const returns = dailyReturns(history);
  const sigma = stddev(returns); // 일일 변동성

  const price = quote.price || closes[closes.length - 1] || 0;

  // A. 가격 범위 — 변동성 기반 (drift=0, 추세 가정 없음)
  //    이전엔 center = price·exp(mean(returns)·Δt) 였지만, 우상향 종목은
  //    drift>0 이라 중심값이 항상 위로 편향되어 사용자가 "예측이 다 +"라고
  //    오해하기 쉬웠다. 추세는 시나리오(C)·ATR 목표(B)에서 충분히 다루므로
  //    A는 순수 변동성 신뢰구간만 보여준다.
  //
  //    center = price (변동 없음 가정)
  //    band   = price · exp(±σ·√Δt)  → 68% 신뢰구간
  const ranges: PriceRange[] = [];
  if (price > 0 && returns.length >= 15) {
    const horizons: { label: string; days: number }[] = [
      { label: "1일", days: 1 },
      { label: "3일", days: 3 },
      { label: "1주", days: 5 },
      { label: "2주", days: 10 },
    ];
    for (const h of horizons) {
      const horizonSigma = sigma * Math.sqrt(h.days);
      const center = price;
      const low = center * Math.exp(-horizonSigma);
      const high = center * Math.exp(horizonSigma);
      ranges.push({
        horizonLabel: h.label,
        horizonDays: h.days,
        center,
        low,
        high,
        confidence: 0.68,
      });
    }
  }

  // B. 진입 / 손절 / 목표 (ATR 기반, 비대칭 multiplier)
  //    multiplier 비대칭화 — RR이 항상 ≈1로 고정되던 문제 해결.
  //      SL  = 1.5·ATR   (손절 폭 좁게)
  //      TP1 = 2.0·ATR   (1차 목표)
  //      TP2 = 3.5·ATR   (2차 목표)
  //    → RR1 ≈ 1.33, RR2 ≈ 2.33 으로 자연 차별화. 종목 변동성에 따라 절대 폭은 달라진다.
  //
  //    가드:
  //      - 손절: max(최근 20일 저점, 현재가 - 1.5·ATR), 다만 entry 이상이면 entry - 1.5·ATR로 강제(역추세 방어).
  //      - TP1 ≤ entry 가드 (이론상 ATR>0 이면 발생 불가하나 방어적).
  //      - TP2: min(저항, price + 3.5·ATR) 후 TP1보다 작거나 같으면 max(TP1 × 1.02, entry × 1.02)로 floor.
  //        (resistance가 entry 근처거나 TP1 미만일 때 TP2 < TP1 발생하던 SK하이닉스 케이스 방지.)
  const SL_ATR_MULT = 1.5;
  const TP1_ATR_MULT = 2.0;
  const TP2_ATR_MULT = 3.5;
  let targets: PriceTargets | null = null;
  if (history.length >= 20 && price > 0) {
    const recent20 = history.slice(-20);
    const support = Math.min(...recent20.map((p) => p.low));
    const resistance = Math.max(...recent20.map((p) => p.high));
    const atr = averageTrueRange(history, 14);
    if (atr > 0) {
      const entry = price;
      const rawStop = Math.max(support, price - SL_ATR_MULT * atr);
      const stopLoss = rawStop >= entry ? entry - SL_ATR_MULT * atr : rawStop;

      const rawTP1 = price + TP1_ATR_MULT * atr;
      const takeProfit1 = rawTP1 > entry ? rawTP1 : entry * 1.01;

      const rawTP2 = Math.min(resistance, price + TP2_ATR_MULT * atr);
      const tp2Floor = Math.max(takeProfit1 * 1.02, entry * 1.02);
      const takeProfit2 = rawTP2 > takeProfit1 ? rawTP2 : tp2Floor;

      // Risk-Reward — entry === stopLoss 면 분모 0이라 null로 노출.
      // 산식: (TP1 - entry) / (entry - SL).
      const riskReward =
        entry > stopLoss ? (takeProfit1 - entry) / (entry - stopLoss) : null;
      targets = {
        entry,
        stopLoss,
        takeProfit1,
        takeProfit2,
        support,
        resistance,
        riskReward,
      };
    }
  }

  // C. 시장 시나리오 (최근 60일 회귀 베타)
  //    한·미 휴장일이 다르므로 단순 tail join이 아니라 일자별 inner join으로 정렬한 후
  //    회귀를 계산해야 베타가 정확하다 (alignedDailyReturns).
  //    표본 수가 너무 작으면 베타가 불안정해지므로 30 이상 가드.
  const scenarios: ScenarioRow[] = [];
  const MIN_SCENARIO_SAMPLES = 30;

  if (nasdaqHistory && nasdaqHistory.length >= 30) {
    const aligned = alignedDailyReturns(history, nasdaqHistory);
    const sRet = aligned.stock.slice(-60);
    const nqRet = aligned.market.slice(-60);
    if (
      sRet.length >= MIN_SCENARIO_SAMPLES &&
      nqRet.length === sRet.length
    ) {
      const { beta, r2 } = regressionStats(sRet, nqRet);
      if (Math.abs(beta) > 0.05) {
        const confidence = confidenceFromR2(r2);
        scenarios.push({
          label: "나스닥 +1% 시",
          expected: beta * 0.01,
          beta,
          baselineLabel: "NQ=F 60일",
          r2,
          confidence,
        });
        scenarios.push({
          label: "나스닥 -1% 시",
          expected: -beta * 0.01,
          beta,
          baselineLabel: "NQ=F 60일",
          r2,
          confidence,
        });
      }
    }
  }

  if (fxHistory && fxHistory.length >= 30) {
    const aligned = alignedDailyReturns(history, fxHistory);
    const sRet = aligned.stock.slice(-60);
    const fxRet = aligned.market.slice(-60);
    if (
      sRet.length >= MIN_SCENARIO_SAMPLES &&
      fxRet.length === sRet.length
    ) {
      const { beta, r2 } = regressionStats(sRet, fxRet);
      if (Math.abs(beta) > 0.1) {
        scenarios.push({
          label: "환율 +1% (원화 약세) 시",
          expected: beta * 0.01,
          beta,
          baselineLabel: "KRW=X 60일",
          r2,
          confidence: confidenceFromR2(r2),
        });
      }
    }
  }

  // E. 신호 강도 — 기존 점수를 양방향 막대로 시각화하기 위해 재가공
  //   매수 강도: buyScore 그대로
  //   매도 강도: (100 - buyScore)와 heatScore의 가중 평균
  const buyStrength = clamp(buyScore);
  const sellStrength = clamp((100 - buyScore) * 0.4 + heatScore * 0.6);

  // F. 1일 진폭 예측 — 오늘(또는 다음 거래일)의 high/low 밴드.
  //   기본은 ATR(14)를 ±1배로 사용 (ATR 자체가 평균 진폭이라 1배 ≈ "평소만큼 흔들릴 때").
  //   ATR이 너무 작으면 GBM σ·√1 = sigma 로 폴백.
  //   장중 분봉 Parkinson 1일 vol(intradayDailyVol)이 살아 있으면 ATR 비율과 50:50 블렌드해
  //   오늘의 진폭 분위기를 더 잘 반영하도록 정밀화.
  let intradayRange: Predictions["intradayRange"] = null;
  if (price > 0) {
    const atr = history.length >= 15 ? averageTrueRange(history, 14) : 0;
    const atrPct = atr > 0 ? atr / price : 0;
    const sigmaPct = sigma > 0 ? sigma : 0;
    let basePct = atrPct > 0 ? atrPct : sigmaPct;
    let source: "atr" | "sigma" | "intraday-blend" = atrPct > 0 ? "atr" : "sigma";

    if (intradayDailyVol != null && intradayDailyVol > 0 && basePct > 0) {
      basePct = basePct * 0.5 + intradayDailyVol * 0.5;
      source = "intraday-blend";
    } else if (
      intradayDailyVol != null &&
      intradayDailyVol > 0 &&
      basePct === 0
    ) {
      basePct = intradayDailyVol;
      source = "intraday-blend";
    }

    if (basePct > 0) {
      const expectedHigh = price * (1 + basePct);
      const expectedLow = price * (1 - basePct);
      intradayRange = {
        expectedHigh,
        expectedLow,
        expectedRangePct: basePct,
        source,
      };
    }
  }

  return {
    ranges,
    targets,
    scenarios,
    valuation: valuationRisk(quote.valuation),
    nightSignal: overseasNight
      ? {
          label: overseasNight.name,
          expectedRate: overseasNight.changeRate,
          source: overseasNight.exchange,
          price: overseasNight.price,
          currency: overseasNight.currency,
          sharesPerReceipt: overseasNight.sharesPerReceipt,
          fxToKrw: overseasNight.fxToKrw,
          usdKrw: overseasNight.usdKrw,
          eurUsd: overseasNight.eurUsd,
          impliedKrwPrice: overseasNight.impliedKrwPrice,
          krxClose: overseasNight.krxClose,
          premiumRate: overseasNight.premiumRate,
          marketState: overseasNight.marketState,
          time: overseasNight.priceTime,
          fetchedAt: overseasNight.fetchedAt,
        }
      : null,
    strength: {
      buy: Math.round(buyStrength),
      sell: Math.round(sellStrength),
    },
    intradayRange,
  };
}
