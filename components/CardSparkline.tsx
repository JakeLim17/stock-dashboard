"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

// 종목 카드 미니 분봉 스파크라인 (인라인). 가격 숫자 우측에 가로로 길게 그린다.
//
//   - mount 시 화면에 보일 때만 /api/sparkline fetch (CDN 5분 캐시 + 클라 5분 폴링).
//   - 부모로부터 currentPrice 가 흐를 때 마지막 정규장 점만 in-place 업데이트 — 전체 fetch 안 함.
//   - 색상: 마지막 가격(=currentPrice 반영 후) vs 시가(openPrice) 비교.
//     상승 → var(--color-up) (한국식 빨강), 하락 → var(--color-down) (파랑), 보합 → 회색.
//   - 라인 아래 같은 색 그라데이션 영역(opacity 0.18 → 0) — Toss 스타일.
//   - 마지막 점에는 작은 dot. cx/cy 에 CSS transition 을 걸어 currentPrice 변동 시 부드럽게.
//   - 시간외 점(session="extended")은 stroke opacity 0.45 + dashed.
//   - 한국 종목은 X축 도메인 = 거래일 KST 08:00 ~ 20:00 (서버가 채워 내려줌).
//
// 성능 정책:
//   - IntersectionObserver — 화면 밖 카드는 fetch 안 함 (6종목 × 폴링 절감).
//   - CDN s-maxage 300s — 동일 종목 반복 호출은 엣지 히트.
//   - 폴링은 "탭 활성 + 화면 내"일 때만.

interface SparklinePoint {
  time: number;
  price: number;
  session: "regular" | "extended";
}

interface ApiResp {
  points: SparklinePoint[];
  openPrice: number | null;
  domain: { startMs: number; endMs: number } | null;
  marketType: "kr" | "us" | "other";
  error?: string;
}

interface Props {
  code: string;
  currentPrice?: number | null;
  height?: number;
  /** 폴링 주기. 기본 5분 — 분봉은 1분 단위, CDN 캐시와 맞춤. 0이면 최초 1회만. */
  pollMs?: number;
  /** 부모 width 결정용. flex-1 등 클래스 그대로 전달. */
  className?: string;
}

