/**
 * 실데이터 백테스트 — npm run backtest:fair-value
 * Yahoo 90일 히스토리로 가중치 튜닝 결과를 stdout 에 출력.
 */
import YahooFinance from "yahoo-finance2";
import type { HistoricalPoint } from "../lib/providers/yahoo";
import {
  backtestFairValue,
  backtestFairValueByTargetWeekday,
  optimizeFairValueWeights,
  optimizeCloseExtension,
  summarizeGapBias,
} from "../lib/fair-value-backtest";
import { FAIR_VALUE_WEIGHTS } from "../lib/fair-value";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

async function fetchHistorical(
  code: string,
  days: number
): Promise<HistoricalPoint[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000 * 1.5);
  const rows = await yahooFinance.historical(
    code,
    { period1: start, period2: end, interval: "1d" },
    { fetchOptions: { signal: AbortSignal.timeout(12_000) } }
  );
  return (rows ?? []).map((r) => ({
    date: r.date.getTime(),
    open: r.open ?? 0,
    high: r.high ?? 0,
    low: r.low ?? 0,
    close: r.close ?? 0,
    volume: r.volume ?? 0,
  }));
}

async function main() {
  const [stock, gdr, fx] = await Promise.all([
    fetchHistorical("005930.KS", 120),
    fetchHistorical("SMSN.IL", 120),
    fetchHistorical("KRW=X", 120),
  ]);

  if (stock.length < 40) {
    console.error("히스토리 부족", stock.length);
    process.exit(1);
  }

  const input = {
    stockHist: stock,
    gdrHist: gdr,
    usdKrwHist: fx,
    sharesPerReceipt: 25,
  };

  console.log("=== 현재 가중치 ===");
  console.log(JSON.stringify(FAIR_VALUE_WEIGHTS, null, 2));
  console.log("\n=== 시나리오별 성능 (현재) ===");
  for (const s of backtestFairValue(input)) {
    console.log(
      `${s.scenario}: n=${s.samples} MAPE=${(s.mape * 100).toFixed(2)}% MAE=${Math.round(s.mae).toLocaleString()} 방향=${(s.directionAccuracy * 100).toFixed(1)}%`
    );
  }

  console.log("\n=== 익일 요일별 방향 적중 (nightToNextOpen) ===");
  console.log(
    "요일 | n | 방향적중 | 하락예측비율 | MAPE"
  );
  for (const b of backtestFairValueByTargetWeekday(input, "nightToNextOpen")) {
    console.log(
      `${b.weekday} | ${b.samples} | ${(b.directionAccuracy * 100).toFixed(1)}% | ${(b.bearishRate * 100).toFixed(1)}% | ${(b.mape * 100).toFixed(2)}%`
    );
  }

  const gap = summarizeGapBias(input, "nightToNextOpen");
  console.log(
    `\n=== 금→월 vs 평일 (nightToNextOpen) ===\n` +
      `평일(월~목) 방향적중: ${(gap.weekdayDir * 100).toFixed(1)}%\n` +
      `금요일→월요일 방향적중: ${(gap.weekendDir * 100).toFixed(1)}%`
  );

  const opt = optimizeFairValueWeights(input, "nightToNextClose");
  console.log("\n=== nightToNextClose 최적 가중치 ===");
  console.log(JSON.stringify(opt.weights.nightClosed, null, 2));
  console.log(`MAPE=${(opt.mape * 100).toFixed(2)}%`);

  const optAfter = optimizeFairValueWeights(input, "nightToNextOpen");
  console.log("\n=== nightToNextOpen (익일 시가) 최적 ===");
  console.log(JSON.stringify(optAfter.weights.nightClosed, null, 2));
  console.log(`MAPE=${(optAfter.mape * 100).toFixed(2)}%`);

  const optCloseExt = optimizeCloseExtension(input, "nightToNextClose");
  console.log("\n=== nightToNextClose 종가 혼합 최적 ===");
  console.log(JSON.stringify(optCloseExt.extension, null, 2));
  console.log(`MAPE=${(optCloseExt.mape * 100).toFixed(2)}%`);

  const optAh = optimizeFairValueWeights(input, "ahCloseToNextOpen");
  console.log("\n=== ahCloseToNextOpen (앱장→익일시가) 최적 ===");
  console.log(JSON.stringify(optAh.weights.nightClosed, null, 2));
  console.log(`MAPE=${(optAh.mape * 100).toFixed(2)}%`);

  const optOpen = optimizeFairValueWeights(input, "openToClose");
  console.log("\n=== openToClose (당일 종가) 최적 ===");
  console.log(JSON.stringify(optOpen.weights.nightOpen, null, 2));
  console.log(`MAPE=${(optOpen.mape * 100).toFixed(2)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
