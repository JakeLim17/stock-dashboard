"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getOverseasNightProxy } from "@/lib/symbols";
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  AreaSeries,
} from "lightweight-charts";

// 차트 모드:
//   daily : 1D 라인/에어리어. KIS는 현재가에만 쓰고 차트는 가볍게 유지한다.
type Timeframe = "1D";
type ChartMode = "domestic" | "overseas";

interface DailyPoint {
  date: number;
  close: number;
}

const TF_LABEL: Record<Timeframe, string> = {
  "1D": "1일",
};

// 부모는 polling 주기로 selectedSnap 을 새로 받아 currentPrice 도 자동 흐른다.
// KIS 현재가는 카드/예측에 표시하고, 차트 마지막 일봉 점만 가볍게 따라간다.
interface Props {
  code: string;
  name: string;
  currentPrice?: number | null;
}

export function PriceChart({ code, name, currentPrice }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lastDailyTimeRef = useRef<UTCTimestamp | null>(null);

  const [mode, setMode] = useState<ChartMode>("domestic");
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overseasProxy = useMemo(() => getOverseasNightProxy(code), [code]);
  const activeCode =
    mode === "overseas" && overseasProxy ? overseasProxy.proxyCode : code;
  const activeName =
    mode === "overseas" && overseasProxy ? overseasProxy.name : name;
  useEffect(() => {
    if (!overseasProxy && mode === "overseas") setMode("domestic");
  }, [mode, overseasProxy]);

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
        vertLines: { color: dark ? "#202637" : "#e7ebf0" },
        horzLines: { color: dark ? "#202637" : "#e7ebf0" },
      },
      rightPriceScale: { borderColor: dark ? "#273042" : "#d9dee7" },
      timeScale: {
        borderColor: dark ? "#273042" : "#d9dee7",
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 10,
        minBarSpacing: 6,
      },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // 데이터 로드 — activeCode 변경 시. 현재가는 상위 스냅샷에서 실시간 반영된다.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let aborted = false;

    setLoading(true);
    setEmpty(false);
    setError(null);

    const ensureSeries = () => {
      if (seriesRef.current) {
        return seriesRef.current;
      }
      const next = chart.addSeries(AreaSeries, {
        lineColor: "#4d8dff",
        topColor: "rgba(77, 141, 255, 0.35)",
        bottomColor: "rgba(77, 141, 255, 0.0)",
        lineWidth: 2,
      });
      seriesRef.current = next;
      return next;
    };

    const loadDaily = async () => {
      const r = await fetch(
        `/api/history?code=${encodeURIComponent(activeCode)}&range=3m`,
        { cache: "no-store" }
      );
      const j = (await r.json()) as { points?: DailyPoint[]; error?: string };
      if (aborted) return;
      if (j.error) {
        setError(j.error);
        setEmpty(true);
        return;
      }
      const series = ensureSeries();
      const data = (j.points ?? []).map((p) => ({
        time: Math.floor(p.date / 1000) as UTCTimestamp,
        value: p.close,
      }));
      series.setData(data);
      lastDailyTimeRef.current = data[data.length - 1]?.time ?? null;
      chart.timeScale().fitContent();
      setEmpty(data.length === 0);
    };

    const runOnce = async () => {
      try {
        await loadDaily();
      } catch (e) {
        if (!aborted) {
          setError(e instanceof Error ? e.message : String(e));
          setEmpty(true);
        }
      } finally {
        if (!aborted) setLoading(false);
      }
    };

    void runOnce();

    return () => {
      aborted = true;
    };
  }, [activeCode]);

  // 현재가가 바뀌면 일봉 마지막 점을 가볍게 갱신한다.
  useEffect(() => {
    if (mode === "overseas") return;
    if (currentPrice == null || currentPrice <= 0) return;
    const series = seriesRef.current;
    const time = lastDailyTimeRef.current;
    if (!series || !time) return;
    series.update({ time, value: currentPrice });
  }, [currentPrice, mode]);

  const tfButtons: Timeframe[] = ["1D"];

  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">차트</div>
          <div className="text-sm font-medium">{activeName}</div>
          {mode === "overseas" && overseasProxy && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {overseasProxy.exchange} · {overseasProxy.proxyCode}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-0.5">
            일봉 차트 · 현재가는 상단 카드에서 실시간 갱신
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {overseasProxy && (
            <div className="flex gap-1">
              {(["domestic", "overseas"] as ChartMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    mode === m
                      ? "bg-accent text-white border-accent"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {m === "domestic" ? "국내" : "해외 야간"}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 flex-wrap justify-end">
            {tfButtons.map((t) => (
              <button
                key={t}
                onClick={() => undefined}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  t === "1D"
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {TF_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative h-[340px] min-h-[320px]">
        <div ref={ref} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            로딩중…
          </div>
        )}
        {!loading && empty && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            {error ? `데이터 없음 (${error})` : "데이터 없음"}
          </div>
        )}
      </div>
    </div>
  );
}
