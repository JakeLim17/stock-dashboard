"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { PriceRange } from "@/lib/types";
import {
  buildFairValueDailySeries,
  dailyVolFromCloses,
  type FairValueHorizonItem,
  type PathFactor,
} from "@/lib/fair-value";
import {
  forecastAxisShift,
  isoDateInMarketTz,
  shortDayLabelInMarketTz,
} from "@/lib/fair-value-trading-day";
import { changeColor, fmtNumber, fmtPercent } from "@/lib/utils";

// 가격 추정 미니 그래프 — "오늘/내일/다음주/1개월" 텍스트 카드를 대체하는 인터랙티브 SVG.
//
//   - 좌측: 최근 실제 종가(약 1개월, 실선) · 우측: 오늘~1개월 **매 거래일** 예측 곡선(점선)
//     + 4개 시계 앵커(오늘/내일/다음주/1개월)에는 마커 표시
//   - 일별 예측은 buildFairValueDailySeries 가 요인 기반 일별 경로 + √t 밴드로 파생
//     (프론트 파생 계산 — API 응답·서버 비용 증가 없음)
//   - 스크럽: 값은 차트 **위** 고정 요약에 두고, 손가락은 차트 **아래** 얇은
//     슬라이더로 날짜만 고른다. 차트 위 드래그·데스크톱 호버도 같은 상단 라벨을 갱신.
//     터치·마우스 모두 pointer events (touch-none 으로 스크롤 간섭 차단).
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

/** 슬라이더 눈금 — 오늘·내일·다음 주만 (데이터가 있는 날짜). 1개월은 빼 둔다. */
const SLIDER_TICK_LABELS: Record<string, string> = {
  오늘: "오늘",
  내일: "내일",
  "다음 주": "다음 주",
  다음주: "다음 주",
};

function sliderTickLabel(horizonLabel?: string): string | null {
  if (!horizonLabel) return null;
  return SLIDER_TICK_LABELS[horizonLabel] ?? null;
}

