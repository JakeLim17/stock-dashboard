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
import { useRealtime } from "@/hooks/useRealtime";
import { MarketPanel } from "./MarketPanel";
import { NewsPanel } from "./NewsPanel";
import {
  StockDetailPanel,
  type StockDetailPanelHandle,
} from "./StockDetailPanel";
import { MobileDetailSheet } from "./MobileDetailSheet";
import { RecommendationsPanel } from "./RecommendationsPanel";
import { ThemeGroupView } from "./ThemeGroupView";
import { ThemeToggle } from "./ThemeToggle";
import { EventCalendar } from "./EventCalendar";
import { MarketLeadersPanel } from "./MarketLeadersPanel";
import { DisclaimerModal } from "./DisclaimerModal";
import { fmtRelative, getKrwRate, toFriendlyErrorMessage } from "@/lib/utils";
import {
  Loader2,
  LogOut,
  MoonStar,
  RefreshCw,
  Search,
  Plus,
  X,
} from "lucide-react";

async function logout() {
  try {
    await fetch("/api/login", { method: "DELETE" });
  } catch {
    // 쿠키 삭제 실패해도 일단 로그인 페이지로 보냄 (미들웨어가 다시 막아줌)
  }
  window.location.replace("/login");
}

// ─── 폴링 주기 (2026-06 응급 절감) ──────────────────────────────────
// 기존 5s → 15s default. Vercel Hobby CPU 한도 보호.
// 사용자가 더 빠르게 보고 싶으면 Vercel env 에서 NEXT_PUBLIC_POLL_INTERVAL_REGULAR_MS 등으로 override.
// 수동 새로고침 버튼은 그대로라 즉시 갱신 가능.
function envInt(key: string, fallback: number): number {
  if (typeof process === "undefined") return fallback;
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const REGULAR_REFRESH_MS = envInt("NEXT_PUBLIC_POLL_INTERVAL_REGULAR_MS", 15_000);
const EXTENDED_REFRESH_MS = envInt("NEXT_PUBLIC_POLL_INTERVAL_EXTENDED_MS", 30_000);
const OVERSEAS_NIGHT_REFRESH_MS = envInt(
  "NEXT_PUBLIC_POLL_INTERVAL_OVERSEAS_NIGHT_MS",
  60_000
);
const OFF_HOURS_REFRESH_MS = envInt(
  "NEXT_PUBLIC_POLL_INTERVAL_OFF_HOURS_MS",
  180_000
);
const KIS_REGULAR_REFRESH_MS = envInt(
  "NEXT_PUBLIC_POLL_INTERVAL_KIS_REGULAR_MS",
  15_000
);
const KIS_EXTENDED_REFRESH_MS = envInt(
  "NEXT_PUBLIC_POLL_INTERVAL_KIS_EXTENDED_MS",
  30_000
);
const KIS_OFF_HOURS_REFRESH_MS = envInt(
  "NEXT_PUBLIC_POLL_INTERVAL_KIS_OFF_HOURS_MS",
  120_000
);
const COMMIT_DEBOUNCE_MS = 250; // 연속 칩 토글 시 마지막 변경만 fetch
const STORAGE_KEY = "watchlist.codes.v1";
const NIGHT_STORAGE_KEY = "watchlist.overseasNight.v1";

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
  // 1) 정규장 OPEN인 종목이 하나라도 있으면 가장 빠른 간격
  // 2) 없으면 시간외(프리/애프터/한국 시간외 단일가)가 활성인지 확인
  // 3) 그것마저 없으면 완전 비장중
  const isRegular = snapshot.primaries.some(
    (p) => (p.quote.marketState ?? "").toUpperCase() === "REGULAR"
  );
  const isQuoteExtended = snapshot.primaries.some((p) => {
    const state = (p.quote.marketState ?? "").toUpperCase();
    return state === "PRE" || state === "POST";
  });
  const isExtended = snapshot.primaries.some(
    (p) => p.quote.extendedHours?.active === true
  );
  const isOverseasNightOpen = snapshot.primaries.some(
    (p) => (p.overseasNight?.marketState ?? "").toUpperCase() === "REGULAR"
  );
  const hasRealFlow = snapshot.primaries.some((p) => p.flow.source === "kis");

  if (hasRealFlow) {
    if (isRegular) return KIS_REGULAR_REFRESH_MS;
    if (isExtended || isQuoteExtended) return KIS_EXTENDED_REFRESH_MS;
    return KIS_OFF_HOURS_REFRESH_MS;
  }
  if (isRegular) return REGULAR_REFRESH_MS;
  if (isExtended || isQuoteExtended) return EXTENDED_REFRESH_MS;
  if (isOverseasNightOpen) return OVERSEAS_NIGHT_REFRESH_MS;
  return OFF_HOURS_REFRESH_MS;
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
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [useOverseasNight, setUseOverseasNight] = useState(false);
  // 모바일(lg 미만)에서 카드 탭 시 띄우는 상세 sheet 모달 open 여부.
  // 데스크탑에서도 setSheetOpen(true) 자체는 호출되지만, MobileDetailSheet 컴포넌트가
  // `lg:hidden` 으로 자기 자신을 가리므로 화면엔 영향 없음.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [, setTick] = useState(0); // "n초 전" 표시 강제 갱신
  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootedRef = useRef(false);
  const watchCodesRef = useRef(watchCodes);
  const overseasNightRef = useRef(useOverseasNight);
  // 선택 종목이 잠깐 응답에서 빠질 때(API 갱신 사이) 마지막 본 데이터를 유지하는 안정화 ref.
  // origin/main 의 안정화 변경을 살림. (PredictionHero 는 카드에 흡수되어 제거됨.)
  const lastSelectedSnapRef = useRef<DashboardSnapshot["primaries"][number] | null>(
    initial.primaries[0] ?? null
  );
  // 모바일 sheet "예측" 탭 점프 등 외부 제어용 ref. 데스크탑/모바일 양쪽 동일 사용.
  const detailRef = useRef<StockDetailPanelHandle>(null);
  useEffect(() => {
    watchCodesRef.current = watchCodes;
  }, [watchCodes]);
  useEffect(() => {
    overseasNightRef.current = useOverseasNight;
  }, [useOverseasNight]);
  const refreshMs = resolveRefreshMs(snap);

  // refresh는 항상 같은 함수 인스턴스 (의존성 없음). codes 인자를 넘기지 않으면 최신 watchCodes 사용.
  // force=true 면 서버 in-memory 캐시(컨센서스/시장경보)도 비우고 새로 fetch — 사용자 새로고침 버튼 전용.
  // 자동 폴링은 force=false (기본) — 30분 TTL이라 자연 만료로도 충분히 신선하고,
  // 매 폴링마다 force=true면 Yahoo/Naver 호출량이 폭증한다.
  const refresh = useCallback(
    async (codes?: string[], nightMode?: boolean, force = false) => {
      const target = codes ?? watchCodesRef.current;
      const query = encodeURIComponent(target.join(","));
      const includeNight = nightMode ?? overseasNightRef.current;
      const requestKey = `${query}:${includeNight ? "night" : "regular"}:${
        force ? "force" : "soft"
      }`;
      lastQueryRef.current = requestKey;

      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setRefreshing(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/snapshot?symbols=${query}${includeNight ? "&night=1" : ""}${
            force ? "&refresh=1" : ""
          }`,
          {
            cache: "no-store",
            signal: ctrl.signal,
          }
        );
        if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
        const j = (await r.json()) as DashboardSnapshot;
        if (lastQueryRef.current === requestKey) {
          setSnap(j);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(toFriendlyErrorMessage(e));
      } finally {
        if (abortRef.current === ctrl) {
          abortRef.current = null;
          setRefreshing(false);
        }
      }
    },
    []
  );

  const toggleOverseasNight = useCallback(() => {
    const next = !overseasNightRef.current;
    overseasNightRef.current = next;
    setUseOverseasNight(next);
    if (bootedRef.current) {
      localStorage.setItem(NIGHT_STORAGE_KEY, next ? "1" : "0");
    }
    void refresh(undefined, next);
  }, [refresh]);

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

  // 추천 패널의 "관심종목 추가" 핸들러 — 이미 있거나 가득 차면 무시.
  const handleAddFromRecommendation = useCallback(
    (code: string) => {
      if (watchCodesRef.current.includes(code)) return;
      if (watchCodesRef.current.length >= MAX_WATCH) return;
      commitWatch([...watchCodesRef.current, code]);
    },
    [commitWatch]
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
      const savedNight = localStorage.getItem(NIGHT_STORAGE_KEY) === "1";
      if (savedNight) {
        overseasNightRef.current = true;
        setUseOverseasNight(true);
      }

      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const current = normalizeWatchCodes(
        initial.primaries.map((p) => p.meta.code)
      );
      const normalized = Array.isArray(parsed)
        ? normalizeWatchCodes(parsed as string[])
        : current;
      if (normalized.join(",") !== current.join(",") || savedNight) {
        setWatchCodes(normalized);
        setSelected((prev) =>
          normalized.includes(prev) ? prev : normalized[0] ?? ""
        );
        void refresh(normalized, savedNight);
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

  useEffect(() => {
    if (!bootedRef.current) return;
    localStorage.setItem(NIGHT_STORAGE_KEY, useOverseasNight ? "1" : "0");
  }, [useOverseasNight]);

  // 자동 새로고침 (탭이 활성일 때만 — Vercel 함수 호출 절약)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (abortRef.current) return;
        void refresh();
      }, refreshMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // 다시 활성화되면 즉시 1회 갱신 후 인터벌 재가동
        if (!abortRef.current) void refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, refreshMs]);

  // 상대 시간 갱신
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  // 선택 종목이 관심종목에서 실제로 제거된 경우에만 첫 종목으로 보정.
  // API 응답이 잠깐 불완전할 때 선택이 첫 카드로 되돌아가는 문제를 막는다.
  useEffect(() => {
    if (snap.primaries.some((p) => p.meta.code === selected)) return;
    if (watchCodes.includes(selected)) return;
    const first = snap.primaries[0]?.meta.code;
    if (first) setSelected(first);
  }, [snap.primaries, selected, watchCodes]);

  const currentSelectedSnap = snap.primaries.find((p) => p.meta.code === selected);
  if (currentSelectedSnap) lastSelectedSnapRef.current = currentSelectedSnap;
  const selectedSnap =
    currentSelectedSnap ??
    (lastSelectedSnapRef.current?.meta.code === selected
      ? lastSelectedSnapRef.current
      : watchCodes.includes(selected)
        ? null
        : snap.primaries[0]);
  const visiblePrimaries = snap.primaries.filter((p) =>
    watchCodes.includes(p.meta.code)
  );

  // KIS WebSocket 실시간 구독 — 카드 가격/거래량 + 선택 종목 호가 즉시 갱신.
  // - feature flag NEXT_PUBLIC_REALTIME_ENABLED=true 일 때만 SSE 연결, 그 외엔 noop.
  // - 한국 6자리 종목만 구독 (훅 내부에서도 필터). 미국 종목은 기존 polling 유지.
  // - 60초 신선도 가드: stale tick(예: 장 마감 후 잔존) 으로 데이터가 굳지 않게.
  //
  // 구독 구조:
  //   1) 가시 카드 (visibleCodes) × [price, trade]   → H0STCNT0 한 번에 가격 + 누적거래량 추출
  //   2) 선택 종목 1개 (selectedSnap.meta.code) × [asp] → H0STASP0 호가 10단계
  //   동시 구독 ≈ 6×1 + 1 = 7건 (KIS 한도 41 안전).
  const visibleCodes = useMemo(
    () => visiblePrimaries.map((p) => p.meta.code),
    [visiblePrimaries]
  );
  const cardTopics = useMemo<("price" | "trade")[]>(
    () => ["price", "trade"],
    []
  );
  const { prices: realtimePrices, trades: realtimeTrades } = useRealtime(
    visibleCodes,
    cardTopics
  );

  // 선택 종목 호가 — 한국 종목일 때만 (H0STASP0 는 국내주식 한정).
  const aspCodes = useMemo(() => {
    const c = selectedSnap?.meta.code;
    if (!c) return [];
    return /^\d{6}\.K[SQ]$/.test(c) ? [c] : [];
  }, [selectedSnap?.meta.code]);
  const aspTopics = useMemo<("asp")[]>(() => ["asp"], []);
  const { asps: realtimeAsps } = useRealtime(aspCodes, aspTopics);

  const realtimeNow = Date.now();
  const FRESH_MS = 60_000;
  const realtimeFresh = (code: string): number | null => {
    const six = code.match(/^(\d{6})/)?.[1];
    if (!six) return null;
    const entry = realtimePrices[six];
    if (!entry) return null;
    if (realtimeNow - entry.ts > FRESH_MS) return null;
    return entry.price;
  };
  const realtimeTradeFresh = (
    code: string
  ): { cumVolume?: number; cumTradeValue?: number } | null => {
    const six = code.match(/^(\d{6})/)?.[1];
    if (!six) return null;
    const entry = realtimeTrades[six];
    if (!entry) return null;
    if (realtimeNow - entry.ts > FRESH_MS) return null;
    return {
      cumVolume: entry.cumVolume > 0 ? entry.cumVolume : undefined,
      cumTradeValue: entry.cumTradeValue > 0 ? entry.cumTradeValue : undefined,
    };
  };
  const selectedAspOverride = (() => {
    const c = selectedSnap?.meta.code;
    if (!c) return null;
    const six = c.match(/^(\d{6})/)?.[1];
    if (!six) return null;
    const entry = realtimeAsps[six];
    if (!entry) return null;
    if (realtimeNow - entry.ts > FRESH_MS) return null;
    return entry;
  })();

  // USDKRW 환율 — USD 종목 원화 병기에 사용. indicators(KRW=X) 기준.
  // 환율이 없거나 fetch 실패면 null → 자식들이 보조 표시를 자동 생략(graceful).
  const krwRate = getKrwRate(snap.indicators);

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
            Ticker
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            룰 기반 판단 보조
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              // 사용자가 직접 누른 새로고침 → 서버 캐시(컨센서스/시장경보)도 비우고 새 fetch.
              void refresh(undefined, undefined, true);
            }}
            disabled={refreshing}
            title="새로고침 (캐시 비우고 새로 조회)"
            aria-label="새로고침"
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              if (loggingOut) return;
              setLoggingOut(true);
              void logout();
            }}
            disabled={loggingOut}
            title={loggingOut ? "로그아웃 중..." : "로그아웃"}
            aria-label={loggingOut ? "로그아웃 중" : "로그아웃"}
            aria-busy={loggingOut}
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-60 disabled:cursor-progress transition-colors"
          >
            {loggingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {/* 요약 바 */}
      <SummaryBar snapshot={snap} lastUpdatedLabel={lastUpdated} />

      {/* 관심종목 한 줄 도구바 + 확장형 검색 — 종목 선택을 먼저 한 뒤 아래 결과를 보는 자연 순서 */}
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
          <button
            type="button"
            onClick={toggleOverseasNight}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              useOverseasNight
                ? "bg-accent/15 border-accent/40 text-accent"
                : "bg-card border-border text-muted-foreground hover:bg-muted"
            }`}
            title="삼성전자 GDR, SK하이닉스 GDR 같은 해외 개별 야간 지표를 예측에 반영"
          >
            <MoonStar className="h-3 w-3" />
            해외 야간 {useOverseasNight ? "ON" : "OFF"}
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
      </section>

      {/* 종목 추천 — 펼침 패널 (기본 접힘). 펼치면 watchlist 후보 전체를 분석해 카테고리·섹터별로 노출 */}
      <RecommendationsPanel
        watchlist={watchCodes}
        onAddToWatchlist={handleAddFromRecommendation}
        maxWatch={MAX_WATCH}
        krwRate={krwRate}
      />

      {/* 테마별 보기 — 기본 접힘. AI 반도체·배터리·방산 등 묶음 + 동조율 표시.
          Round2 Fix8: 시장순위 위로 이동 (사용자가 테마 → 순위 흐름으로 보고 싶어함). */}
      <ThemeGroupView
        indicators={snap.indicators}
        watchlist={watchCodes}
        onAddToWatchlist={handleAddFromRecommendation}
        maxWatch={MAX_WATCH}
      />

      {/* 시장 순위 — KIS 활성 시 거래량/상승/하락 TOP. 기본 접힘.
          Round2 Fix8: 테마별 보기 아래로 이동. */}
      <MarketLeadersPanel />

      {/* 종목 디테일 패널 (데스크탑 전용 고정) — 탭 구조 [예측 | 컨센서스 | 수급 | 호가 | 뉴스].
          Round2 Fix7: 카드 그리드 위로 이동 — 사용자가 카드 클릭하면 위에서 바로 상세분석이 보이도록.
          첫 진입에는 selectedSnap 이 첫 카드로 폴백되어 빈 패널 깜빡임 없음.
          모바일(lg 미만)에서는 별도 MobileDetailSheet 모달이 카드 탭 시 슬라이드 업한다. */}
      <div className="hidden lg:block">
        <StockDetailPanel
          ref={detailRef}
          snap={selectedSnap}
          allNews={snap.news}
          krwRate={krwRate}
          kisActive={snap.kisActive}
          aspOverride={selectedAspOverride}
        />
      </div>

      {/* 종목 카드 grid — 카드 자체에 예측·강도·손익비 등 PredictionHero 의 핵심을 흡수했다.
          데스크탑은 위쪽 StockDetailPanel(고정) 노출 + 카드는 비교용. 모바일은 카드 탭 시 sheet 모달.
          카드별 mount 시 짧은 fade-in + slide(60ms 간격) 시각 효과. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visiblePrimaries.map((p, i) => (
          <div
            key={p.meta.code}
            className="card-fade-in"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <StockCard
              snap={p}
              selected={p.meta.code === selected}
              onSelect={(code) => {
                setSelected(code);
                // 모바일에서는 모달 오픈. 데스크탑에선 MobileDetailSheet 컴포넌트가 lg:hidden
                // 자체 가드라 setSheetOpen(true) 호출이 화면에 영향 없음.
                setSheetOpen(true);
              }}
              krwRate={krwRate}
              kisActive={snap.kisActive}
              priceOverride={realtimeFresh(p.meta.code)}
              tradeOverride={realtimeTradeFresh(p.meta.code)}
            />
          </div>
        ))}
        {visiblePrimaries.length === 0 && (
          <div className="md:col-span-2 lg:col-span-3 text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-xl">
            선택한 관심종목 데이터를 불러오는 중입니다.
          </div>
        )}
      </div>

      {/* 모바일 sheet 모달 — 자체적으로 lg:hidden 가드 + open 상태에 따라 슬라이드 인/아웃 */}
      <MobileDetailSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        snap={selectedSnap ?? null}
        allNews={snap.news}
        krwRate={krwRate}
        kisActive={snap.kisActive}
        aspOverride={selectedAspOverride}
      />

      {error && (
        <div className="rounded-xl border border-down/30 bg-down/10 text-down text-sm px-4 py-3">
          {error}
        </div>
      )}

      {/* 시장 신호 + 이벤트 캘린더 — 차트는 카드별 sparkline 으로 대체되어 메인에서 제거됐다.
          (selected 종목의 풀 차트는 StockDetailPanel "예측" 탭에서 별도 노출 가능.) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MarketPanel indicators={snap.indicators} />
        <EventCalendar snapshot={snap} />
      </div>

      {/* 뉴스 */}
      <NewsPanel
        items={snap.news}
        selectedSymbol={
          selectedSnap
            ? { code: selectedSnap.meta.code, name: selectedSnap.meta.name }
            : null
        }
      />

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

      <DisclaimerModal />

      <footer className="text-center text-xs text-muted-foreground py-4 space-y-1.5">
        <p className="leading-relaxed max-w-2xl mx-auto px-4">
          ⚠️ 본 화면의 모든 신호·예측·점수는 룰 기반 알고리즘 출력입니다.
          투자권유 또는 매매 추천이 아니며, 투자 결정과 그 결과 책임은
          전적으로 사용자에게 있습니다.
        </p>
        <p>데이터 출처: KIS · 네이버 · Yahoo · Google News</p>
        <p>익명 트래픽 통계(Vercel Analytics) 수집 · IP·쿠키 미저장.</p>
        <p className="pt-1">
          <a
            href="/terms"
            className="text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          >
            이용약관
          </a>
          <span className="mx-1.5 opacity-50">·</span>
          <a
            href="/privacy"
            className="text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          >
            개인정보 처리방침
          </a>
        </p>
      </footer>
    </div>
  );
}
