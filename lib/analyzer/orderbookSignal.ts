import type { AskingPriceData } from "../types";
import type { ChronoPulseFactor } from "./chronoPulse";

/**
 * KIS 호가 → 약한 단기 알파 (스프레드·잔량 불균형·체결강도).
 * 키/데이터 없으면 빈 배열. lag-0 성격(당일만).
 */

export interface OrderbookSignal {
  spreadBps: number | null;
  imbalance: number | null; // -1~+1 (매수잔량 우위 = +)
  ccldStrength: number | null;
  factor: ChronoPulseFactor | null;
}

export function computeOrderbookSignal(
  asking: AskingPriceData | null | undefined
): OrderbookSignal {
  if (!asking?.levels?.length) {
    return {
      spreadBps: null,
      imbalance: null,
      ccldStrength: null,
      factor: null,
    };
  }

  const top = asking.levels[0];
  const ask = top?.askPrice ?? 0;
  const bid = top?.bidPrice ?? 0;
  const mid = ask > 0 && bid > 0 ? (ask + bid) / 2 : 0;
  const spreadBps =
    mid > 0 && ask >= bid ? Math.round(((ask - bid) / mid) * 10_000) : null;

  const total = asking.totalAskQty + asking.totalBidQty;
  const imbalance =
    total > 0
      ? (asking.totalBidQty - asking.totalAskQty) / total
      : null;

  const ccld = asking.ccldStrength;

  // 약한 시그널 — 절대값 cap ±18 bps
  let bps = 0;
  if (imbalance != null && Math.abs(imbalance) >= 0.12) {
    bps += Math.round(imbalance * 22);
  }
  if (ccld != null && Number.isFinite(ccld)) {
    if (ccld >= 130) bps += 10;
    else if (ccld >= 115) bps += 5;
    else if (ccld <= 70) bps -= 10;
    else if (ccld <= 85) bps -= 5;
  }
  // 스프레드 과다 = 유동성 악화 → 약한 하방
  if (spreadBps != null && spreadBps >= 25) {
    bps -= 4;
  }

  bps = Math.max(-18, Math.min(18, bps));
  if (Math.abs(bps) < 2) {
    return { spreadBps, imbalance, ccldStrength: ccld, factor: null };
  }

  const label =
    bps > 0 ? "호가 매수우위" : "호가 매도우위";

  return {
    spreadBps,
    imbalance,
    ccldStrength: ccld,
    factor: { id: "orderbook", label, bps },
  };
}