export function CardSparkline({
  code,
  currentPrice,
  height = 32,
  pollMs = 300_000,
  className,
}: Props) {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(160);
  // 같은 페이지 안에 카드 여러 장이 있어도 gradient id 가 충돌하지 않게 useId 로 unique 화.
  const gradId = `${useId().replace(/[:]/g, "")}-grad`;

  // ResizeObserver — 컨테이너 폭에 맞춰 SVG width 동기화. 카드 폭이 그리드에서 흔들려도 따라감.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(40, Math.round(e.contentRect.width));
        setWidth((prev) => (prev !== w ? w : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 화면에 들어올 때만 네트워크 — 스크롤 밖 카드는 sparkline API 호출 안 함.
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

  // 데이터 fetch + 폴링 (inView 일 때만).
  useEffect(() => {
    if (!inView) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const r = await fetch(`/api/sparkline?code=${encodeURIComponent(code)}`, {
          cache: "default",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as ApiResp;
        if (!cancelled) {
          setData(j);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    const start = () => {
      if (timer || pollMs <= 0) return;
      timer = setInterval(() => void load(), pollMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void load();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [code, pollMs, inView]);

  // 마지막 점 실시간 업데이트 — currentPrice 가 흐를 때 마지막 정규장 점을 덮는다.
  useEffect(() => {
    if (currentPrice == null || currentPrice <= 0) return;
    setData((prev) => {
      if (!prev || prev.points.length === 0) return prev;
      const points = prev.points.slice();
      const last = points[points.length - 1];
      // 정규장 진행 중일 때만 덮어쓰기. 시간외 마지막 점은 그대로 — 흐린 라인 의미 유지.
      if (last.session === "regular" && last.price !== currentPrice) {
        points[points.length - 1] = { ...last, price: currentPrice };
        return { ...prev, points };
      }
      return prev;
    });
  }, [currentPrice]);

  const view = useMemo(() => {
    if (!data || data.points.length < 2) return null;
    const pts = data.points;
    const prices = pts.map((p) => p.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;

    const xMin = data.domain?.startMs ?? pts[0].time;
    const xMax = data.domain?.endMs ?? pts[pts.length - 1].time;
    const xRange = Math.max(1, xMax - xMin);

    const xy = pts.map((p) => {
      const x = ((p.time - xMin) / xRange) * width;
      const y = height - 3 - ((p.price - minP) / range) * (height - 6);
      return { x, y, session: p.session };
    });

    let regular = "";
    for (const p of xy) {
      if (p.session !== "regular") continue;
      regular += `${regular ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
    let extended = "";
    for (const p of xy) {
      if (p.session !== "extended") continue;
      extended += `${extended ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }

    const regularXY = xy.filter((p) => p.session === "regular");
    let area = "";
    if (regularXY.length >= 2) {
      const first = regularXY[0];
      const last = regularXY[regularXY.length - 1];
      area = `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;
      for (let i = 1; i < regularXY.length; i++) {
        area += `L${regularXY[i].x.toFixed(1)},${regularXY[i].y.toFixed(1)}`;
      }
      area += `L${last.x.toFixed(1)},${height} L${first.x.toFixed(1)},${height} Z`;
    }

    // 색상: openPrice(시가) 기준 등락 → var(--color-up/down). 보합은 muted.
    // openPrice 가 없으면 첫 점 가격으로 폴백.
    const baseline =
      data.openPrice ?? (regularXY.length > 0 ? regularXY[0].y : prices[0]);
    const lastPrice = prices[prices.length - 1];
    const referenceForColor =
      data.openPrice ?? (regularXY.length > 0 ? prices[0] : prices[0]);
    const diff = lastPrice - referenceForColor;
    const color =
      diff > 0
        ? "var(--color-up)"
        : diff < 0
          ? "var(--color-down)"
          : "var(--color-muted-foreground)";

    const lastDot = xy[xy.length - 1];

    return {
      regular,
      extended,
      area,
      color,
      lastDot,
      baseline,
    };
  }, [data, width, height]);

  const showSvg = view !== null;
  // 로딩 + view 미생성(데이터 도착 전) 상태 — 사용자에게 "그래프 로딩 중" 시각 단서를 명시.
  // 주인님 규칙: "모든 창 로딩은 반드시 로딩중이라고 꼭 표시"
  // 작은 카드 sparkline 자리이라 텍스트는 과해서 회색 pulse 막대 + tiny "로딩" 라벨 조합.
  const showSkeleton = !showSvg;

  return (
    <div
      ref={containerRef}
      className={className ?? "w-full"}
      style={{ height }}
      aria-hidden
      title={showSkeleton ? "그래프 로딩 중…" : undefined}
    >
      {showSkeleton && (
        <div
          className="relative h-full w-full overflow-hidden rounded-sm bg-muted/40 animate-pulse"
          aria-label="그래프 로딩 중"
        >
          {/* 가운데 흐릿한 가로선 — Toss 카드 스파크라인 placeholder 와 비슷한 느낌 */}
          <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 h-px bg-muted-foreground/30" />
          {loading && (
            <span className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground/70 tabular">
              로딩…
            </span>
          )}
        </div>
      )}
      {showSvg && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={view.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={view.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {view.area && (
            <path d={view.area} fill={`url(#${gradId})`} stroke="none" />
          )}
          {view.regular && (
            <path
              d={view.regular}
              fill="none"
              stroke={view.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {view.extended && (
            <path
              d={view.extended}
              fill="none"
              stroke={view.color}
              strokeOpacity={0.45}
              strokeWidth={1.2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="2,2"
            />
          )}
          {view.lastDot && (
            <circle
              cx={view.lastDot.x}
              cy={view.lastDot.y}
              r={2.2}
              fill={view.color}
              style={{
                transition:
                  "cx 600ms cubic-bezier(0.22, 1, 0.36, 1), cy 600ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          )}
        </svg>
      )}
    </div>
  );
}
