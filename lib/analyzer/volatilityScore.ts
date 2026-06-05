import "server-only";
import type { HistoricalPoint } from "../providers/yahoo";
import type { FlowData, VolatilityAssessment, VolatilityDriver } from "../types";
import type { IntradayMetrics } from "./intradayMetrics";

// 사팔사팔(변동성) 점수 — 외인·기관·개인이 단시간에 사고팔며 가격이 위아래로
// 흔들리는 종목을 정량화한다. verdict shift는 하지 않고 (안전장치 유지),
// 배지·reasons에서만 표시.
//
// 입력
//   - history(일봉) : 최근 90일 OHLCV
//   - flow         : 외인/기관/개인 일별 누적 (네이버 한계상 분 단위 X)
//   - intraday     : 한국 종목 + 장중일 때만 채워짐 (B-3 가중)
//
// 점수 ─ 0~100 (가중 합산):
//   1. 수급 반전 빈도 — 외인 일별 순매수 부호 뒤집힘. (사용 가능한 데이터: 5일치 ×
//      foreignNet5d 만 있고 일별 raw가 노출되지 않으므로 일별 수급은 우회 — 대신
//      "당일 외인/기관 부호 차이" + "5일 누적 부호와 당일 부호 차이"로 근사한다.)
//   2. 회전율 폭증 — 오늘 거래량 / 20일 평균. 1.5배+ 가산.
//   3. 갭+장중 진폭 비율 — (오늘 high-low) / 어제 종가. 5%+ 가산.
//   4. 단기 σ vs 장기 σ — 최근 10일 daily return σ / 90일 σ. 1.3배+ 가산.
//   5. (한국 + 장중) 분봉 Parkinson vol — 1일 환산값이 큰 정도.
//   6. (한국 + 장중) 분봉 반전 빈도 — 0.5에 근접할수록 사팔사팔 직접 지표.
//
// 등급
//   stable    : 0~30   — 안정 (라벨 미노출)
//   moderate  : 30~60  — 보통 (회색)
//   high      : 60~80  — 고변동
//   gambling  : 80~100 — 도박장 (강한 warn)

