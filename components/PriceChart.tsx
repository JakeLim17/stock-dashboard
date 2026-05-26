"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  AreaSeries,
} from "lightweight-charts";

type Range = "1w" | "1m" | "3m";

interface Point {
  date: number;
  close: number;
}

export function PriceChart({ code, name }: { code: string; name: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [range, setRange] = useState<Range>("1m");
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  // 차트 생성 (1회)
  useEffect(() => {
    if (!ref.current) return;
    const dark = document.documentElement.classList.contains("dark");
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: dark ? "#8a94a6" : "#5b6371",
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: dark ? "#1a1f2b" : "#eef0f3" },
        horzLines: { color: dark ? "#1a1f2b" : "#eef0f3" },
      },
      rightPriceScale: { borderColor: "transparent" },
      timeScale: { borderColor: "transparent", timeVisible: false },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#4d8dff",
      topColor: "rgba(77, 141, 255, 0.35)",
      bottomColor: "rgba(77, 141, 255, 0.0)",
      lineWidth: 2,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // 데이터 로드
  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setEmpty(false);
    fetch(`/api/history?code=${encodeURIComponent(code)}&range=${range}`)
      .then((r) => r.json())
      .then((j: { points: Point[] }) => {
        if (aborted || !seriesRef.current) return;
        const data = (j.points ?? []).map((p) => ({
          time: Math.floor(p.date / 1000) as unknown as import("lightweight-charts").UTCTimestamp,
          value: p.close,
        }));
        seriesRef.current.setData(data);
        chartRef.current?.timeScale().fitContent();
        setEmpty(data.length === 0);
      })
      .catch(() => setEmpty(true))
      .finally(() => !aborted && setLoading(false));
    return () => {
      aborted = true;
    };
  }, [code, range]);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">차트</div>
          <div className="text-sm font-medium">{name}</div>
        </div>
        <div className="flex gap-1">
          {(["1w", "1m", "3m"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                range === r
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {r === "1w" ? "1주" : r === "1m" ? "1개월" : "3개월"}
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-[280px]">
        <div ref={ref} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            로딩중…
          </div>
        )}
        {!loading && empty && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            데이터 없음
          </div>
        )}
      </div>
    </div>
  );
}
