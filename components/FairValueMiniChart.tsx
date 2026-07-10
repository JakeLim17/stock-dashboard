"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PriceRange } from "@/lib/types";
import {
  buildFairValueDailySeries,
  type FairValueHorizonItem,
} from "@/lib/fair-value";
import { fmtNumber, fmtPercent } from "@/lib/utils";

// 가격 추정 미니 그래프 — "오늘/내일/다음주/1개월" 텍스트 카드를 대체하는 인터랙티브 SVG.
//
//   - 좌측: 최근 실제 종가(약 1개월, 실선) · 우측: 오늘~1개월 **매 거래일** 예측 곡선(점선)
//     + 4개 시계 앵커(오늘/내일/다음주/1개월)에는 마커 표시
//   - 일별 예측은 buildFairValueDailySeries 가 앵커 사이를 로그가격 보간·√t 밴드로 파생
//     (프론트 파생 계산 — API 응답·서버 비용 증가 없음)
//   - 드래그(스크럽): 포인터를 누른 채 움직이면 일별 점을 하나씩 따라가고,
//     손을 떼면(pointerup) 그 지점이 고정되어 아래 리드아웃에 날짜·가격이 남는다.
//     터치·마우스 모두 pointer events 로 처리 (touch-none 으로 스크롤 간섭 차단).
//   - 실제 가격은 /api/history?range=1m (CardSparkline 과 같은 in-view 지연 로드).

interface DailyPoint {
  date: number;
  close: number;
}

interface ChartPt {
  /** 거래일 인덱스 축 (실제 0..n-1, 예측 n-1+offset) */
  x: number;
  price: number;
  kind: "actual" | "pred";
  /** 리드아웃 날짜 라벨 — "6/30" 또는 "7/13(월)" */
  label: string;
  /** 4개 시계 앵커의 라벨 — "내일" 등 (일반 일별 점은 없음) */
  horizonLabel?: string;
  /** 내일(dual-leg)의 시가 추정 — 종가와 다를 때만 */
  openPrice?: number | null;
  /** 예측 변동성 밴드 (있을 때만) */
  low?: number | null;
  high?: number | null;
  /** 시계 앵커 여부 — 마커 표시용 */
  isAnchor?: boolean;
}

function fmtDayLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function FairValueMiniChart({
  code,
  currency,
  currentPrice,
  horizons,
  ranges,
  height = 92,
}: {
  code: string;
  currency: "KRW" | "USD";
  currentPrice: number;
  horizons: FairValueHorizonItem[];
  ranges?: PriceRange[] | null;
  height?: number;
}) {
  const decimals = currency === "USD" ? 2 : 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  const [inView, setInView] = useState(false);
  const [hist, setHist] = useState<DailyPoint[] | null>(null);
  const [histLoading, setHistLoading] = useState(true);
  // 선택 점 인덱스 (allPts 기준). null 이면 기본 점(내일 예측) 표시.
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const draggingRef = useRef(false);

  // 종목 전환 시 상태 초기화
  useEffect(() => {
    setHist(null);
    setHistLoading(true);
    setSelIdx(null);
  }, [code]);

  // 컨테이너 폭 추적
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(120, Math.round(e.contentRect.width));
        setWidth((prev) => (prev !== w ? w : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 화면에 들어올 때만 history fetch (카드가 많아도 네트워크 절약)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { rootMargin: "80px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || hist !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/history?code=${encodeURIComponent(code)}&range=1m`,
          { cache: "default" }
        );
        const j = (await r.json()) as { points?: DailyPoint[] };
        if (!cancelled) {
          setHist(
            (j.points ?? []).filter(
              (p) => Number.isFinite(p.close) && p.close > 0
            )
          );
        }
      } catch {
        if (!cancelled) setHist([]);
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inView, hist, code]);

  const model = useMemo(() => {
    // ── 실제 구간 ──
    const actualPts: ChartPt[] = (hist ?? []).map((p, i) => ({
      x: i,
      price: p.close,
      kind: "actual" as const,
      label: fmtDayLabel(p.date),
    }));
    // 히스토리가 없으면 현재가 1점으로 앵커 (예측 곡선만이라도 그린다)
    if (actualPts.length === 0 && currentPrice > 0) {
      actualPts.push({ x: 0, price: currentPrice, kind: "actual", label: "현재" });
    }
    if (actualPts.length === 0) return null;
    const anchor = actualPts[actualPts.length - 1];

    // ── 예측 구간 — 오늘~1개월 매 거래일 시리즈 ──
    const daily = buildFairValueDailySeries({
      code,
      horizons,
      ranges,
      basePrice: currentPrice > 0 ? currentPrice : anchor.price,
    });
    const predPts: ChartPt[] = daily
      // 가상 시작점(offset 0, 앵커 아님)은 현재가 복제라 스크럽·라인에서 제외
      .filter((p) => p.sessionOffset > 0 || p.horizonId != null)
      .map((p) => ({
        x: anchor.x + p.sessionOffset,
        price: p.price,
        kind: "pred" as const,
        label: p.label,
        horizonLabel: p.horizonLabel,
        openPrice: p.openPrice,
        low: p.low,
        high: p.high,
        isAnchor: p.horizonId != null,
      }));

    // ── 예측 밴드 — 일별 low~high 를 부드러운 폴리곤으로 ──
    const band: { x: number; low: number; high: number }[] = [];
    if (predPts.some((p) => p.low != null && p.high != null)) {
      band.push({ x: anchor.x, low: anchor.price, high: anchor.price });
      for (const p of daily) {
        if (p.sessionOffset <= 0 || p.low == null || p.high == null) continue;
        band.push({ x: anchor.x + p.sessionOffset, low: p.low, high: p.high });
      }
    }

    // ── 스케일 ──
    const xMax = Math.max(
      anchor.x,
      predPts.length > 0 ? predPts[predPts.length - 1].x : anchor.x
    );
    const prices = [
      ...actualPts.map((p) => p.price),
      ...predPts.map((p) => p.price),
      ...band.flatMap((b) => [b.low, b.high]),
      ...(currentPrice > 0 ? [currentPrice] : []),
    ];
    let minP = Math.min(...prices);
    let maxP = Math.max(...prices);
    const padP = (maxP - minP || maxP * 0.01 || 1) * 0.1;
    minP -= padP;
    maxP += padP;

    const padX = 4;
    const padY = 4;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const sx = (x: number) => padX + (xMax === 0 ? 0 : (x / xMax) * innerW);
    const sy = (p: number) =>
      padY + innerH - ((p - minP) / (maxP - minP)) * innerH;

    const linePath = (pts: ChartPt[]) =>
      pts
        .map(
          (p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.price).toFixed(1)}`
        )
        .join("");

    const actualPath = actualPts.length >= 2 ? linePath(actualPts) : "";
    // 예측 라인 — 앵커(마지막 실제 점)에서 시작, 같은 x(오늘)는 라인에서 제외
    const predLinePts = [anchor, ...predPts.filter((p) => p.x > anchor.x)];
    const predPath = predLinePts.length >= 2 ? linePath(predLinePts) : "";

    let bandPath = "";
    if (band.length >= 2) {
      bandPath =
        band
          .map(
            (b, i) =>
              `${i === 0 ? "M" : "L"}${sx(b.x).toFixed(1)},${sy(b.high).toFixed(1)}`
          )
          .join("") +
        [...band]
          .reverse()
          .map((b) => `L${sx(b.x).toFixed(1)},${sy(b.low).toFixed(1)}`)
          .join("") +
        "Z";
    }

    // 스크럽 대상 전체 점 (px 사전 계산)
    const allPts = [...actualPts, ...predPts].map((p) => ({
      ...p,
      px: sx(p.x),
      py: sy(p.price),
    }));

    // 기본 선택 — 내일 예측 > 첫 예측 > 마지막 실제
    let defaultIdx = allPts.length - 1;
    const tomorrowIdx = allPts.findIndex((p) => p.horizonLabel === "내일");
    if (tomorrowIdx >= 0) defaultIdx = tomorrowIdx;
    else {
      const firstPred = allPts.findIndex((p) => p.kind === "pred");
      if (firstPred >= 0) defaultIdx = firstPred;
    }

    return {
      allPts,
      actualPath,
      predPath,
      bandPath,
      anchor: { px: sx(anchor.x), py: sy(anchor.price) },
      currentY: currentPrice > 0 ? sy(currentPrice) : null,
      defaultIdx,
      hasPred: predPts.length > 0,
    };
  }, [hist, horizons, ranges, currentPrice, width, height, code]);

  // ── 스크럽 핸들러 ──
  const pickNearest = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!model || model.allPts.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < model.allPts.length; i++) {
      const d = Math.abs(model.allPts[i].px - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setSelIdx(best);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    pickNearest(e);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    pickNearest(e);
  };
  const onPointerUp = () => {
    // 손을 떼면 마지막 지점이 그대로 고정된다 (selIdx 유지)
    draggingRef.current = false;
  };

  const sel =
    model && model.allPts.length > 0
      ? model.allPts[
          selIdx != null && selIdx < model.allPts.length
            ? selIdx
            : model.defaultIdx
        ]
      : null;
  const selDelta =
    sel && currentPrice > 0 ? sel.price / currentPrice - 1 : null;

  return (
    <div ref={containerRef} className="w-full">
      <div className="relative" style={{ height }}>
        {!model && (
          <div className="absolute inset-0 grid place-items-center rounded-md bg-muted/40 animate-pulse text-[10px] text-muted-foreground">
            {histLoading ? "그래프 로딩 중…" : "데이터 없음"}
          </div>
        )}
        {model && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block touch-none select-none cursor-crosshair"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* 예측 변동성 밴드 */}
            {model.bandPath && (
              <path
                d={model.bandPath}
                fill="var(--color-accent)"
                opacity={0.09}
                stroke="none"
              />
            )}
            {/* 현재가 기준선 */}
            {model.currentY != null && (
              <line
                x1={0}
                x2={width}
                y1={model.currentY}
                y2={model.currentY}
                stroke="var(--color-muted-foreground)"
                strokeOpacity={0.35}
                strokeWidth={1}
                strokeDasharray="2,3"
              />
            )}
            {/* 실제 가격 (실선) */}
            {model.actualPath && (
              <path
                d={model.actualPath}
                fill="none"
                stroke="var(--color-foreground)"
                strokeOpacity={0.5}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {/* 예측 곡선 (점선) */}
            {model.predPath && (
              <path
                d={model.predPath}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={1.6}
                strokeDasharray="4,3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {/* 실제/예측 경계 앵커 점 */}
            <circle
              cx={model.anchor.px}
              cy={model.anchor.py}
              r={2.4}
              fill="var(--color-foreground)"
            />
            {/* 시계 앵커 마커 (오늘/내일/다음주/1개월) — 일별 점은 라인으로만 */}
            {model.allPts
              .filter((p) => p.kind === "pred" && p.isAnchor)
              .map((p) => (
                <circle
                  key={`${p.x}-${p.price}`}
                  cx={p.px}
                  cy={p.py}
                  r={2.6}
                  fill="var(--color-accent)"
                />
              ))}
            {/* 선택 크로스헤어 */}
            {sel && (
              <>
                <line
                  x1={sel.px}
                  x2={sel.px}
                  y1={2}
                  y2={height - 2}
                  stroke="var(--color-muted-foreground)"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
                <circle
                  cx={sel.px}
                  cy={sel.py}
                  r={4}
                  fill="none"
                  stroke={
                    sel.kind === "pred"
                      ? "var(--color-accent)"
                      : "var(--color-foreground)"
                  }
                  strokeWidth={1.5}
                />
              </>
            )}
          </svg>
        )}
      </div>

      {/* 선택 지점 리드아웃 — 드래그로 갱신, 손 떼면 고정 */}
      {sel && (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] tabular">
          <span className="min-w-0 truncate">
            <span
              className={`inline-block px-1 py-px mr-1 rounded text-[9px] font-medium ${
                sel.kind === "pred"
                  ? "bg-accent/15 text-accent"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {sel.kind === "pred" ? "예측" : "실제"}
            </span>
            <span className="text-muted-foreground">
              {sel.label}
              {sel.horizonLabel ? ` · ${sel.horizonLabel}` : ""}
            </span>
          </span>
          <span className="shrink-0 font-semibold">
            {fmtNumber(sel.price, decimals)}
            {selDelta != null && Math.abs(selDelta) >= 0.0005 && (
              <span className="ml-1 font-normal text-muted-foreground">
                ({fmtPercent(selDelta, 1)})
              </span>
            )}
          </span>
        </div>
      )}
      {sel?.kind === "pred" && sel.low != null && sel.high != null && (
        <div className="text-[10px] text-muted-foreground tabular text-right">
          범위 {fmtNumber(sel.low, decimals)} ~ {fmtNumber(sel.high, decimals)}
        </div>
      )}
      {sel?.openPrice != null && (
        <div className="text-[10px] text-muted-foreground tabular text-right">
          시가 추정 {fmtNumber(sel.openPrice, decimals)}
        </div>
      )}
      {model?.hasPred && (
        <div className="mt-1 text-[9px] text-muted-foreground/70">
          실선 실제 · 점선 예측 — 그래프를 드래그해 날짜별 가격 확인
        </div>
      )}
    </div>
  );
}
