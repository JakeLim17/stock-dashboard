import "server-only";
import type { HistoricalPoint } from "../providers/yahoo";
import type { SymbolMeta } from "../types";
import { estimateBeta, lastReturn } from "./macroBeta";

// 섹터 리딩 — 필라델피아 반도체(^SOX)의 ΔT-1 → 한국 반도체주 ΔT 의 지연 신호.
//
// 가설: 한국 반도체주(005930.KS, 000660.KS, 042700.KS, 009150.KS, 014680.KS, 357780.KQ 등)는
// 전일 미국 반도체 섹터 변동을 오늘 시초가에 부분 반영하는 경향이 있다.
// SOX 1% 변동에 약 0.4~0.8 정도의 한국 반도체주 lag-0 베타가 관측됨.
//
// 매크로 베타와의 차이: 매크로 베타는 동일 일자 회귀(R_s_t ~ R_m_t)이지만,
// 섹터 리딩은 lag 신호(R_s_t ~ R_m_{t-1}) 로 보고 1일 drift 보정에만 활용.
// drift 한도는 ±1.5% (안전 가드).

const SEMI_SECTORS = new Set([
  "반도체",
  "반도체장비",
  "반도체소재",
  "글로벌반도체",
]);

export interface SectorLeadingResult {
  drift: number; // 1일 drift 보정 (예: 0.005 = +0.5%)
  beta: number; // SOX 회귀 베타
  r2: number;
  soxLastReturn: number; // 가장 최근 SOX 수익률 (lag-0 신호)
  reason: string; // 사람이 읽는 사유
}

// 종목 sector 가 반도체 계열인지.
export function isSemiSector(meta: SymbolMeta | null | undefined): boolean {
  if (!meta?.sector) return false;
  return SEMI_SECTORS.has(meta.sector);
}

// SOX history 와 stock history 를 회귀해 lag-1 drift 추정.
// 단순화: 회귀 자체는 동일 일자(=같은 t) 베타이고, drift 보정은 SOX 의 가장 최근
// 수익률 × β 로 한다. 즉 "SOX 가 어제 +1.2% → 오늘 종목은 +β·1.2% 정도" 휴리스틱.
// 데이터 부족 / 비반도체 종목이면 drift=0 (no-op).
export function computeSectorLeading(
  meta: SymbolMeta | null | undefined,
  stockHist: HistoricalPoint[] | null | undefined,
  soxHist: HistoricalPoint[] | null | undefined
): SectorLeadingResult | null {
  if (!isSemiSector(meta)) return null;
  const reg = estimateBeta(stockHist, soxHist, 60, 30);
  if (!reg) return null;
  const last = lastReturn(soxHist);
  // β 너무 작거나 SOX 변동이 미미하면 drift 거의 0 → 보정 의미 없음.
  if (Math.abs(reg.beta) < 0.05 || Math.abs(last) < 0.001) {
    return {
      drift: 0,
      beta: reg.beta,
      r2: reg.r2,
      soxLastReturn: last,
      reason: "섹터 리딩 신호 미미 — 보정 없음",
    };
  }

  const raw = reg.beta * last;
  // 1.5% 드리프트 한도 — 단일 하루 매크로 신호로 ±1.5% 이상 보정은 위험.
  const drift = Math.max(-0.015, Math.min(0.015, raw));

  return {
    drift,
    beta: reg.beta,
    r2: reg.r2,
    soxLastReturn: last,
    reason: `SOX ${(last * 100).toFixed(2)}% × β ${reg.beta.toFixed(2)} (R² ${reg.r2.toFixed(2)}) → ${(drift * 100).toFixed(2)}%`,
  };
}
