import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { HistoricalPoint } from "./providers/yahoo";
import {
  backtestFairValue,
  estimateAhClose,
  estimateDriftCenter,
  optimizeFairValueWeights,
  optimizeCloseExtension,
} from "./fair-value-backtest";
import { FAIR_VALUE_WEIGHTS } from "./fair-value";

function synthHistory(days: number, start = 100_000): HistoricalPoint[] {
  const out: HistoricalPoint[] = [];
  let price = start;
  const dayMs = 86_400_000;
  const base = Date.now() - days * dayMs;
  for (let i = 0; i < days; i++) {
    const drift = Math.sin(i / 7) * 0.008;
    const open = price;
    const close = Math.round(price * (1 + drift));
    const high = Math.max(open, close) * 1.005;
    const low = Math.min(open, close) * 0.995;
    out.push({
      date: base + i * dayMs,
      open,
      high,
      low,
      close,
      volume: 1_000_000,
    });
    price = close;
  }
  return out;
}

describe("fair-value-backtest", () => {
  it("estimateDriftCenter 는 최근 추세를 반영한다", () => {
    const hist = synthHistory(40);
    const center = estimateDriftCenter(hist, hist.at(-1)!.close);
    assert.ok(center > 0);
  });

  it("백테스트가 5개 시나리오 요약을 반환한다", () => {
    const stock = synthHistory(60);
    const gdr = stock.map((p) => ({
      ...p,
      close: p.close / 2500,
    }));
    const fx = stock.map((p) => ({ ...p, close: 1350 }));
    const summaries = backtestFairValue({
      stockHist: stock,
      gdrHist: gdr,
      usdKrwHist: fx,
      sharesPerReceipt: 25,
    });
    assert.equal(summaries.length, 5);
    for (const s of summaries) {
      assert.ok(s.samples > 0);
      assert.ok(s.mape >= 0);
      assert.ok(s.directionAccuracy >= 0 && s.directionAccuracy <= 1);
    }
  });

  it("앱장 종가 근사는 정규장 종가와 다를 수 있다", () => {
    const bar = synthHistory(1, 100_000)[0]!;
    bar.open = 99_000;
    bar.close = 101_000;
    const ah = estimateAhClose(bar);
    assert.ok(ah !== bar.close);
  });

  it("종가 혼합 비율 최적화가 동작한다", () => {
    const stock = synthHistory(90, 80_000);
    const gdr = stock.map((p, i) => ({
      ...p,
      close: p.close / 2500 + Math.sin(i / 5) * 2,
    }));
    const fx = stock.map((p) => ({ ...p, close: 1320 + (p.close % 1000) / 100 }));
    const input = {
      stockHist: stock,
      gdrHist: gdr,
      usdKrwHist: fx,
      sharesPerReceipt: 25,
    };
    const baseline = backtestFairValue({
      ...input,
      weights: FAIR_VALUE_WEIGHTS,
    }).find((s) => s.scenario === "nightToNextClose")!;
    const optimized = optimizeCloseExtension(input, "nightToNextClose");
    assert.ok(optimized.summary.samples > 0);
    assert.ok(optimized.mape <= baseline.mape + 0.001);
  });

  it("가중치 최적화가 baseline MAPE 이하 또는 동등", () => {
    const stock = synthHistory(90, 80_000);
    const gdr = stock.map((p, i) => ({
      ...p,
      close: p.close / 2500 + Math.sin(i / 5) * 2,
    }));
    const fx = stock.map((p) => ({ ...p, close: 1320 + (p.close % 1000) / 100 }));
    const input = {
      stockHist: stock,
      gdrHist: gdr,
      usdKrwHist: fx,
      sharesPerReceipt: 25,
    };
    const baseline = backtestFairValue({
      ...input,
      weights: FAIR_VALUE_WEIGHTS,
    }).find((s) => s.scenario === "nightToNextClose")!;
    const optimized = optimizeFairValueWeights(input, "nightToNextClose");
    assert.ok(optimized.summary.samples > 0);
    assert.ok(optimized.mape <= baseline.mape + 0.001);
  });
});
