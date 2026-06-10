"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getOverseasNightProxy } from "@/lib/symbols";
import type { ExecutionTick } from "@/lib/types";
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
  AreaSeries,
  CandlestickSeries,
  LineSeries,
} from "lightweight-charts";

// 차트 모드:
//   intraday : 1m/5m/15m 캔들 (KIS 분봉 + 마지막 캔들 실시간 갱신)
//   daily    : 1D 라인/에어리어 (기존 동작)
//   tick     : 체결 30건 라인 (KIS inquire-ccnl, 1.5s polling)
type Timeframe = "1m" | "5m" | "15m" | "1D" | "tick";
type ChartMode = "domestic" | "overseas";

interface OhlcPoint {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface DailyPoint {
  date: number;
  close: number;
}

interface IntradayApiResp {
  points: OhlcPoint[];
  interval: string;
  error?: string;
}

interface TickApiResp {
  executions: ExecutionTick[] | null;
  asking?: unknown;
  error?: string;
}

const TF_LABEL: Record<Timeframe, string> = {
  "1m": "1분",
  "5m": "5분",
  "15m": "15분",
  "1D": "1일",
  tick: "틱",
};

// 부모는 polling 주기로 selectedSnap 을 새로 받아 currentPrice 도 자동 흐른다.
// 이 prop 으로 분봉 모드의 "마지막 캔들 실시간 갱신" 을 수행.
interface Props {
  code: string;
  name: string;
  currentPrice?: number | null;
}

export function PriceChart({ code, name, currentPrice }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<
    ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null
  >(null);
  // 현재 시리즈 종류 — re-create 여부 판단용
  const seriesKindRef = useRef<"area" | "candle" | "line" | null>(null);
  // 분봉 모드에서 마지막 캔들의 timestamp(초) — currentPrice 도착 시 어떤 캔들을 update 할지 결정.
  const lastCandleRef = useRef<{
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
    bucketMs: number;
  } | null>(null);

  const [tf, setTf] = useState<Timeframe>("5m");
  const [mode, setMode] = useState<ChartMode>("domestic");
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overseasProxy = useMemo(() => getOverseasNightProxy(code), [code]);
  const activeCode =
    mode === "overseas" && overseasProxy ? overseasProxy.proxyCode : code;
  const activeName =
    mode === "overseas" && overseasProxy ? overseasProxy.name : name;
  const isKr = /^\d{6}\.K[SQ]$/.test(activeCode);

  // 해외 모드에서는 분봉/틱 불가 — 강제로 1D.
  const effectiveTf: Timeframe = useMemo(() => {
    if (mode === "overseas" || !isKr) return "1D";
    return tf;
  }, [mode, isKr, tf]);

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
      seriesKindRef.current = null;
    };
  }, []);

  // 데이터 로드 — timeframe / activeCode 변경 시
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let aborted = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    setLoading(true);
    setEmpty(false);
    setError(null);

    const ensureSeries = (kind: "area" | "candle" | "line") => {
      if (seriesKindRef.current === kind && seriesRef.current) {
        return seriesRef.current;
      }
      if (seriesRef.current) {
        try {
          chart.removeSeries(seriesRef.current);
        } catch {
          // 시리즈 이미 제거됨 — 무시
        }
      }
      let next:
        | ISeriesApi<"Area">
        | ISeriesApi<"Candlestick">
        | ISeriesApi<"Line">;
      if (kind === "candle") {
        next = chart.addSeries(CandlestickSeries, {
          upColor: "#ef4444",
          downColor: "#3b82f6",
          borderUpColor: "#ef4444",
          borderDownColor: "#3b82f6",
          wickUpColor: "#ef4444",
          wickDownColor: "#3b82f6",
        });
      } else if (kind === "line") {
        next = chart.addSeries(LineSeries, {
          color: "#4d8dff",
          lineWidth: 2,
        });
      } else {
        next = chart.addSeries(AreaSeries, {
          lineColor: "#4d8dff",
          topColor: "rgba(77, 141, 255, 0.35)",
          bottomColor: "rgba(77, 141, 255, 0.0)",
          lineWidth: 2,
        });
      }
      seriesRef.current = next;
      seriesKindRef.current = kind;
      return next;
    };

    const loadIntraday = async (interval: "1m" | "5m" | "15m") => {
      const r = await fetch(
        `/api/intraday-chart?code=${encodeURIComponent(activeCode)}&interval=${interval}`,
        { cache: "no-store" }
      );
      const j = (await r.json()) as IntradayApiResp;
      if (aborted) return;
      if (j.error) {
        setError(j.error);
        setEmpty(true);
        return;
      }
      const series = ensureSeries("candle") as ISeriesApi<"Candlestick">;
      const data: CandlestickData[] = (j.points ?? []).map((p) => ({
        time: Math.floor(p.date / 1000) as UTCTimestamp,
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
      }));
      series.setData(data);
      chart.timeScale().fitContent();
      setEmpty(data.length === 0);
      // 마지막 캔들 추적 — currentPrice 도착 시 update.
      const last = j.points?.[j.points.length - 1];
      if (last) {
        const bucketMs =
          interval === "1m"
            ? 60_000
            : interval === "5m"
              ? 5 * 60_000
              : 15 * 60_000;
        lastCandleRef.current = {
          time: Math.floor(last.date / 1000) as UTCTimestamp,
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
          bucketMs,
        };
      } else {
        lastCandleRef.current = null;
      }
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
      const series = ensureSeries("area") as ISeriesApi<"Area">;
      const data = (j.points ?? []).map((p) => ({
        time: Math.floor(p.date / 1000) as UTCTimestamp,
        value: p.close,
      }));
      series.setData(data);
      chart.timeScale().fitContent();
      setEmpty(data.length === 0);
      lastCandleRef.current = null;
    };

    const loadTick = async () => {
      const r = await fetch(
        `/api/intraday?code=${encodeURIComponent(activeCode)}`,
        { cache: "no-store" }
      );
      const j = (await r.json()) as TickApiResp;
      if (aborted) return;
      if (j.error) {
        setError(j.error);
        setEmpty(true);
        return;
      }
      const ticks = (j.executions ?? []).slice().sort((a, b) => a.time - b.time);
      const series = ensureSeries("line") as ISeriesApi<"Line">;
      const data: LineData[] = ticks.map((t) => ({
        time: Math.floor(t.time / 1000) as UTCTimestamp,
        value: t.price,
      }));
      series.setData(data);
      chart.timeScale().fitContent();
      setEmpty(data.length === 0);
      lastCandleRef.current = null;
    };

    const runOnce = async () => {
      try {
        if (effectiveTf === "1D") {
          await loadDaily();
        } else if (effectiveTf === "tick") {
          await loadTick();
        } else {
          await loadIntraday(effectiveTf);
        }
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

    // 폴링:
    //   - 틱: 1.5초 (KIS inquire-ccnl)
    //   - 분봉: 15초 (서버 30s 캐시지만 새 분봉 도착을 빠르게 반영)
    //   - 1D: 폴링 없음 (일봉은 정규장 종료까지 의미 변동 적음)
    if (effectiveTf === "tick") {
      pollTimer = setInterval(() => void runOnce(), 1500);
    } else if (effectiveTf !== "1D") {
      pollTimer = setInterval(() => void runOnce(), 15_000);
    }

    return () => {
      aborted = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [activeCode, effectiveTf]);

  // currentPrice 가 흐를 때 — 분봉 모드의 마지막 캔들 high/low/close 를 series.update 로 갱신.
  // (재렌더 X, 부드럽게 박힘.) 새 minute boundary 를 넘어가면 다음 fetch 가 새 캔들을 추가하기 전까지
  // 임시로 새 캔들 한 개를 추가.
  useEffect(() => {
    if (currentPrice == null || currentPrice <= 0) return;
    const series = seriesRef.current;
    if (!series || seriesKindRef.current !== "candle") return;
    const last = lastCandleRef.current;
    if (!last) return;
    const nowMs = Date.now();
    const lastEndMs = last.time * 1000 + last.bucketMs;
    if (nowMs < lastEndMs) {
      // 같은 버킷 — 마지막 캔들 갱신
      const next = {
        time: last.time,
        open: last.open,
        high: Math.max(last.high, currentPrice),
        low: Math.min(last.low, currentPrice),
        close: currentPrice,
      };
      lastCandleRef.current = { ...last, ...next };
      (series as ISeriesApi<"Candlestick">).update(next);
    } else {
      // 새 버킷 — 새 캔들 1개 추가 (open=last close 가 자연)
      const newBucketStart =
        Math.floor(nowMs / last.bucketMs) * last.bucketMs;
      const t = Math.floor(newBucketStart / 1000) as UTCTimestamp;
      const next = {
        time: t,
        open: last.close,
        high: Math.max(last.close, currentPrice),
        low: Math.min(last.close, currentPrice),
        close: currentPrice,
      };
      lastCandleRef.current = { ...next, bucketMs: last.bucketMs };
      (series as ISeriesApi<"Candlestick">).update(next);
    }
  }, [currentPrice]);

  // 틱 모드에서도 currentPrice 가 있을 때 마지막 점에 update.
  useEffect(() => {
    if (currentPrice == null || currentPrice <= 0) return;
    const series = seriesRef.current;
    if (!series || seriesKindRef.current !== "line") return;
    const t = Math.floor(Date.now() / 1000) as UTCTimestamp;
    try {
      (series as ISeriesApi<"Line">).update({ time: t, value: currentPrice });
    } catch {
      // time이 직전 점과 같은 초에 두 번 들어가면 lib가 throw할 수 있음 — 무시
    }
  }, [currentPrice]);

  const tfButtons: Timeframe[] = isKr ? ["5m", "15m", "1D"] : ["1D"];

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
          {effectiveTf !== "1D" && isKr && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {effectiveTf === "tick"
                ? "KIS 체결 · 1.5초 폴링"
                : `KIS 분봉 · ${TF_LABEL[effectiveTf]} · 실시간 갱신`}
            </div>
          )}
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
                onClick={() => setTf(t)}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  effectiveTf === t
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
