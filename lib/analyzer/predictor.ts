import "server-only";
import type { HistoricalPoint } from "../providers/yahoo";
import type {
  EventItem,
  PriceRange,
  PriceTargets,
  Predictions,
  Quote,
  ScenarioRow,
  OverseasNightIndicator,
  ValuationMetrics,
  SymbolMeta,
} from "../types";
import { ewmaVolatility, tDistQuantile } from "./statHelpers";
import { computeEventInflation } from "./eventVolatility";
import { estimateBeta, lastReturn, type MacroBetaResult } from "./macroBeta";
import { computeVixGate } from "./vixGate";
import { computeSectorLeading } from "./sectorLeading";
import { computeMacroFactors } from "./macroFactors";

// 변동성 모델 상수 — Predictions.volatilityModel 메타로도 함께 노출되어
// UI hint 라벨("EWMA λ=0.94 · t(df=5) 95%")에 사용된다.
const EWMA_LAMBDA = 0.94; // RiskMetrics 표준
const T_DF = 5; // 일간 수익률의 fat-tail 반영 (df=5)
const T_TWO_SIDED_CONFIDENCE = 0.95; // 양측 95% 신뢰구간
const T_QUANTILE_975 = tDistQuantile(0.975, T_DF); // ≈ 2.571
const NORMAL_QUANTILE_975 = 1.96; // 정규분포 폴백용
// 이벤트 부풀림이 이 값 이하면 UI 노출 X — "거의 차이 없음"으로 간주.
const EVENT_INFLATION_DISPLAY_THRESHOLD = 1.05;

// ─── 기본 통계 유틸 ────────────────────────────────────────