/** key로 리마운트해 선택 날짜가 바뀔 때만 숫자가 짧게 깜빡이게 한다. */
function ReadoutNum({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return <span className={className}>{children}</span>;
}

// 로딩 스켈레톤 — 실제 차트 형태(좌 실선·우 점선 + 밴드)를 흉내낸 가짜 곡선이
// 반복해서 그려지고(stroke draw), 그 위로 은은한 shimmer 가 지나간다.
// prefers-reduced-motion 이면 애니메이션을 끄고 정적 곡선만 남긴다.
function ChartLoadingSkeleton({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  // 결정적(랜덤 X) 가짜 곡선 — 완만한 상승 + 물결
  const mid = height * 0.58;
  const n = 26;
  const splitIdx = Math.round(n * 0.55);
  const yAt = (i: number) =>
    mid + Math.sin(i * 0.85) * height * 0.13 - (i / n) * height * 0.2;
  const seg = (from: number, to: number) => {
    let d = "";
    for (let i = from; i <= to; i++) {
      const x = (i / n) * width;
      d += `${i === from ? "M" : "L"}${x.toFixed(1)},${yAt(i).toFixed(1)}`;
    }
    return d;
  };
  const actualPath = seg(0, splitIdx);
  const predPath = seg(splitIdx, n);
  // 예측 구간 가짜 밴드 (부채꼴)
  const bandTop: string[] = [];
  const bandBot: string[] = [];
  for (let i = splitIdx; i <= n; i++) {
    const x = (i / n) * width;
    const spread = ((i - splitIdx) / (n - splitIdx)) * height * 0.22;
    bandTop.push(`${i === splitIdx ? "M" : "L"}${x.toFixed(1)},${(yAt(i) - spread).toFixed(1)}`);
    bandBot.unshift(`L${x.toFixed(1)},${(yAt(i) + spread).toFixed(1)}`);
  }
  const bandPath = bandTop.join("") + bandBot.join("") + "Z";

  return (
    <div
      className="fv-chart-loading absolute inset-0 overflow-hidden rounded-md bg-muted/25"
      role="status"
      aria-label="그래프 준비 중"
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
        <path d={bandPath} fill="var(--color-accent)" opacity={0.06} />
        <path
          d={actualPath}
          fill="none"
          stroke="var(--color-foreground)"
          strokeOpacity={0.28}
          strokeWidth={1.5}
          strokeLinecap="round"
          pathLength={1}
          className="fv-draw"
        />
        <path
          d={predPath}
          fill="none"
          stroke="var(--color-accent)"
          strokeOpacity={0.45}
          strokeWidth={1.6}
          strokeDasharray="4,3"
          strokeLinecap="round"
          pathLength={1}
          className="fv-draw fv-draw-delay"
        />
      </svg>
      {/* shimmer sweep */}
      <div className="fv-shimmer absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-accent/10 to-transparent" />
      <div className="absolute bottom-1 right-2 text-[9px] text-muted-foreground/80">
        그래프 준비 중…
      </div>
      <style>{`
        .fv-chart-loading .fv-draw {
          stroke-dasharray: 1;
          stroke-dashoffset: 1;
          animation: fv-draw 2.2s ease-in-out infinite;
        }
        .fv-chart-loading .fv-draw-delay {
          animation-delay: 0.5s;
          /* dash 패턴 유지하면서 draw 하기 위해 dasharray 재정의 */
          stroke-dasharray: 0.04 0.03;
        }
        .fv-chart-loading .fv-shimmer {
          animation: fv-shimmer 1.8s linear infinite;
        }
        @keyframes fv-draw {
          0%   { stroke-dashoffset: 1; opacity: 0.4; }
          55%  { stroke-dashoffset: 0; opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 0.55; }
        }
        @keyframes fv-shimmer {
          0%   { transform: translateX(-130%); }
          100% { transform: translateX(430%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .fv-chart-loading .fv-draw,
          .fv-chart-loading .fv-shimmer { animation: none !important; }
          .fv-chart-loading .fv-draw { stroke-dashoffset: 0; }
          .fv-chart-loading .fv-shimmer { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export function FairValueMiniChart({
  code,
  currency,
  currentPrice,
  horizons,
  ranges,
  pathFactors,
  height = 92,
}: {
  code: string;
  currency: "KRW" | "USD";
  currentPrice: number;
  horizons: FairValueHorizonItem[];
  ranges?: PriceRange[] | null;
  pathFactors?: PathFactor[] | null;
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
  // 데스크톱 호버 미리보기 — 손을 떼면 고정 선택(selIdx)으로 돌아감
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const prevActiveIdxRef = useRef<number | null>(null);
  const [readoutFlashKey, setReadoutFlashKey] = useState(0);

  // 종목 전환 시 상태 초기화
  useEffect(() => {
    setHist(null);
    setHistLoading(true);
    setSelIdx(null);
    setHoverIdx(null);
    prevActiveIdxRef.current = null;
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
      label: shortDayLabelInMarketTz(code, p.date),
    }));
    // 히스토리가 없으면 현재가 1점으로 앵커 (예측 곡선만이라도 그린다)
    if (actualPts.length === 0 && currentPrice > 0) {
      actualPts.push({ x: 0, price: currentPrice, kind: "actual", label: "현재" });
    }
    if (actualPts.length === 0) return null;
    const anchor = actualPts[actualPts.length - 1];

    // ── 예측 구간 — 오늘~1개월 매 거래일 시리즈 ──
    // 최근 실현 vol·로그수익률 shape 로 종목별 경로 생성
    const closes = actualPts.map((p) => p.price);
    const realizedVol = dailyVolFromCloses(closes);
    const recentLogReturns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const a = closes[i - 1]!;
      const b = closes[i]!;
      if (a > 0 && b > 0) recentLogReturns.push(Math.log(b / a));
    }
    const daily = buildFairValueDailySeries({
      code,
      horizons,
      ranges,
      basePrice: currentPrice > 0 ? currentPrice : anchor.price,
      pathFactors,
      realizedVol,
      recentLogReturns,
    });
    const lastActualIso =
      hist && hist.length > 0
        ? isoDateInMarketTz(code, hist[hist.length - 1]!.date)
        : null;
    const axisShift = forecastAxisShift(lastActualIso, daily[0]?.isoDate);
    const predX = (sessionOffset: number) =>
      anchor.x + sessionOffset + axisShift;
    const predPts: ChartPt[] = daily
      // 가상 시작점(offset 0, 오늘도 앵커·라벨 없음)은 현재가 복제라 제외
      .filter(
        (p) =>
          p.sessionOffset > 0 ||
          p.horizonId != null ||
          p.horizonLabel === "오늘"
      )
      .map((p) => ({
        x: predX(p.sessionOffset),
        price: p.price,
        kind: "pred" as const,
        label: p.label,
        horizonLabel: p.horizonLabel,
        openPrice: p.openPrice,
        low: p.low,
        high: p.high,
        isAnchor: p.horizonId != null || p.horizonLabel === "오늘",
      }));

    // ── 예측 밴드 — 일별 low~high 를 부드러운 폴리곤으로 ──
    const band: { x: number; low: number; high: number }[] = [];
    if (predPts.some((p) => p.low != null && p.high != null)) {
      band.push({ x: anchor.x, low: anchor.price, high: anchor.price });
      for (const p of daily) {
        if (p.low == null || p.high == null) continue;
        if (p.sessionOffset <= 0 && axisShift === 0) continue;
        band.push({ x: predX(p.sessionOffset), low: p.low, high: p.high });
      }
    }

    // ── 스케일 ──
    // 핵심: 밴드 extreme을 domain에 풀로 넣으면 (±8~16%) 예측 center(±1~4%)가
    // 픽셀 2~5px로 깔려 "죽은 점선"이 됨 → center(실제+예측) 기준 + 밴드는 약하게만.
    const xMax = Math.max(
      anchor.x,
      predPts.length > 0 ? predPts[predPts.length - 1].x : anchor.x
    );
    const softBandPull = (
      cMin: number,
      cMax: number
    ): { minP: number; maxP: number } => {
      if (band.length === 0) return { minP: cMin, maxP: cMax };
      const bMin = Math.min(...band.map((b) => b.low));
      const bMax = Math.max(...band.map((b) => b.high));
      // 변동 큰 종목(SK스퀘어 등) 밴드·path 가 viewBox 밖으로 잘리지 않게
      const BAND_PULL = 0.42;
      return {
        minP: cMin - BAND_PULL * Math.max(0, cMin - bMin),
        maxP: cMax + BAND_PULL * Math.max(0, bMax - cMax),
      };
    };

    let centerMin = Math.min(
      ...actualPts.map((p) => p.price),
      ...predPts.map((p) => p.price),
      ...(currentPrice > 0 ? [currentPrice] : [])
    );
    let centerMax = Math.max(
      ...actualPts.map((p) => p.price),
      ...predPts.map((p) => p.price),
      ...(currentPrice > 0 ? [currentPrice] : [])
    );

    // 예측(+최근 실적) span이 전체의 24% 미만이면 domain을 그 창으로 조여
    // 과거 극단이 축을 잡아먹어 점선이 직선처럼 보이는 것을 막음
    const predOnly = [anchor.price, ...predPts.map((p) => p.price)];
    const predSpan = Math.max(...predOnly) - Math.min(...predOnly);
    const fullSpan = centerMax - centerMin;
    const MIN_PRED_SHARE = 0.24;
    if (predSpan > 0 && fullSpan > 0 && predSpan / fullSpan < MIN_PRED_SHARE) {
      const recentN = Math.max(8, Math.floor(actualPts.length * 0.4));
      const focus = [
        ...actualPts.slice(-recentN).map((p) => p.price),
        ...predOnly,
      ];
      let fMin = Math.min(...focus);
      let fMax = Math.max(...focus);
      const need = Math.max(fMax - fMin, predSpan / MIN_PRED_SHARE);
      if (fMax - fMin < need) {
        const mid = (fMin + fMax) / 2;
        fMin = mid - need / 2;
        fMax = mid + need / 2;
      }
      centerMin = fMin;
      centerMax = fMax;
    }

    let { minP, maxP } = softBandPull(centerMin, centerMax);
    const padP = (maxP - minP || maxP * 0.01 || 1) * 0.14;
    minP -= padP;
    maxP += padP;

    const padX = 4;
    // 마커·스트로크·밴드가 하단에서 잘리지 않게 Y 패딩 확보
    const padY = 10;
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
  }, [hist, horizons, ranges, pathFactors, currentPrice, width, height, code]);

  // ── 스크럽 핸들러 ──
  const nearestIdx = (px: number): number | null => {
    if (!model || model.allPts.length === 0) return null;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < model.allPts.length; i++) {
      const d = Math.abs(model.allPts[i].px - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };

  const idxFromEvent = (e: ReactPointerEvent<Element>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    return nearestIdx(e.clientX - rect.left);
  };

  const pinIdx = (idx: number | null) => {
    if (idx == null) return;
    setHoverIdx(null);
    setSelIdx(idx);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    // 터치는 아래 슬라이더만 — 손가락이 숫자를 가리지 않게.
    if (e.pointerType === "touch") return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    pinIdx(idxFromEvent(e));
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const idx = idxFromEvent(e);
    if (draggingRef.current) {
      pinIdx(idx);
      return;
    }
    // 데스크톱 호버 — 상단 고정 라벨만 미리보기 (핀은 클릭·슬라이더)
    if (e.pointerType === "mouse") setHoverIdx(idx);
  };
  const onPointerUp = () => {
    draggingRef.current = false;
  };
  const onPointerLeave = () => {
    if (!draggingRef.current) setHoverIdx(null);
  };

  const activeIdx =
    model && model.allPts.length > 0
      ? hoverIdx != null && hoverIdx < model.allPts.length
        ? hoverIdx
        : selIdx != null && selIdx < model.allPts.length
          ? selIdx
          : model.defaultIdx
      : 0;
  const sel =
    model && model.allPts.length > 0 ? model.allPts[activeIdx] : null;
  const selDelta =
    sel && currentPrice > 0 ? sel.price / currentPrice - 1 : null;
  const predDeltaClass =
    sel?.kind === "pred"
      ? selDelta == null || Math.abs(selDelta) < 0.0005
        ? "text-muted-foreground"
        : changeColor(selDelta)
      : "";
  const sliderMax = model ? Math.max(0, model.allPts.length - 1) : 0;
  const sliderTicks = useMemo(() => {
    if (!model || sliderMax <= 0) return [];
    const seen = new Set<string>();
    const ticks: { idx: number; label: string; pct: number }[] = [];
    for (let i = 0; i < model.allPts.length; i++) {
      const label = sliderTickLabel(model.allPts[i].horizonLabel);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      ticks.push({ idx: i, label, pct: (i / sliderMax) * 100 });
    }
    return ticks;
  }, [model, sliderMax]);

  useEffect(() => {
    if (!model) return;
    const committed =
      selIdx != null && selIdx < model.allPts.length ? selIdx : model.defaultIdx;
    const prev = prevActiveIdxRef.current;
    if (prev != null && prev !== committed) {
      setReadoutFlashKey((k) => k + 1);
    }
    prevActiveIdxRef.current = committed;
  }, [selIdx, model]);

  return (
    <div ref={containerRef} className="w-full">
      {/* 고정 요약 — 손가락·커서가 가리지 않게 차트 위에 둠 */}
      {!histLoading && sel && (
        <div className="mb-1 min-h-[1.75rem]">
          <div className="flex items-baseline justify-between gap-2 text-[11px] tabular">
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
            <ReadoutNum
              key={readoutFlashKey}
              className={`shrink-0 font-bold tabular leading-none ${
                sel.kind === "pred"
                  ? `text-lg ${predDeltaClass}`
                  : "text-sm font-semibold text-foreground"
              }${readoutFlashKey > 0 ? " fv-readout-flash" : ""}`}
            >
              {fmtNumber(sel.price, decimals)}
              {selDelta != null && Math.abs(selDelta) >= 0.0005 && (
                <span
                  className={`ml-1.5 font-medium ${
                    sel.kind === "pred"
                      ? `text-sm ${predDeltaClass}`
                      : "text-[11px] font-normal text-muted-foreground"
                  }`}
                >
                  ({fmtPercent(selDelta, 1)})
                </span>
              )}
            </ReadoutNum>
          </div>
          {sel.kind === "pred" && sel.low != null && sel.high != null && (
            <div className="text-[10px] text-muted-foreground tabular text-right">
              범위 {fmtNumber(sel.low, decimals)} ~ {fmtNumber(sel.high, decimals)}
            </div>
          )}
          {sel.openPrice != null && (
            <div className="text-[10px] text-muted-foreground tabular text-right">
              시가 추정 {fmtNumber(sel.openPrice, decimals)}
            </div>
          )}
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-md"
        style={{ height }}
      >
        {histLoading && <ChartLoadingSkeleton width={width} height={height} />}
        {!histLoading && !model && (
          <div className="absolute inset-0 grid place-items-center rounded-md bg-muted/40 text-[10px] text-muted-foreground">
            가격 데이터를 불러오지 못했어요
          </div>
        )}
        {!histLoading && model && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block select-none cursor-crosshair overflow-visible"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            role="img"
            aria-label="실제·예측 가격 그래프. 아래 막대로 날짜를 고르거나, 마우스로 그래프를 가리켜 보세요"
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

      {!histLoading && model && model.allPts.length > 1 && (
        <div className="mt-1 px-0.5">
          <input
            type="range"
            className="fv-scrub w-full"
            min={0}
            max={sliderMax}
            step={1}
            value={activeIdx}
            aria-label="날짜 선택"
            aria-valuetext={
              sel
                ? `${sel.kind === "pred" ? "예측" : "실제"} ${sel.label}${
                    sel.horizonLabel ? ` ${sel.horizonLabel}` : ""
                  } ${fmtNumber(sel.price, decimals)}`
                : undefined
            }
            onChange={(e) => pinIdx(Number(e.target.value))}
          />
          {sliderTicks.length > 0 && (
            <div className="relative h-3.5 mt-0.5" aria-hidden="true">
              {sliderTicks.map((t) => (
                <span
                  key={`${t.label}-${t.idx}`}
                  className="absolute top-0 text-[9px] leading-none text-muted-foreground whitespace-nowrap"
                  style={{
                    left: `${t.pct}%`,
                    transform: "translateX(-50%)",
                  }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {!histLoading && model?.hasPred && (
        <div className="mt-0.5 text-[9px] text-muted-foreground/70">
          실선 실제 · 점선 예측 — 아래 막대를 밀어 날짜를 고르세요 (마우스는 그래프 위도 가능)
        </div>
      )}
      <style>{`
        .fv-scrub {
          -webkit-appearance: none;
          appearance: none;
          height: 28px;
          background: transparent;
          cursor: pointer;
          touch-action: none;
          margin: 0;
        }
        .fv-scrub:focus-visible {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
          border-radius: 6px;
        }
        .fv-scrub::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 999px;
          background: color-mix(in oklab, var(--color-muted-foreground) 40%, transparent);
        }
        .fv-scrub::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          margin-top: -5px;
          border-radius: 999px;
          background: var(--color-accent);
          border: 2px solid var(--color-background);
          box-shadow: 0 0 0 1px color-mix(in oklab, var(--color-accent) 50%, transparent);
        }
        .fv-scrub::-moz-range-track {
          height: 6px;
          border-radius: 999px;
          background: color-mix(in oklab, var(--color-muted-foreground) 40%, transparent);
        }
        .fv-scrub::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: var(--color-accent);
          border: 2px solid var(--color-background);
          box-shadow: 0 0 0 1px color-mix(in oklab, var(--color-accent) 50%, transparent);
        }
        .fv-readout-flash {
          animation: fv-readout-flash 0.22s ease-out;
        }
        @keyframes fv-readout-flash {
          0%   { opacity: 0.28; }
          100% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .fv-readout-flash { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
