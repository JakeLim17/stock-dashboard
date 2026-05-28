import "server-only";
import type { HistoricalPoint } from "../providers/yahoo";
import type {
  PriceRange,
  PriceTargets,
  Predictions,
  Quote,
  ScenarioRow,
  OverseasNightIndicator,
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
function regressionBeta(stockReturns: number[], marketReturns: number[]): number {
  const v = stddev(marketReturns) ** 2;
  if (v === 0) return 0;
  return covariance(stockReturns, marketReturns) / v;
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

  // B. 진입 / 손절 / 목표 (ATR 기반)
  //    - 진입: 현재가
  //    - 손절: max(최근 20일 저점, 현재가 - 2·ATR)
  //    - 목표1: 현재가 + 2·ATR
  //    - 목표2: min(최근 20일 고점, 현재가 + 4·ATR)
  let targets: PriceTargets | null = null;
  if (history.length >= 20 && price > 0) {
    const recent20 = history.slice(-20);
    const support = Math.min(...recent20.map((p) => p.low));
    const resistance = Math.max(...recent20.map((p) => p.high));
    const atr = averageTrueRange(history, 14);
    if (atr > 0) {
      const entry = price;
      const stopLoss = Math.max(support, price - 2 * atr);
      const takeProfit1 = price + 2 * atr;
      const takeProfit2 = Math.min(resistance, price + 4 * atr);
      const riskReward =
        entry > stopLoss ? (takeProfit1 - entry) / (entry - stopLoss) : 0;
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
  //    표본 수가 너무 작거나(한·미 영업일 차이로 30 미만일 수 있음),
  //    종목·시장 시리즈 길이가 크게 어긋나면 베타가 불안정해지므로 가드.
  //    NOTE: 현재 일자별 정렬은 하지 않고 단순 tail join 이라
  //    한국 휴장일·미국 휴장일이 다르면 베타가 약간 편향될 수 있다.
  //    근본 해결은 일자 join 필요(추후 과제).
  const scenarios: ScenarioRow[] = [];
  const MIN_SCENARIO_SAMPLES = 30;
  const stockRecent = returns.slice(-60);

  if (
    nasdaqHistory &&
    nasdaqHistory.length >= 30 &&
    stockRecent.length >= MIN_SCENARIO_SAMPLES
  ) {
    const nqRet = dailyReturns(nasdaqHistory).slice(-60);
    if (nqRet.length >= MIN_SCENARIO_SAMPLES) {
      const beta = regressionBeta(stockRecent, nqRet);
      if (Math.abs(beta) > 0.05) {
        scenarios.push({
          label: "나스닥 +1% 시",
          expected: beta * 0.01,
          beta,
          baselineLabel: "NQ=F 60일",
        });
        scenarios.push({
          label: "나스닥 -1% 시",
          expected: -beta * 0.01,
          beta,
          baselineLabel: "NQ=F 60일",
        });
      }
    }
  }

  if (
    fxHistory &&
    fxHistory.length >= 30 &&
    stockRecent.length >= MIN_SCENARIO_SAMPLES
  ) {
    const fxRet = dailyReturns(fxHistory).slice(-60);
    if (fxRet.length >= MIN_SCENARIO_SAMPLES) {
      const beta = regressionBeta(stockRecent, fxRet);
      if (Math.abs(beta) > 0.1) {
        scenarios.push({
          label: "환율 +1% (원화 약세) 시",
          expected: beta * 0.01,
          beta,
          baselineLabel: "KRW=X 60일",
        });
      }
    }
  }

  // E. 신호 강도 — 기존 점수를 양방향 막대로 시각화하기 위해 재가공
  //   매수 강도: buyScore 그대로
  //   매도 강도: (100 - buyScore)와 heatScore의 가중 평균
  const buyStrength = clamp(buyScore);
  const sellStrength = clamp((100 - buyScore) * 0.4 + heatScore * 0.6);

  return {
    ranges,
    targets,
    scenarios,
    nightSignal: overseasNight
      ? {
          label: overseasNight.name,
          expectedRate: overseasNight.changeRate,
          source: overseasNight.exchange,
          price: overseasNight.price,
          currency: overseasNight.currency,
          time: overseasNight.priceTime,
        }
      : null,
    strength: {
      buy: Math.round(buyStrength),
      sell: Math.round(sellStrength),
    },
  };
}
