"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import {
  MAX_WATCH,
  PRIMARY_SYMBOLS,
  WATCHLIST_CANDIDATES,
} from "@/lib/symbols";
import { SummaryBar } from "./SummaryBar";
import { StockCard } from "./StockCard";
import { MarketPanel } from "./MarketPanel";
import { NewsPanel } from "./NewsPanel";
import { AnalysisBox } from "./AnalysisBox";
import { PriceChart } from "./PriceChart";
import { ThemeToggle } from "./ThemeToggle";
import { fmtRelative } from "@/lib/utils";
import { RefreshCw, Search, Plus, X } from "lucide-react";

const REGULAR_REFRESH_MS = 10_000; // Yahoo 기반 장중 10초
const OFF_HOURS_REFRESH_MS = 120_000; // Yahoo 기반 비장중 120초
const KIS_REGULAR_REFRESH_MS = 2_000; // KIS 실데이터 장중 2초
const KIS_OFF_HOURS_REFRESH_MS = 30_000; // KIS 실데이터 비장중 30초
const COMMIT_DEBOUNCE_MS = 250; // 연속 칩 토글 시 마지막 변경만 fetch
const STORAGE_KEY = "watchlist.codes.v1";

const CANDIDATE_CODES = new Set(WATCHLIST_CANDIDATES.map((s) => s.code));
const CANDIDATE_BY_CODE = new Map(WATCHLIST_CANDIDATES.map((s) => [s.code, s]));

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
  const hasRealFlow = snapshot.primaries.some((p) => p.flow.source === "kis");
  if (hasRealFlow) {
    return isRegular ? KIS_REGULAR_REFRESH_MS : KIS_OFF_HOURS_REFRESH_MS;
  }
  return isRegular ? REGULAR_REFRESH_MS : OFF_HOURS_REFRESH_MS;
}