export interface VolatilityInput {
  history: HistoricalPoint[];
  flow?: FlowData | null;
  todayChangeRate?: number;
  // 한국 종목 + 장중일 때만 들어온다. 그 외 undefined.
  intraday?: IntradayMetrics | null;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

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

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((acc, x) => acc + (x - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function levelOf(score: number): VolatilityAssessment["level"] {
  if (score >= 80) return "gambling";
  if (score >= 60) return "high";
  if (score >= 30) return "moderate";
  return "stable";
}

// driver 누적 헬퍼 — 절대 기여가 0이면 무시.
function pushDriver(
  drivers: VolatilityDriver[],
  label: string,
  contribution: number
) {
  const rounded = Math.round(contribution * 10) / 10;
  if (Math.abs(rounded) < 0.5) return;
  drivers.push({ label, contribution: rounded });
}

export function assessVolatility(input: VolatilityInput): VolatilityAssessment {
  const { history, flow, todayChangeRate, intraday } = input;
  const drivers: VolatilityDriver[] = [];
  let score = 0;

  // ── 1. 수급 부호 차이 (외인 vs 기관 + 5일 누적과 당일 부호 차이) ───────────
  // 일별 raw는 못 받지만, 외인·기관이 "서로 반대로" 강하게 들어오면 그 자체가
  // 사팔사팔의 단면이고, 5일 누적과 오늘 부호가 뒤집혔으면 단기 반전이라 본다.
  if (flow) {
    const f = flow.foreignNet ?? 0;
    const o = flow.institutionNet ?? 0;
    if (f !== 0 && o !== 0 && Math.sign(f) !== Math.sign(o)) {
      const mag = Math.min(Math.abs(f), Math.abs(o)) / 1e10; // 100억 단위
      if (mag >= 1) {
        const c = Math.min(8, mag * 2.5);
        score += c;
        pushDriver(drivers, "외인·기관 매매 방향 충돌", c);
      }
    }
    const f5 = flow.foreignNet5d ?? 0;
    if (f !== 0 && f5 !== 0 && Math.sign(f) !== Math.sign(f5)) {
      const mag = Math.min(Math.abs(f), Math.abs(f5) / 5) / 1e10;
      if (mag >= 0.5) {
        const c = Math.min(7, 3 + mag);
        score += c;
        pushDriver(drivers, "외인 5일 추세 vs 당일 부호 반전", c);
      }
    }
  }

  // ── 2. 회전율 폭증 — 오늘 거래량 / 20일 평균 ──────────────────────────────
  if (history.length >= 21) {
    const last = history[history.length - 1];
    const prev20 = history.slice(-21, -1);
    const avg20 =
      prev20.reduce((a, p) => a + (p.volume ?? 0), 0) / Math.max(1, prev20.length);
    if (avg20 > 0 && last.volume > 0) {
      const ratio = last.volume / avg20;
      if (ratio >= 3.0) {
        const c = 18;
        score += c;
        pushDriver(drivers, `거래량 ${ratio.toFixed(1)}배 폭증`, c);
      } else if (ratio >= 2.0) {
        const c = 12;
        score += c;
        pushDriver(drivers, `거래량 ${ratio.toFixed(1)}배 급증`, c);
      } else if (ratio >= 1.5) {
        const c = 7;
        score += c;
        pushDriver(drivers, `거래량 ${ratio.toFixed(1)}배 증가`, c);
      }
    }
  }

  // ── 3. 갭 + 장중 진폭 비율 — (high - low) / 어제 종가 ────────────────────
  if (history.length >= 2) {
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    if (prev.close > 0 && last.high > 0 && last.low > 0) {
      const range = (last.high - last.low) / prev.close;
      if (range >= 0.10) {
        const c = 20;
        score += c;
        pushDriver(drivers, `장중 진폭 ${(range * 100).toFixed(1)}% 매우 큼`, c);
      } else if (range >= 0.07) {
        const c = 14;
        score += c;
        pushDriver(drivers, `장중 진폭 ${(range * 100).toFixed(1)}% 큼`, c);
      } else if (range >= 0.05) {
        const c = 8;
        score += c;
        pushDriver(drivers, `장중 진폭 ${(range * 100).toFixed(1)}%`, c);
      } else if (range >= 0.03) {
        const c = 3;
        score += c;
        pushDriver(drivers, `장중 진폭 ${(range * 100).toFixed(1)}%`, c);
      }
    }
  }

  // 보너스: 오늘 등락률 자체가 ±5% 이상이면 가산 (갭이 본질적인 위험)
  if (todayChangeRate != null) {
    const abs = Math.abs(todayChangeRate);
    if (abs >= 0.10) {
      const c = 10;
      score += c;
      pushDriver(drivers, `당일 ±${(abs * 100).toFixed(1)}% 급변동`, c);
    } else if (abs >= 0.05) {
      const c = 5;
      score += c;
      pushDriver(drivers, `당일 ±${(abs * 100).toFixed(1)}%`, c);
    }
  }

  // ── 4. 단기 σ vs 장기 σ ─────────────────────────────────────────────────
  const allReturns = dailyReturns(history);
  if (allReturns.length >= 30) {
    const short = stddev(allReturns.slice(-10));
    const long = stddev(allReturns.slice(-90));
    if (long > 0) {
      const ratio = short / long;
      if (ratio >= 1.8) {
        const c = 15;
        score += c;
        pushDriver(drivers, `단기 변동성 평소 ${ratio.toFixed(1)}배`, c);
      } else if (ratio >= 1.5) {
        const c = 10;
        score += c;
        pushDriver(drivers, `단기 변동성 평소 ${ratio.toFixed(1)}배`, c);
      } else if (ratio >= 1.3) {
        const c = 6;
        score += c;
        pushDriver(drivers, `단기 변동성 ${ratio.toFixed(1)}배`, c);
      }
    }
  }

  // 보너스: 절대 일일 σ — 5% 이상이면 종목 자체가 변동성 큰 카테고리.
  if (allReturns.length >= 20) {
    const sigma = stddev(allReturns.slice(-20));
    if (sigma >= 0.06) {
      const c = 10;
      score += c;
      pushDriver(drivers, `일일 σ ${(sigma * 100).toFixed(1)}% 매우 큼`, c);
    } else if (sigma >= 0.04) {
      const c = 5;
      score += c;
      pushDriver(drivers, `일일 σ ${(sigma * 100).toFixed(1)}%`, c);
    }
  }

  // ── 5~6. 분봉 신호 (한국 + 장중일 때만 들어옴) ──────────────────────────
  let intradayUsed = false;
  if (intraday && intraday.barCount >= 30) {
    intradayUsed = true;
    // Parkinson 1일 환산이 큰 종목은 사팔사팔의 직접 증거.
    if (intraday.parkinsonDaily >= 0.05) {
      const c = 14;
      score += c;
      pushDriver(
        drivers,
        `장중 Parkinson σ ${(intraday.parkinsonDaily * 100).toFixed(1)}% 큼`,
        c
      );
    } else if (intraday.parkinsonDaily >= 0.03) {
      const c = 8;
      score += c;
      pushDriver(
        drivers,
        `장중 Parkinson σ ${(intraday.parkinsonDaily * 100).toFixed(1)}%`,
        c
      );
    } else if (intraday.parkinsonDaily >= 0.02) {
      const c = 4;
      score += c;
      pushDriver(
        drivers,
        `장중 Parkinson σ ${(intraday.parkinsonDaily * 100).toFixed(1)}%`,
        c
      );
    }

    // 분봉 반전 빈도 — 0.5 근처일수록 "사팔사팔" 직접 지표.
    // 0.5에서 멀수록(추세) 점수 낮게.
    const rev = intraday.reversalRate;
    if (rev >= 0.45 && rev <= 0.55) {
      const c = 12;
      score += c;
      pushDriver(drivers, `분봉 반전 ${(rev * 100).toFixed(0)}% — 사팔사팔 직접`, c);
    } else if (rev >= 0.4 && rev < 0.45) {
      const c = 7;
      score += c;
      pushDriver(drivers, `분봉 반전 ${(rev * 100).toFixed(0)}%`, c);
    } else if (rev > 0.55 && rev <= 0.6) {
      const c = 7;
      score += c;
      pushDriver(drivers, `분봉 반전 ${(rev * 100).toFixed(0)}%`, c);
    }
  }

  score = Math.round(clamp(score));
  drivers.sort((a, b) => b.contribution - a.contribution);

  return {
    score,
    level: levelOf(score),
    drivers: drivers.slice(0, 5),
    intradayUsed,
  };
}
