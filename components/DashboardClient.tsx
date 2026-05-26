"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { SummaryBar } from "./SummaryBar";
import { StockCard } from "./StockCard";
import { MarketPanel } from "./MarketPanel";
import { NewsPanel } from "./NewsPanel";
import { AnalysisBox } from "./AnalysisBox";
import { PriceChart } from "./PriceChart";
import { ThemeToggle } from "./ThemeToggle";
import { fmtRelative } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

const REFRESH_MS = 60_000; // 60초

export function DashboardClient({ initial }: { initial: DashboardSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [selected, setSelected] = useState<string>(
    initial.primaries[0]?.meta.code ?? ""
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // “n초 전” 표시 강제 갱신

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const r = await fetch("/api/snapshot", { cache: "no-store" });
      if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
      const j = (await r.json()) as DashboardSnapshot;
      setSnap(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // 자동 새로고침
  useEffect(() => {
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // 상대 시간 갱신
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  const selectedSnap =
    snap.primaries.find((p) => p.meta.code === selected) ?? snap.primaries[0];

  const lastUpdated = `${fmtRelative(snap.generatedAt)} 업데이트${
    tick >= 0 ? "" : ""
  }`;

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 space-y-6">
      {/* 헤더 */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">실시간 주식 대시보드</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            반도체 중심 · 룰 기반 판단 보조 (자동매매 아님)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-sm h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            새로고침
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* 요약 바 */}
      <SummaryBar snapshot={snap} lastUpdatedLabel={lastUpdated} />

      {error && (
        <div className="rounded-xl border border-down/30 bg-down/10 text-down text-sm px-4 py-3">
          {error}
        </div>
      )}

      {/* 핵심 분석 + 차트 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {selectedSnap && <AnalysisBox snap={selectedSnap} />}
          {selectedSnap && (
            <PriceChart code={selectedSnap.meta.code} name={selectedSnap.meta.name} />
          )}
        </div>
        <div className="space-y-4">
          <MarketPanel indicators={snap.indicators} />
        </div>
      </div>

      {/* 관심 종목 카드들 */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground px-1">
          관심 종목 (탭해서 분석/차트 전환)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {snap.primaries.map((p) => (
            <StockCard
              key={p.meta.code}
              snap={p}
              selected={p.meta.code === selected}
              onSelect={setSelected}
            />
          ))}
          {snap.primaries.length === 0 && (
            <div className="md:col-span-3 text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-xl">
              종목 데이터를 불러오지 못했습니다.
            </div>
          )}
        </div>
      </section>

      {/* 뉴스 */}
      <NewsPanel items={snap.news} />

      {/* 에러/디버그 영역 */}
      {Object.keys(snap.errors).length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">불러오기 실패 항목 ({Object.keys(snap.errors).length})</summary>
          <ul className="mt-2 space-y-1">
            {Object.entries(snap.errors).map(([k, v]) => (
              <li key={k}>
                <code className="text-foreground">{k}</code>: {v}
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="text-center text-xs text-muted-foreground py-4">
        데이터: Yahoo Finance · Google News · (KIS 옵션) — 투자 판단 보조용. 본인 책임.
      </footer>
    </div>
  );
}