export function DashboardClient({ initial }: { initial: DashboardSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [watchCodes, setWatchCodes] = useState<string[]>(
    normalizeWatchCodes(initial.primaries.map((p) => p.meta.code))
  );
  const [selected, setSelected] = useState<string>(
    () =>
      initial.primaries[0]?.meta.code ??
      normalizeWatchCodes(initial.primaries.map((p) => p.meta.code))[0] ??
      ""
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [, setTick] = useState(0); // "n초 전" 표시 강제 갱신
  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootedRef = useRef(false);
  const watchCodesRef = useRef(watchCodes);
  useEffect(() => {
    watchCodesRef.current = watchCodes;
  }, [watchCodes]);
  const refreshMs = resolveRefreshMs(snap);

  // refresh는 항상 같은 함수 인스턴스 (의존성 없음). codes 인자를 넘기지 않으면 최신 watchCodes 사용.
  const refresh = useCallback(async (codes?: string[]) => {
    const target = codes ?? watchCodesRef.current;
    const query = encodeURIComponent(target.join(","));
    lastQueryRef.current = query;

    // 진행 중인 요청이 있으면 취소하고 새 요청만 살림
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setRefreshing(true);
    setError(null);
    try {
      const r = await fetch(`/api/snapshot?symbols=${query}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
      const j = (await r.json()) as DashboardSnapshot;
      if (lastQueryRef.current === query) {
        setSnap(j);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  // 관심종목 변경을 한 번에 모아서 처리: 칩은 즉시 업데이트, fetch는 debounce
  const commitWatch = useCallback(
    (nextCodes: string[]) => {
      const normalized = normalizeWatchCodes(nextCodes);
      setWatchCodes(normalized);
      // 선택된 종목이 사라졌을 때만 첫 종목으로 보정 (차트 깜빡임 최소화)
      setSelected((prev) =>
        normalized.includes(prev) ? prev : normalized[0] ?? ""
      );
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void refresh(normalized);
      }, COMMIT_DEBOUNCE_MS);
    },
    [refresh]
  );

  // 언마운트 시 debounce / 진행중 fetch 정리
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // 저장된 관심종목 불러오기 (마운트 1회만)
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const normalized = normalizeWatchCodes(parsed as string[]);
      const current = normalizeWatchCodes(
        initial.primaries.map((p) => p.meta.code)
      );
      if (normalized.join(",") !== current.join(",")) {
        setWatchCodes(normalized);
        setSelected(normalized[0] ?? "");
        void refresh(normalized);
      }
    } catch {
      // ignore storage parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 관심종목 저장 (마운트 직후부터 watchCodes 변경 시마다)
  useEffect(() => {
    if (!bootedRef.current) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchCodes));
  }, [watchCodes]);

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

  const lastUpdated = `${fmtRelative(snap.generatedAt)} 업데이트 · 자동 ${
    refreshMs / 1000
  }초`;

  // 검색 결과 후보 (선택되지 않은 항목만)
  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const selectedSet = new Set(watchCodes);
    return WATCHLIST_CANDIDATES.filter((s) => {
      if (selectedSet.has(s.code)) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
      );
    });
  }, [search, watchCodes]);

  const selectedSymbols = useMemo(
    () =>
      watchCodes
        .map((c) => CANDIDATE_BY_CODE.get(c))
        .filter((s): s is NonNullable<typeof s> => !!s),
    [watchCodes]
  );

  const reachedMax = watchCodes.length >= MAX_WATCH;

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 space-y-6">
      {/* 헤더 */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            실시간 주식 대시보드
          </h1>
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
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            새로고침
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* 요약 바 */}
      <SummaryBar snapshot={snap} lastUpdatedLabel={lastUpdated} />

      {/* 관심종목 한 줄 도구바 + 확장형 검색 + 카드 */}
      <section className="space-y-3">
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">
            관심 종목
          </span>
          {selectedSymbols.length === 0 ? (
            <span className="text-xs text-muted-foreground">없음</span>
          ) : (
            selectedSymbols.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() =>
                  commitWatch(watchCodes.filter((c) => c !== s.code))
                }
                className="group inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border bg-foreground text-background border-foreground hover:opacity-90 transition-opacity"
              >
                {s.name}
                <X className="h-3 w-3 opacity-70 group-hover:opacity-100" />
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => setSearchOpen((o) => !o)}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              searchOpen
                ? "bg-accent/15 border-accent/40 text-accent"
                : "bg-card border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <Plus className="h-3 w-3" />
            종목 추가
          </button>
          <button
            type="button"
            onClick={() => commitWatch(PRIMARY_SYMBOLS.map((s) => s.code))}
            className="text-xs px-2.5 py-1 rounded-full border border-border bg-card text-muted-foreground hover:bg-muted transition-colors"
          >
            기본 복구
          </button>
          <span className="ml-auto text-xs text-muted-foreground tabular">
            {watchCodes.length}/{MAX_WATCH}
          </span>
        </div>

        {/* 확장형 검색 패널 */}
        {searchOpen && (
          <div className="space-y-2 rounded-xl border border-border bg-card p-3">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="종목명 또는 코드 검색 (예: 카카오, 005930)"
                className="w-full h-9 pl-8 pr-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
              {filteredCandidates.length === 0 ? (
                <span className="text-xs text-muted-foreground py-2">
                  {search.trim() ? "검색 결과 없음" : "추가할 후보 종목 없음"}
                </span>
              ) : (
                filteredCandidates.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    disabled={reachedMax}
                    onClick={() => commitWatch([...watchCodes, s.code])}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {s.name}
                  </button>
                ))
              )}
            </div>
            <div className="flex items-center justify-between pt-1">
              {reachedMax ? (
                <p className="text-[11px] text-warn">
                  최대 {MAX_WATCH}개입니다. 위에서 하나 제거 후 추가하세요.
                </p>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  추가 가능 {MAX_WATCH - watchCodes.length}개
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setSearchOpen(false);
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                닫기
              </button>
            </div>
          </div>
        )}

        {/* 종목 카드 grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {snap.primaries.map((p) => (
            <StockCard
              key={p.meta.code}
              snap={p}
              selected={p.meta.code === selected}
              onSelect={setSelected}
            />
          ))}
          {snap.primaries.length === 0 && (
            <div className="md:col-span-2 lg:col-span-3 text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-xl">
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
          <summary className="cursor-pointer">
            불러오기 실패 항목 ({Object.keys(snap.errors).length})
          </summary>
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
        데이터: Naver Finance · Yahoo Finance · Google News — 투자 판단 보조용.
        본인 책임.
      </footer>
    </div>
  );
}
