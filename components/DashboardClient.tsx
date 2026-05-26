"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { PRIMARY_SYMBOLS, WATCHLIST_CANDIDATES } from "@/lib/symbols";
import { SummaryBar } from "./SummaryBar";
import { StockCard } from "./StockCard";
import { MarketPanel } from "./MarketPanel";
import { NewsPanel } from "./NewsPanel";
import { AnalysisBox } from "./AnalysisBox";
import { PriceChart } from "./PriceChart";
import { ThemeToggle } from "./ThemeToggle";
import { fmtRelative } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

const REGULAR_REFRESH_MS = 10_000; // Yahoo 기반 장중 10초
const OFF_HOURS_REFRESH_MS = 120_000; // Yahoo 기반 비장중 120초
const KIS_REGULAR_REFRESH_MS = 2_000; // KIS 실데이터 장중 2초
const KIS_OFF_HOURS_REFRESH_MS = 30_000; // KIS 실데이터 비장중 30초
const MAX_WATCH = 8;
const STORAGE_KEY = "watchlist.codes.v1";

const CANDIDATE_CODES = new Set(WATCHLIST_CANDIDATES.map((s) => s.code));

function normalizeWatchCodes(input: string[]): string[] {
  const normalized = Array.from(new Set(input))
    .filter((code) => CANDIDATE_CODES.has(code))
    .slice(0, MAX_WATCH);
  return normalized.length > 0
    ? normalized
    : PRIMARY_SYMBOLS.map((s) => s.code);
}

function resolveRefreshMs(snapshot: DashboardSnapshot): number {
  const isRegular = snapshot.primaries.some(
    (p) => (p.quote.marketState ?? "").toUpperCase() === "REGULAR"
  );
  const hasKis = snapshot.primaries.some((p) => p.flow.source === "kis");
  if (hasKis) {
    return isRegular ? KIS_REGULAR_REFRESH_MS : KIS_OFF_HOURS_REFRESH_MS;
  }
  return isRegular ? REGULAR_REFRESH_MS : OFF_HOURS_REFRESH_MS;
}

export function DashboardClient({ initial }: { initial: DashboardSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [watchCodes, setWatchCodes] = useState<string[]>(
    normalizeWatchCodes(initial.primaries.map((p) => p.meta.code))
  );
  const [selected, setSelected] = useState<string>(() =>
    initial.primaries[0]?.meta.code ??
      normalizeWatchCodes(initial.primaries.map((p) => p.meta.code))[0] ??
      ""
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [tick, setTick] = useState(0); // “n초 전” 표시 강제 갱신
  const inFlightRef = useRef(false);
  const refreshMs = resolveRefreshMs(snap);

  const refresh = useCallback(async (codes: string[] = watchCodes) => {
    // 짧은 주기에서도 중복 요청이 쌓이지 않게 보호
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const query = encodeURIComponent(codes.join(","));
      const r = await fetch(`/api/snapshot?symbols=${query}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
      const j = (await r.json()) as DashboardSnapshot;
      setSnap(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
      inFlightRef.current = false;
    }
  }, [watchCodes]);

  // 저장된 관심종목 불러오기
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setStorageReady(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setStorageReady(true);
        return;
      }
      const normalized = normalizeWatchCodes(parsed as string[]);
      const current = normalizeWatchCodes(initial.primaries.map((p) => p.meta.code));
      if (normalized.join(",") !== current.join(",")) {
        setWatchCodes(normalized);
        setSelected(normalized[0] ?? "");
        void refresh(normalized);
      }
    } catch {
      // ignore storage parse errors
    } finally {
      setStorageReady(true);
    }
  }, [initial.primaries, refresh]);

  // 관심종목 저장
  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchCodes));
  }, [watchCodes, storageReady]);

  // 자동 새로고침
  useEffect(() => {
    const t = setInterval(() => {
      void refresh();
    }, refreshMs);
    return () => clearInterval(t);
  }, [refresh, refreshMs]);

  // 상대 시간 갱신
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  // 선택 종목이 사라졌으면 첫 종목으로 보정
  useEffect(() => {
    if (snap.primaries.some((p) => p.meta.code === selected)) return;
    const first = snap.primaries[0]?.meta.code;
    if (first) setSelected(first);
  }, [snap.primaries, selected]);

  const selectedSnap =
    snap.primaries.find((p) => p.meta.code === selected) ?? snap.primaries[0];

  const feedMode = snap.primaries.some((p) => p.flow.source === "kis")
    ? "KIS"
    : "Yahoo";
  const lastUpdated = `${fmtRelative(snap.generatedAt)} 업데이트 · 자동 ${
    refreshMs / 1000
  }초 (${feedMode})`;

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
            onClick={() => {
              void refresh();
            }}
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

      {/* 관심종목 선택 + 카드 (요약바 바로 아래) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
              관심 종목 선택
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              최대 {MAX_WATCH}개 · 선택 즉시 데이터 갱신
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const defaults = PRIMARY_SYMBOLS.map((s) => s.code);
              setWatchCodes(defaults);
              setSelected(defaults[0] ?? "");
              void refresh(defaults);
            }}
            className="text-xs px-2.5 py-1 rounded-md border border-border bg-card hover:bg-muted transition-colors"
          >
            기본 3종목 복구
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {WATCHLIST_CANDIDATES.map((s) => {
            const active = watchCodes.includes(s.code);
            return (
              <button
                key={s.code}
                type="button"
                onClick={() => {
                  const next = active
                    ? watchCodes.filter((c) => c !== s.code)
                    : [...watchCodes, s.code];
                  const normalized = normalizeWatchCodes(next);
                  setWatchCodes(normalized);
                  if (!normalized.includes(selected)) {
                    setSelected(normalized[0] ?? "");
                  }
                  void refresh(normalized);
                }}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                  active
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-muted-foreground">
          선택됨 {watchCodes.length}/{MAX_WATCH}
        </div>

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