// 일별 로그 수익률 r_t = ln(C_t / C_{t-1}).
//   - 단순 수익률 (C_t-C_{t-1})/C_{t-1} 보다 시간 합산 가법성·정규성 가정에 가까워
//     EWMA σ + GBM 가격 범위 (price·exp(±zσ√Δt)) 와 정합한다.
//   - 일중 평균 ~0% 수준에서는 두 정의의 차이가 미미하지만, 대형 단일 이벤트 (±10% 갭)
//     에서는 단순 수익률 σ 가 과대평가되는 경향이 있어 보수적으로 log returns 채택.
function dailyReturns(hist: HistoricalPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const prev = hist[i - 1].close;
    const cur = hist[i].close;
    if (
      prev > 0 &&
      cur > 0 &&
      Number.isFinite(prev) &&
      Number.isFinite(cur)
    ) {
      out.push(Math.log(cur / prev));
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

// ATR (Average True Range, 14일 기본) — Wilder smoothing.
//   Wilder 원전 (1978):
//     ATR_period  = mean(TR_1 .. TR_period)                  (warmup: 단순 평균)
//     ATR_t       = (ATR_{t-1} · (period-1) + TR_t) / period (t > period, 재귀 평활)
//   = EWMA(α = 1/period) 와 등가. TradingView·StockCharts·대부분 차트 패키지가 이 식.
//   이전엔 "최근 period개의 단순 평균(SMA-of-TR)" 이라 옛 데이터가 갑자기 떨어져 나가는
//   step 효과로 ATR 가 갑자기 튀는 경향이 있었음. Wilder 는 모든 과거 TR 가 지수
//   가중으로 살아 있어 추세 변동에 부드럽게 반응.
//   호출부(TP1/TP2/SL/intradayRange)는 인터페이스 동일 — 값만 살짝 바뀜(±10~20% 수준,
//   같은 종목 기준). 새 값이 TradingView ATR(14) 와 호환되는 점이 핵심.
function averageTrueRange(hist: HistoricalPoint[], period = 14): number {
  if (hist.length < 2 || period < 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const h = hist[i].high;
    const l = hist[i].low;
    const pc = hist[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  if (trs.length === 0) return 0;
  // 표본 부족 — period 미달이면 가능한 만큼 단순 평균(폴백). 기존 동작과 동일.
  if (trs.length < period) return mean(trs);

  // Warmup: 첫 period 개의 단순 평균.
  let atr = mean(trs.slice(0, period));
  // 이후 재귀 평활.
  const invPeriod = 1 / period;
  for (let i = period; i < trs.length; i++) {
    atr = atr * (1 - invPeriod) + trs[i] * invPeriod;
  }
  return atr;
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
      // 가중치 약화 (+20 → +10) — 동일 사실(forwardPer 부담)이 장기 rules.ts 의
      //   score 에서 -15 로 한 번 더 빠지기 때문에 UI 에서 "이중 노출" 이 됨.
      //   장기 결정에 직접 영향 주는 rules.ts 쪽을 유지하고, valuation riskScore 의
      //   가중치를 절반으로 낮춰 중복을 완화. (적자 음수 분기 +20 은 별도 사실이라 유지.)
      riskScore += 10;
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
  // ── Round3 B: 매크로 시계열 풀 (60일 OLS 회귀에 사용) ──
  //   ixicHistory : 나스닥 현물 ^IXIC
  //   kospiHistory: ^KS11
  //   soxHistory  : 필라델피아 반도체 (섹터 리딩)
  //   dxyHistory  : 달러 인덱스 DX-Y.NYB (또는 DX=F)
  //   us10yHistory: 미 10년물 ^TNX (현재는 lastReturn 만 활용 — 회귀 X)
  //   vix         : VIX 현재값 (게이팅용)
  //   us10y       : 미 10년물 현재값 (참고)
  ixicHistory?: HistoricalPoint[] | null;
  kospiHistory?: HistoricalPoint[] | null;
  soxHistory?: HistoricalPoint[] | null;
  dxyHistory?: HistoricalPoint[] | null;
  us10yHistory?: HistoricalPoint[] | null;
  vix?: number | null;
  us10y?: number | null;
  // ── 종목 메타(섹터·kind) — 매크로 팩터 분류에 필요 ──
  meta?: SymbolMeta | null;
  // 기존 analyze() 결과에서 가져옴
  buyScore: number;
  heatScore: number;
  overseasNight?: OverseasNightIndicator | null;
  // 한국 종목 + 장중일 때만 채워지는 1분봉 기반 vol. intradayRange 정밀화에 사용.
  intradayDailyVol?: number | null;
  // 임박 가격 이벤트 (실적·배당) + 매크로(FOMC·KOSPI 만기). 가장 임팩트 큰 이벤트의
  // proximity 기반 σ 부풀림 계수를 가격 범위 산정에 반영한다 (eventVolatility.ts).
  // 빈 배열·undefined 면 부풀림 없음(factor=1).
  events?: EventItem[] | null;
}

// 매크로 베타 회귀 결과를 한 번에 계산. 헬퍼는 표본 부족 시 null 반환.
function buildMacroBetas(
  history: HistoricalPoint[],
  ixicHistory?: HistoricalPoint[] | null,
  kospiHistory?: HistoricalPoint[] | null,
  soxHistory?: HistoricalPoint[] | null,
  dxyHistory?: HistoricalPoint[] | null
): {
  ixic: MacroBetaResult | null;
  kospi: MacroBetaResult | null;
  sox: MacroBetaResult | null;
  dxy: MacroBetaResult | null;
} {
  return {
    ixic: estimateBeta(history, ixicHistory),
    kospi: estimateBeta(history, kospiHistory),
    sox: estimateBeta(history, soxHistory),
    dxy: estimateBeta(history, dxyHistory),
  };
}

// 매크로 베타 결과의 가장 높은 R² — 모델 설명력 지표.
function maxR2(...rs: (MacroBetaResult | null)[]): number {
  let m = 0;
  for (const r of rs) if (r && r.r2 > m) m = r.r2;
  return m;
}

export function predict(input: PredictorInput): Predictions {
  const {
    quote,
    history,
    nasdaqHistory,
    fxHistory,
    ixicHistory,
    kospiHistory,
    soxHistory,
    dxyHistory,
    us10yHistory,
    vix,
    meta,
    buyScore,
    heatScore,
    overseasNight,
    intradayDailyVol,
    events,
  } = input;

  const closes = history.map((h) => h.close).filter((c) => Number.isFinite(c) && c > 0);
  const returns = dailyReturns(history);

  // ─ σ 모델 선택 ───────────────────────────────────────────
  // 30일 이상의 일간 수익률이 확보되면 EWMA(λ=0.94) σ + t(df=5) 분포 quantile 사용
  // (최근 변동성 가중 + fat-tail). 미달이면 단순 stddev + 정규분포(±1.96σ)로 폴백.
  const sigma =
    returns.length >= 30 ? ewmaVolatility(returns, EWMA_LAMBDA) : stddev(returns);
  const volKind: "ewma-t" | "stddev-normal" =
    returns.length >= 30 ? "ewma-t" : "stddev-normal";
  const tailMultiplier =
    volKind === "ewma-t" ? T_QUANTILE_975 : NORMAL_QUANTILE_975;

  // ─ 이벤트 부풀림 ─────────────────────────────────────────
  // events 에는 종목별 (실적·배당) + 매크로(FOMC·KOSPI 만기) 가 합쳐져 들어옴.
  // 가장 임팩트 큰 단일 이벤트의 factor만 적용 (eventVolatility.ts).
  const eventInflation = computeEventInflation(events, Date.now());
  const adjustedSigma = sigma * eventInflation.factor;

  const price = quote.price || closes[closes.length - 1] || 0;

  // ─ Round3 B: 매크로 베타 회귀 (60일 OLS) ────────────────────
  // 4개 매크로 변수 각각에 대해 β·R²·잔차표준편차를 추정. 표본 부족 시 null.
  const macroBetasRaw = buildMacroBetas(
    history,
    ixicHistory,
    kospiHistory,
    soxHistory,
    dxyHistory
  );

  // ─ US 종목 look-ahead 방어 ────────────────────────────────
  // 미국 종목은 종목 가격과 매크로(DXY/US10Y/SOX) 가 같은 미국 세션 close 라
  // 가장 최근 close 의 lastReturn 을 lag-0 drift 로 쓰면 "오늘 종목 데이터에는 없는
  // 같은 세션 매크로" 가 섞여 look-ahead bias 가 발생할 수 있다.
  // (한국 종목은 미국 매크로 ΔT-1 이 오늘 한국장의 lag-0 신호라 그대로 사용한다.)
  // 보수적으로 미국 종목일 때만 매크로 시계열을 한 칸 앞으로 슬라이스해
  // T-2 → T-1 close-to-close 변동만 lag-0 drift 입력으로 쓴다.
  const isUsStock = meta?.kind === "us-stock";
  const dxyHistForLag = isUsStock
    ? (dxyHistory ?? []).slice(0, -1)
    : dxyHistory;
  const us10yHistForLag = isUsStock
    ? (us10yHistory ?? []).slice(0, -1)
    : us10yHistory;
  const soxHistForLag = isUsStock
    ? (soxHistory ?? []).slice(0, -1)
    : soxHistory;

  // ─ Round3 B: 섹터 리딩 (SOX lag-1 → 한국 반도체주) ───────────
  // 한국 반도체 종목에만 적용. 데이터 부족·비반도체 종목은 null.
  // (US 반도체주의 경우 위 슬라이스로 SOX lastReturn 의 look-ahead 를 차단.)
  const sectorLeading = computeSectorLeading(meta, history, soxHistForLag);

  // ─ Round3 B: 매크로 팩터 (DXY/US10Y 휴리스틱) ────────────────
  // 종목 sector 기반 카테고리 분류 → DXY/US10Y 추정 베타 + lag-0 drift.
  const dxyLast = lastReturn(dxyHistForLag);
  const us10yLast = lastReturn(us10yHistForLag);
  const macroFactors = computeMacroFactors(meta, dxyLast, us10yLast);

  // 1일 drift 보정 — 섹터 리딩 + 매크로 팩터 합산 (한도 ±2%).
  const dailyDriftRaw = (sectorLeading?.drift ?? 0) + macroFactors.drift;
  const dailyDrift = Math.max(-0.02, Math.min(0.02, dailyDriftRaw));

  // A. 가격 범위 — 변동성 기반 (drift=0, 추세 가정 없음)
  //    이전엔 center = price·exp(mean(returns)·Δt) 였지만, 우상향 종목은
  //    drift>0 이라 중심값이 항상 위로 편향되어 사용자가 "예측이 다 +"라고
  //    오해하기 쉬웠다. 추세는 시나리오(C)·ATR 목표(B)에서 충분히 다루므로
  //    A는 순수 변동성 신뢰구간만 보여준다.
  //
  //    center = price (변동 없음 가정)
  //    band   = price · exp(±tMult · σ_adj · √Δt)  → 95% 양측 신뢰구간 (t df=5)
  //    σ_adj  = EWMA σ × 이벤트 부풀림 계수
  // Round3 B: 1일·3일 center 에만 매크로 drift 를 보수적으로 가산.
  // (1주·2주 horizon 은 단일 lag-0 신호의 영향이 희석되므로 적용 X.)
  const ranges: PriceRange[] = [];
  if (price > 0 && returns.length >= 15) {
    const horizons: { label: string; days: number; driftWeight: number }[] = [
      { label: "1일", days: 1, driftWeight: 1.0 },
      { label: "3일", days: 3, driftWeight: 0.6 },
      { label: "1주", days: 5, driftWeight: 0 },
      { label: "2주", days: 10, driftWeight: 0 },
    ];
    for (const h of horizons) {
      const horizonSigma = adjustedSigma * Math.sqrt(h.days) * tailMultiplier;
      const drift = dailyDrift * h.driftWeight;
      const center = price * Math.exp(drift);
      const low = center * Math.exp(-horizonSigma);
      const high = center * Math.exp(horizonSigma);
      ranges.push({
        horizonLabel: h.label,
        horizonDays: h.days,
        center,
        low,
        high,
        confidence: T_TWO_SIDED_CONFIDENCE,
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
  // Round3 B: VIX 게이팅 — risk-off 환경에서 SL 폭 자동 확대.
  const vixGate = computeVixGate(vix);
  const slMultEffective = SL_ATR_MULT * vixGate.stopLossMult;
  let targets: PriceTargets | null = null;
  if (history.length >= 20 && price > 0) {
    const recent20 = history.slice(-20);
    const support = Math.min(...recent20.map((p) => p.low));
    const resistance = Math.max(...recent20.map((p) => p.high));
    const atr = averageTrueRange(history, 14);
    if (atr > 0) {
      const entry = price;
      const rawStop = Math.max(support, price - slMultEffective * atr);
      const stopLoss = rawStop >= entry ? entry - slMultEffective * atr : rawStop;

      const rawTP1 = price + TP1_ATR_MULT * atr;
      const takeProfit1 = rawTP1 > entry ? rawTP1 : entry * 1.01;

      const atrTP2 = price + TP2_ATR_MULT * atr;
      const rawTP2 = Math.min(resistance, atrTP2);
      const tp2Floor = Math.max(takeProfit1 * 1.02, entry * 1.02);
      // floor 적용 분기 — UI 에서 "저항/ATR 으로는 의미 있는 2차 목표가 안 잡혀
      // 보수적 floor 사용" 안내가 가능하도록 출처를 명시.
      let takeProfit2: number;
      let takeProfit2Source: "atr" | "resistance" | "floor";
      if (rawTP2 > takeProfit1) {
        takeProfit2 = rawTP2;
        takeProfit2Source = atrTP2 <= resistance ? "atr" : "resistance";
      } else {
        takeProfit2 = tp2Floor;
        takeProfit2Source = "floor";
      }

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
        takeProfit2Source,
      };
    }
  }

  // C. 시장 시나리오 (최근 60일 회귀 베타)
  //    한·미 휴장일이 다르므로 단순 tail join이 아니라 일자별 inner join으로 정렬한 후
  //    회귀를 계산해야 베타가 정확하다 (alignedDailyReturns).
  //    표본 수가 너무 작으면 베타가 불안정해지므로 30 이상 가드.
  //    R² < 0.1 이면 회귀선이 사실상 무의미한 잡음이라 시나리오 자체를 노출하지 않는다.
  const scenarios: ScenarioRow[] = [];
  const MIN_SCENARIO_SAMPLES = 30;
  const MIN_SCENARIO_R2 = 0.1;

  if (nasdaqHistory && nasdaqHistory.length >= 30) {
    const aligned = alignedDailyReturns(history, nasdaqHistory);
    const sRet = aligned.stock.slice(-60);
    const nqRet = aligned.market.slice(-60);
    if (
      sRet.length >= MIN_SCENARIO_SAMPLES &&
      nqRet.length === sRet.length
    ) {
      const { beta, r2 } = regressionStats(sRet, nqRet);
      if (Math.abs(beta) > 0.05 && r2 >= MIN_SCENARIO_R2) {
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
      if (Math.abs(beta) > 0.1 && r2 >= MIN_SCENARIO_R2) {
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

  // Round3 B: 매크로 베타 회귀(buildMacroBetas) 결과를 시나리오로 변환.
  //   KOSPI / SOX 베타가 의미있게 크면 +1% 시나리오 row 로 노출.
  //   IXIC/DXY 회귀는 nasdaqHistory/fxHistory 시나리오와 중복될 수 있어 추가 안 함.
  //   R² < 0.1 이면 잡음 회귀라 시나리오 자체를 띄우지 않는다 (위 MIN_SCENARIO_R2 동일 정책).
  if (
    macroBetasRaw.kospi &&
    Math.abs(macroBetasRaw.kospi.beta) > 0.1 &&
    macroBetasRaw.kospi.r2 >= MIN_SCENARIO_R2
  ) {
    scenarios.push({
      label: "코스피 +1% 시",
      expected: macroBetasRaw.kospi.beta * 0.01,
      beta: macroBetasRaw.kospi.beta,
      baselineLabel: "^KS11 60일",
      r2: macroBetasRaw.kospi.r2,
      confidence: confidenceFromR2(macroBetasRaw.kospi.r2),
    });
  }
  if (
    macroBetasRaw.sox &&
    Math.abs(macroBetasRaw.sox.beta) > 0.15 &&
    macroBetasRaw.sox.r2 >= MIN_SCENARIO_R2
  ) {
    scenarios.push({
      label: "필반 +1% 시",
      expected: macroBetasRaw.sox.beta * 0.01,
      beta: macroBetasRaw.sox.beta,
      baselineLabel: "^SOX 60일",
      r2: macroBetasRaw.sox.r2,
      confidence: confidenceFromR2(macroBetasRaw.sox.r2),
    });
  }

  // Round3 B: 매크로 팩터(휴리스틱) 시나리오 — DXY/US10Y 추정 영향.
  //   회귀 베타가 아닌 카테고리 휴리스틱이라 confidence: "low" 로 표시.
  for (const s of macroFactors.scenarios) {
    if (Math.abs(s.expected) >= 0.0008) {
      scenarios.push(s);
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
    strength: {
      buy: Math.round(buyStrength),
      sell: Math.round(sellStrength),
    },
    intradayRange,
    volatilityModel: sigma > 0
      ? {
          kind: volKind,
          lambda: volKind === "ewma-t" ? EWMA_LAMBDA : undefined,
          df: volKind === "ewma-t" ? T_DF : undefined,
          confidence: T_TWO_SIDED_CONFIDENCE,
          dailySigma: sigma,
          adjustedDailySigma: adjustedSigma,
        }
      : null,
    eventVolatility:
      eventInflation.factor >= EVENT_INFLATION_DISPLAY_THRESHOLD &&
      eventInflation.event &&
      eventInflation.shortLabel != null &&
      eventInflation.daysToEvent != null
        ? {
            factor: eventInflation.factor,
            eventKind: eventInflation.event.kind,
            eventLabel: eventInflation.event.label,
            shortLabel: eventInflation.shortLabel,
            daysToEvent: eventInflation.daysToEvent,
          }
        : null,

    // Round3 B: 매크로 베타 회귀 결과 (표본 부족 시 키 누락) ───────────────
    macroBetas: pickMacroBetaSummary(macroBetasRaw),

    // Round3 B: 모델 신뢰도 — 휴리스틱 가중 평균 (R² × VIX × samplePenalty).
    //   ※ "베이지안 갱신" 이 아니라 단순 곱연산 휴리스틱이다 (이름 정정).
    //   score = clamp01(0.3 + 0.7 · R²_max  ×  vixConfidenceMult  ×  samplePenalty)
    //   label: 0.7+ high / 0.4~0.7 medium / <0.4 low
    modelConfidence: buildModelConfidence(macroBetasRaw, vixGate, returns.length),
  };
}

// 헬퍼: macroBetas 요약을 Predictions["macroBetas"] 형태로 변환.
function pickMacroBetaSummary(b: {
  ixic: MacroBetaResult | null;
  kospi: MacroBetaResult | null;
  sox: MacroBetaResult | null;
  dxy: MacroBetaResult | null;
}): NonNullable<Predictions["macroBetas"]> | null {
  const out: NonNullable<Predictions["macroBetas"]> = {};
  let anyKey = false;
  if (b.ixic) {
    out.ixic = {
      beta: b.ixic.beta,
      r2: b.ixic.r2,
      residStd: b.ixic.residStd,
      samples: b.ixic.samples,
    };
    anyKey = true;
  }
  if (b.kospi) {
    out.kospi = {
      beta: b.kospi.beta,
      r2: b.kospi.r2,
      residStd: b.kospi.residStd,
      samples: b.kospi.samples,
    };
    anyKey = true;
  }
  if (b.sox) {
    out.sox = {
      beta: b.sox.beta,
      r2: b.sox.r2,
      residStd: b.sox.residStd,
      samples: b.sox.samples,
    };
    anyKey = true;
  }
  if (b.dxy) {
    out.dxy = {
      beta: b.dxy.beta,
      r2: b.dxy.r2,
      residStd: b.dxy.residStd,
      samples: b.dxy.samples,
    };
    anyKey = true;
  }
  return anyKey ? out : null;
}

// 헬퍼: 모델 신뢰도 산출 — 휴리스틱 가중 평균 (베이지안 갱신 아님).
//   실제 산식: score = clamp01(  (0.3 + 0.7 · R²_max)  ×  vixGate.confidenceMult  ×  samplePenalty  )
//     · R²_max  : 매크로 회귀 IXIC/KOSPI/SOX/DXY 중 최대 R² (0~1)
//     · vixGate : VIX 구간별 곱연산 (calm 1.0 / elevated 0.9 / stressed 0.8 / panic 0.6)
//     · samplePenalty : 일별 수익률 표본 < 60 이면 0.95, 그 외 1.0
//   label: 0.7+ high / 0.4~0.7 medium / <0.4 low
function buildModelConfidence(
  b: {
    ixic: MacroBetaResult | null;
    kospi: MacroBetaResult | null;
    sox: MacroBetaResult | null;
    dxy: MacroBetaResult | null;
  },
  vixGate: ReturnType<typeof computeVixGate>,
  totalReturns: number
): NonNullable<Predictions["modelConfidence"]> {
  const r2max = maxR2(b.ixic, b.kospi, b.sox, b.dxy);
  // R² 0~1 → confidence 0.3~1.0 매핑 (기본 변동성 모델 신뢰는 살림)
  let base = 0.3 + 0.7 * r2max;
  const factors: string[] = [];
  if (r2max >= 0.6) factors.push(`최대 R² ${r2max.toFixed(2)} — 시장 연동 강함`);
  else if (r2max >= 0.3) factors.push(`최대 R² ${r2max.toFixed(2)} — 시장 연동 보통`);
  else factors.push(`최대 R² ${r2max.toFixed(2)} — 시장 연동 약함`);

  // VIX gate
  base *= vixGate.confidenceMult;
  if (vixGate.confidenceMult !== 1) factors.push(vixGate.reason);

  // 표본 수 패널티 — 60일 미달 시 0.95 곱 (회귀가 동작하는 조건이긴 함).
  if (totalReturns < 60) {
    base *= 0.95;
    factors.push(`표본 ${totalReturns}일 — 추정 불확실성`);
  }

  const score = Math.max(0, Math.min(1, base));
  const label: "high" | "medium" | "low" =
    score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low";

  return { score, label, factors };
}
