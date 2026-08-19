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
import { useIsMobile } from "@/hooks/useIsMobile";
import { MarketPanel } from "./MarketPanel";
import { NewsPanel } from "./NewsPanel";
import {
  StockDetailPanel,
  type StockDetailPanelHandle,
} from "./StockDetailPanel";
import { MobileDetailSheet } from "./MobileDetailSheet";
import { PendingStockCard } from "./skeletons/StockCardSkeleton";
import { RecommendationsPanel } from "./RecommendationsPanel";
import { ThemeGroupView } from "./ThemeGroupView";
import { ThemeToggle } from "./ThemeToggle";
import { UnifiedSchedulePanel } from "./UnifiedSchedulePanel";
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
  Bookmark,
} from "lucide-react";
import { HelpTooltip } from "./HelpTooltip";
import {
  loadDefaultWatchlist,
  primaryWatchCodes,
  saveDefaultWatchlist,
  hasSavedDefaultWatchlist,
} from "@/lib/watchlist-default";
import {
  EXTENDED_POLL_MS as DEFAULT_EXTENDED_POLL_MS,
  FULL_SNAPSHOT_MIN_MS as DEFAULT_FULL_SNAPSHOT_MIN_MS,
  OFF_HOURS_POLL_MS as DEFAULT_OFF_HOURS_POLL_MS,
  OVERSEAS_NIGHT_POLL_MS as DEFAULT_OVERSEAS_NIGHT_POLL_MS,
  REGULAR_POLL_MS as DEFAULT_REGULAR_POLL_MS,
} from "@/lib/providers/kisCachePolicy";

async function logout() {
  try {
    await fetch("/api/login", { method: "DELETE" });
  } catch {
    // 쿠키 삭제 실패해도 일단 로그인 페이지로 보냄 (미들웨어가 다시 막아줌)
  }
  window.location.replace("/login");
}

// ─── 폴링 주기 (Vercel 함수 호출 절감) ──────────────────────────
// lite 장중 90s / 장후·야간 3분 / 휴장 5분 — 예전 15~45s는 Hobby Active CPU 부담.
// full 예측 15분 고정 — 더 자주 불필요. WS(KR)로 장중 체감 보완.
// 기본값은 lib/providers/kisCachePolicy.ts 와 동기. env 로 override 가능.
function envInt(key: string, fallback: number): number {
  if (typeof process === "undefined") return fallback;
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const REGULAR_REFRESH_MS = envInt(
  "NEXT_PUBLIC_POLL_INTERVAL_REGULAR_MS",
  DEFAULT_REGULAR_POLL_MS
);
const EXTENDED_REFRESH_MS = envInt(
  "NEXT_PUBLIC_POLL_INTERVAL_EXTENDED_MS",
  DEFAULT_EXTENDED_POLL_MS
);
const OVERSEAS_NIGHT_REFRESH_MS = envInt(
  "NEXT_PUBLIC_POLL_INTERVAL_OVERSEAS_NIGHT_MS",
  DEFAULT_OVERSEAS_NIGHT_POLL_MS
);
const OFF_HOURS_REFRESH_MS = envInt(
  "NEXT_PUBLIC_POLL_INTERVAL_OFF_HOURS_MS",
  DEFAULT_OFF_HOURS_POLL_MS
);
/** full 분석 스냅샷 최소 간격 — 그 사이는 lite(시세만) 폴링 */
const FULL_SNAPSHOT_MIN_MS = envInt(
  "NEXT_PUBLIC_FULL_SNAPSHOT_MIN_MS",
  DEFAULT_FULL_SNAPSHOT_MIN_MS
);
/** 클라이언트 fetch 하드 타임아웃 — 서버 hang 시 UI 무한 대기 방지 */
const LITE_FETCH_TIMEOUT_MS = 25_000;
/** 서버 full 상한(~22s)보다 약간 길게 — 응답 discard 레이스 방지와 맞춤 */
const FULL_FETCH_TIMEOUT_MS = 28_000;
/** lite 상태로 이 시간 넘기면 「분석 중」 강제 해제 (고착 방지) */
const ANALYSIS_STUCK_GUARD_MS = 45_000;
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
  // ※ KIS 수급(flow.source=kis)이 있어도 폴링을 더 빠르게 하지 않음.
  //   수급은 서버 장중 1h·장후 24h(+KV) · 시세는 세션별 TTL+SWR / WS·lite 로 충분.
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

  if (isRegular) return REGULAR_REFRESH_MS;
  if (isExtended || isQuoteExtended) return EXTENDED_REFRESH_MS;
  if (isOverseasNightOpen) return OVERSEAS_NIGHT_REFRESH_MS;
  return OFF_HOURS_REFRESH_MS;
}

/** lite 응답은 시세·지표만 갱신 — 분석·예측·뉴스는 full/core 스냅샷 유지.
 *  prev 에 없던 신규 종목(방금 추가된 카드)은 lite 항목(시세 + "분석 중" placeholder)을
 *  그대로 append — 추가 직후 카드가 가격부터 즉시 채워지도록.
 *  ※ phase 는 prev 유지 — lite 가 full/core 를 다시 "lite" 로 되돌리면 분석 중 고착. */
function mergeLiteIntoSnapshot(
  prev: DashboardSnapshot,
  lite: DashboardSnapshot
): DashboardSnapshot {
  const quoteByCode = new Map(lite.primaries.map((p) => [p.meta.code, p.quote]));
  const prevCodes = new Set(prev.primaries.map((p) => p.meta.code));
  const appended = lite.primaries.filter((p) => !prevCodes.has(p.meta.code));
  const keepPhase =
    prev.phase === "full" || prev.phase === "core" ? prev.phase : lite.phase;
  return {
    ...prev,
    generatedAt: lite.generatedAt,
    phase: keepPhase,
    indicators: lite.indicators,
    marketMood: lite.marketMood,
    macroEvents: lite.macroEvents,
    kisActive: lite.kisActive,
    errors: { ...prev.errors, ...lite.errors },
    primaries: [
      ...prev.primaries.map((p) => {
        const q = quoteByCode.get(p.meta.code);
        return q ? { ...p, quote: q } : p;
      }),
      ...appended,
    ],
  };
}

/** core(수급·컨센·RSI·규칙분석) 응답 — 예측·야간은 full 대기 시 기존 값 유지. */
function mergeCoreIntoSnapshot(
  prev: DashboardSnapshot,
  core: DashboardSnapshot
): DashboardSnapshot {
  const byCode = new Map(core.primaries.map((p) => [p.meta.code, p]));
  return {
    ...prev,
    generatedAt: core.generatedAt,
    phase: "core",
    indicators: core.indicators.length ? core.indicators : prev.indicators,
    marketMood: core.marketMood ?? prev.marketMood,
    macroEvents: core.macroEvents ?? prev.macroEvents,
    kisActive: core.kisActive ?? prev.kisActive,
    errors: { ...prev.errors, ...core.errors },
    news: prev.news?.length ? prev.news : core.news ?? [],
    primaries: (() => {
      const merged = prev.primaries.map((p) => {
        const c = byCode.get(p.meta.code);
        if (!c) return p;
        // core 는 예측·야간을 skip — 이미 full 에 있던 값은 유지
        return {
          ...c,
          predictions: c.predictions ?? p.predictions,
          overseasNight: c.overseasNight ?? p.overseasNight,
        };
      });
      for (const c of core.primaries) {
        if (!merged.some((p) => p.meta.code === c.meta.code)) merged.push(c);
      }
      return merged;
    })(),
  };
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
  const [watchLoading, setWatchLoading] = useState(false);
  const [defaultSavedHint, setDefaultSavedHint] = useState(false);
  // 모바일(lg 미만)에서 카드 탭 시 띄우는 상세 sheet 모달 open 여부.
  // 데스크탑에서도 setSheetOpen(true) 자체는 호출되지만, MobileDetailSheet 컴포넌트가
  // `lg:hidden` 으로 자기 자신을 가리므로 화면엔 영향 없음.
  const [sheetOpen, setSheetOpen] = useState(false);
  // 방금 추가돼 아직 full 분석이 도착하지 않은 종목 코드 — 카드별 "분석 중" 표시용.
  const [pendingCodes, setPendingCodes] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [showNews, setShowNews] = useState(initial.phase !== "lite");
  /** full 실패·타임아웃 후에도 "분석 중" 스피너를 무한히 돌리지 않음 */
  const [analysisGaveUp, setAnalysisGaveUp] = useState(false);
  const [fullRetryNonce, setFullRetryNonce] = useState(0);
  const [, setTick] = useState(0); // "n초 전" 표시 강제 갱신
  /** lite/full 분리 — lite 폴링이 full 분석을 abort 하지 않도록 */
  const liteAbortRef = useRef<AbortController | null>(null);
  const fullAbortRef = useRef<AbortController | null>(null);
  const fullRetryCountRef = useRef(0);
  /** lite 와 full 의 requestKey 를 분리 — lite 폴링이 full 응답을 discard 하던 고착 원인 */
  const lastLiteQueryRef = useRef<string>("");
  const lastFullQueryRef = useRef<string>("");
  /** 진행 중 core/full 의 requestKey — Strict Mode abort 후 재진입 판별용 */
  const inflightAnalysisKeyRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootedRef = useRef(false);
  const analysisStartedAtRef = useRef<number>(
    initial.phase === "lite" ? Date.now() : 0
  );
  const watchCodesRef = useRef(watchCodes);
  const pendingCodesRef = useRef<ReadonlySet<string>>(pendingCodes);
  const overseasNightRef = useRef(useOverseasNight);
  // 선택 종목이 잠깐 응답에서 빠질 때(API 갱신 사이) 마지막 본 데이터를 유지하는 안정화 ref.
  // origin/main 의 안정화 변경을 살림. (PredictionHero 는 카드에 흡수되어 제거됨.)
  const lastSelectedSnapRef = useRef<DashboardSnapshot["primaries"][number] | null>(
    initial.primaries[0] ?? null
  );
  const lastFullFetchAtRef = useRef<number>(
    initial.phase === "full" || initial.phase === "core" ? Date.now() : 0
  );
  // 모바일 sheet "예측" 탭 점프 등 외부 제어용 ref. 데스크탑/모바일 양쪽 동일 사용.
  const detailRef = useRef<StockDetailPanelHandle>(null);
  useEffect(() => {
    watchCodesRef.current = watchCodes;
  }, [watchCodes]);
  useEffect(() => {
    pendingCodesRef.current = pendingCodes;
  }, [pendingCodes]);
  useEffect(() => {
    overseasNightRef.current = useOverseasNight;
  }, [useOverseasNight]);
  const refreshMs = resolveRefreshMs(snap);
  const analysisPending = snap.phase === "lite" && !analysisGaveUp;
  const isMobile = useIsMobile();

  const giveUpAnalysis = useCallback((msg?: string) => {
    setAnalysisGaveUp(true);
    setPendingCodes(new Set());
    setShowNews(true);
    inflightAnalysisKeyRef.current = null;
    if (msg) setError(msg);
  }, []);

  /** 실패·타임아웃 재시도 (횟수 제한) */
  const scheduleFullRetry = useCallback(() => {
    inflightAnalysisKeyRef.current = null;
    if (fullRetryCountRef.current >= 2) {
      giveUpAnalysis(
        "분석을 불러오지 못했어요. 시세는 유지됩니다. 아래 버튼으로 다시 시도할 수 있어요."
      );
      return;
    }
    fullRetryCountRef.current += 1;
    window.setTimeout(() => setFullRetryNonce((n) => n + 1), 2_000);
  }, [giveUpAnalysis]);

  /** Strict Mode cleanup / 키 교체로 abort 된 경우 — 실패로 세지 않고 Phase B 재진입 */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const reenterAnalysisFetch = useCallback(() => {
    inflightAnalysisKeyRef.current = null;
    window.setTimeout(() => {
      if (mountedRef.current) setFullRetryNonce((n) => n + 1);
    }, 0);
  }, []);

  // refresh는 항상 같은 함수 인스턴스 (의존성 없음). codes 인자를 넘기지 않으면 최신 watchCodes 사용.
  // force=true 면 서버 in-memory 캐시(컨센서스/시장경보)도 비우고 새로 fetch — 사용자 새로고침 버튼 전용.
  // 자동 폴링은 force=false (기본) — 30분 TTL이라 자연 만료로도 충분히 신선하고,
  // 매 폴링마다 force=true면 Yahoo/Naver 호출량이 폭증한다.
  const refresh = useCallback(
    async (
      codes?: string[],
      nightMode?: boolean,
      force = false,
      silent = false,
      // "lite": 시세만 / "core": 예측·RSI·수급 우선 / "full": 뉴스·공시 포함 / 생략(auto)
      mode?: "lite" | "core" | "full"
    ) => {
      const target = codes ?? watchCodesRef.current;
      const query = encodeURIComponent(target.join(","));
      const includeNight = nightMode ?? overseasNightRef.current;
      const now = Date.now();
      const needsFull =
        force ||
        lastFullFetchAtRef.current === 0 ||
        now - lastFullFetchAtRef.current >= FULL_SNAPSHOT_MIN_MS;
      let useLite = false;
      let useCore = false;
      if (mode === "lite") useLite = true;
      else if (mode === "core") useCore = true;
      else if (mode === "full") {
        /* full */
      } else {
        // auto: force/주기면 full, 아니면 lite
        useLite = !force && !needsFull;
      }
      const phaseTag = force
        ? "force"
        : useLite
          ? "lite"
          : useCore
            ? "core"
            : "full";
      const requestKey = `${query}:${includeNight ? "night" : "regular"}:${phaseTag}`;
      if (useLite) lastLiteQueryRef.current = requestKey;
      else {
        lastFullQueryRef.current = requestKey;
        inflightAnalysisKeyRef.current = requestKey;
      }

      // lite는 full을 끊지 않음 — 분석 중에도 시세 폴링 가능
      if (useLite) {
        if (liteAbortRef.current) liteAbortRef.current.abort();
      } else {
        if (fullAbortRef.current) fullAbortRef.current.abort();
      }
      const ctrl = new AbortController();
      if (useLite) liteAbortRef.current = ctrl;
      else fullAbortRef.current = ctrl;
      const timeoutMs = useLite ? LITE_FETCH_TIMEOUT_MS : FULL_FETCH_TIMEOUT_MS;
      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs);

      if (!silent) setRefreshing(true);
      if (!useLite) setError(null);
      try {
        const r = await fetch(
          `/api/snapshot?symbols=${query}${includeNight ? "&night=1" : ""}${
            useLite ? "&lite=1" : useCore ? "&core=1" : ""
          }${force ? "&refresh=1" : ""}`,
          {
            // core/full 은 브라우저 HTTP 캐시 금지 — stale·discard 고착 방지
            cache: useLite && !force ? "default" : "no-store",
            signal: ctrl.signal,
          }
        );
        if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
        const j = (await r.json()) as DashboardSnapshot;
        // lite / full 키를 분리 — lite 폴링이 full 응답을 버려 「분석 중」 고착시키던 버그 수정
        const keyStillCurrent = useLite
          ? lastLiteQueryRef.current === requestKey
          : lastFullQueryRef.current === requestKey;
        if (!keyStillCurrent) {
          if (
            !useLite &&
            inflightAnalysisKeyRef.current === requestKey
          ) {
            // 응답 전에 키가 바뀌었는데 이 요청이 마지막 inflight 면 재진입
            reenterAnalysisFetch();
          }
          return;
        }
        if (useLite) {
          setSnap((prev) => mergeLiteIntoSnapshot(prev, j));
        } else {
          lastFullFetchAtRef.current = Date.now();
          fullRetryCountRef.current = 0;
          setAnalysisGaveUp(false);
          if (inflightAnalysisKeyRef.current === requestKey) {
            inflightAnalysisKeyRef.current = null;
          }
          if (useCore || j.phase === "core") {
            setSnap((prev) => mergeCoreIntoSnapshot(prev, j));
          } else {
            setSnap(j);
          }
          const arrived = new Set(j.primaries.map((p) => p.meta.code));
          const failed = target.filter(
            (c) => pendingCodesRef.current.has(c) && !arrived.has(c)
          );
          if (pendingCodesRef.current.size > 0) {
            setPendingCodes((prev) => {
              const next = new Set(
                [...prev].filter((c) => !arrived.has(c) && !failed.includes(c))
              );
              return next.size === prev.size ? prev : next;
            });
          }
          if (failed.length > 0 && failed.length < target.length) {
            const names = failed
              .map((c) => CANDIDATE_BY_CODE.get(c)?.name ?? c)
              .join(", ");
            setWatchCodes((prev) =>
              normalizeWatchCodes(prev.filter((c) => !failed.includes(c)))
            );
            setError(
              `${names} 종목 데이터를 불러오지 못해 관심 종목에서 제외했어요. 잠시 후 다시 추가해주세요.`
            );
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          if (timedOut) {
            setError(
              useLite
                ? `시세 요청이 ${Math.round(timeoutMs / 1000)}초를 넘겨 중단됐어요. 새로고침 해 주세요.`
                : `분석 요청이 ${Math.round(timeoutMs / 1000)}초를 넘겨 중단됐어요. 시세는 유지되며, 잠시 후 다시 시도합니다.`
            );
            if (!useLite) scheduleFullRetry();
            setShowNews(true);
          } else if (!useLite) {
            // Strict Mode cleanup · 다른 core/full 교체 abort
            // 교체 요청이 이미 inflight 면 재진입 스킵, 아니면 Phase B 재진입
            if (
              inflightAnalysisKeyRef.current === requestKey ||
              inflightAnalysisKeyRef.current === null
            ) {
              reenterAnalysisFetch();
            }
          }
          return;
        }
        setError(toFriendlyErrorMessage(e));
        if (!useLite) scheduleFullRetry();
        setShowNews(true);
      } finally {
        clearTimeout(timeoutTimer);
        const slot = useLite ? liteAbortRef : fullAbortRef;
        if (slot.current === ctrl) {
          slot.current = null;
          if (!silent) setRefreshing(false);
          setWatchLoading(false);
        }
      }
    },
    [scheduleFullRetry, reenterAnalysisFetch]
  );

  // Phase B — lite → core(수급·컨센·RSI·규칙분석) → full(ChronoPulse 예측·뉴스·공시).
  // lite 폴링과 abort 슬롯 분리. core 는 예측을 기다리지 않음.
  // ※ fullFetchStartedRef 게이트 제거: React Strict Mode 가 mount effect 를
  //   setup→cleanup(abort)→setup 하면 첫 abort 후 플래그만 true 로 남아
  //   두 번째 setup 이 early-return → core 응답 discard → 「분석 중」 영구 고착.
  //   대신 inflight 키 + abort 시 reenterAnalysisFetch 로 복구.
  useEffect(() => {
    if (analysisGaveUp) return;

    // 이미 full 이고 신규 pending 없으면 완료
    if (snap.phase === "full" && pendingCodes.size === 0) {
      fullRetryCountRef.current = 0;
      return;
    }

    // 동일 단계 요청이 이미 진행 중이면 중복 호출 방지
    const wantMode: "core" | "full" =
      snap.phase === "core" && pendingCodes.size === 0 ? "full" : "core";
    const night = overseasNightRef.current ? "night" : "regular";
    const q = encodeURIComponent(watchCodesRef.current.join(","));
    const expectKey = `${q}:${night}:${wantMode}`;
    if (inflightAnalysisKeyRef.current === expectKey) return;

    if (snap.phase === "full" && pendingCodes.size > 0) {
      void refresh(undefined, undefined, false, true, "core");
      return;
    }
    if (snap.phase === "lite") {
      if (!analysisStartedAtRef.current) analysisStartedAtRef.current = Date.now();
      void refresh(undefined, undefined, false, true, "core");
    } else if (snap.phase === "core") {
      void refresh(undefined, undefined, false, true, "full");
    }
  }, [snap.phase, refresh, fullRetryNonce, analysisGaveUp, pendingCodes]);

  // 고착 가드 — lite 에 너무 오래 머물면 「분석 중」 강제 해제
  useEffect(() => {
    if (snap.phase !== "lite" || analysisGaveUp) return;
    const started = analysisStartedAtRef.current || Date.now();
    analysisStartedAtRef.current = started;
    const left = ANALYSIS_STUCK_GUARD_MS - (Date.now() - started);
    const t = window.setTimeout(
      () => {
        if (fullAbortRef.current) {
          try {
            fullAbortRef.current.abort();
          } catch {
            /* ignore */
          }
        }
        giveUpAnalysis(
          "분석이 오래 걸려 중단했어요. 시세는 유지됩니다. 다시 시도해 주세요."
        );
      },
      Math.max(1_000, left)
    );
    return () => clearTimeout(t);
  }, [snap.phase, analysisGaveUp, giveUpAnalysis, fullRetryNonce]);

  // full/core 도착 후 뉴스 패널 defer — 카드·시세 우선, 글로벌 뉴스는 idle/2s 후.
  useEffect(() => {
    if (analysisPending) {
      setShowNews(false);
      return;
    }
    let cancelled = false;
    const reveal = () => {
      if (!cancelled) setShowNews(true);
    };
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(reveal, { timeout: 2000 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = setTimeout(reveal, 2000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [analysisPending]);

  const toggleOverseasNight = useCallback(() => {
    const next = !overseasNightRef.current;
    overseasNightRef.current = next;
    setUseOverseasNight(next);
    if (bootedRef.current) {
      localStorage.setItem(NIGHT_STORAGE_KEY, next ? "1" : "0");
    }
    void refresh(undefined, next);
  }, [refresh]);

  // 관심종목 변경을 한 번에 모아서 처리 (Optimistic UI):
  //   - 삭제만: 카드가 즉시 사라지고 끝 — 무거운 스냅샷 재조회 없음 (다음 폴링에서 자연 갱신)
  //   - 추가: placeholder 카드가 즉시 나타나고, lite(시세 1~3초) → full(분석·예측) 순으로
  //     백그라운드에서 채워진다. 실패 시 full 응답 시점에 롤백 + 한국어 안내.
  const commitWatch = useCallback(
    (nextCodes: string[]) => {
      const normalized = normalizeWatchCodes(nextCodes);
      const prevCodes = watchCodesRef.current;
      const added = normalized.filter((c) => !prevCodes.includes(c));
      watchCodesRef.current = normalized;
      setWatchCodes(normalized);
      // 선택된 종목이 사라졌을 때만 첫 종목으로 보정 (차트 깜빡임 최소화)
      setSelected((prev) =>
        normalized.includes(prev) ? prev : normalized[0] ?? ""
      );
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (added.length === 0) {
        // 삭제만 — UI는 이미 반영 완료. fetch 불필요.
        setWatchLoading(false);
        return;
      }
      setWatchLoading(true);
      setPendingCodes((prev) => new Set([...prev, ...added]));
      debounceRef.current = setTimeout(async () => {
        // lite — 시세만. 분석은 Phase B(core→full)가 이어받음 (여기서 full 치면 abort 레이스).
        analysisStartedAtRef.current = Date.now();
        setAnalysisGaveUp(false);
        inflightAnalysisKeyRef.current = null;
        fullRetryCountRef.current = 0;
        await refresh(normalized, undefined, false, true, "lite");
        setWatchLoading(false);
      }, COMMIT_DEBOUNCE_MS);
    },
    [refresh]
  );

  const restoreDefaultWatch = useCallback(() => {
    const saved = loadDefaultWatchlist();
    const codes = saved?.length
      ? normalizeWatchCodes(saved)
      : normalizeWatchCodes(primaryWatchCodes());
    commitWatch(codes);
  }, [commitWatch]);

  const saveCurrentAsDefault = useCallback(() => {
    saveDefaultWatchlist(watchCodesRef.current);
    setDefaultSavedHint(true);
    window.setTimeout(() => setDefaultSavedHint(false), 2500);
  }, []);

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
      liteAbortRef.current?.abort();
      fullAbortRef.current?.abort();
    };
  }, []);

  // 저장된 관심종목 불러오기 (마운트 1회만)
  // DashboardShell 이 이미 localStorage symbols + night 로 lite 를 받았으므로,
  // 코드가 같을 때는 night UI 상태만 맞추고 재 fetch 하지 않는다.
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
      // 관심종목이 Shell 최초 lite 와 다를 때만 재조회.
      // (night 플래그만 달라도 Shell 이 이미 night=1 로 받았으면 skip)
      if (normalized.join(",") !== current.join(",")) {
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

  // 자동 새로고침 (탭 비활성 시 정지 — Vercel 함수 호출 절약)
  // mode 생략(auto): 평소 lite, FULL_SNAPSHOT_MIN_MS(15분) 경과 시만 full.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        if (liteAbortRef.current || fullAbortRef.current) return;
        void refresh(undefined, undefined, false, true);
      }, refreshMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // 다시 활성화되면 lite 주기만큼 지났을 때만 즉시 갱신 (auto → 필요 시 full)
        const stale =
          Date.now() - lastFullFetchAtRef.current >= Math.min(refreshMs, 60_000);
        if (!liteAbortRef.current && !fullAbortRef.current && stale)
          void refresh(undefined, undefined, false, true);
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
  // 방금 추가돼 아직 스냅샷에 데이터가 없는 종목 — 즉시 placeholder 카드로 표시.
  const snapCodes = new Set(snap.primaries.map((p) => p.meta.code));
  const placeholderSymbols = watchCodes
    .filter((c) => !snapCodes.has(c))
    .map((c) => CANDIDATE_BY_CODE.get(c))
    .filter((s): s is NonNullable<typeof s> => !!s);

  // KIS WebSocket 실시간 구독 — 카드 가격/거래량 즉시 갱신.
  // - feature flag NEXT_PUBLIC_REALTIME_ENABLED=true 일 때만 SSE 연결, 그 외엔 noop.
  // - 한국 6자리 종목만 구독 (훅 내부에서도 필터). 미국 종목은 기존 polling 유지.
  // - 60초 신선도 가드: stale tick(예: 장 마감 후 잔존) 으로 데이터가 굳지 않게.
  //
  // 구독 구조:
  //   가시 카드 (visibleCodes) × [price, trade] → H0STCNT0 한 번에 가격 + 누적거래량 추출
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
            TickerDay
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            관심종목·시세 한눈에
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

      {/* 관심종목 — 칩·액션 정렬 (모바일 wrap) */}
      <section className="space-y-3 rounded-xl border border-border/80 bg-card/40 p-3 md:p-4">
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1 shrink-0">
            관심 종목
          </span>
          <HelpTooltip
            content="칩을 누르면 목록에서 제거됩니다. 종목 추가로 후보에서 골라 넣을 수 있어요."
            label="관심종목 안내"
          />
          {watchLoading && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              종목 데이터를 불러오는 중…
            </span>
          )}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:flex-1 min-w-0">
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
          </div>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
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
          <HelpTooltip
            content="검색해서 관심종목에 추가합니다. 최대 6개까지 담을 수 있어요."
            label="종목 추가 안내"
            side="bottom"
          />
          <button
            type="button"
            onClick={restoreDefaultWatch}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-border bg-card text-muted-foreground hover:bg-muted transition-colors"
          >
            기본 복구
          </button>
          <HelpTooltip
            content={
              hasSavedDefaultWatchlist()
                ? "저장해 둔 기본 관심종목 목록으로 되돌립니다."
                : "저장된 기본값이 없어요. 삼성전자·SK하이닉스·삼성전기로 복구합니다. 「기본값 저장」으로 내 목록을 고정할 수 있어요."
            }
            label="기본 복구 안내"
            side="bottom"
          />
          <button
            type="button"
            onClick={saveCurrentAsDefault}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-border bg-card text-muted-foreground hover:bg-muted transition-colors"
          >
            <Bookmark className="h-3 w-3" />
            기본값 저장
          </button>
          <button
            type="button"
            onClick={toggleOverseasNight}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              useOverseasNight
                ? "bg-accent/15 border-accent/40 text-accent"
                : "bg-card border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <MoonStar className="h-3 w-3" />
            해외 야간 {useOverseasNight ? "ON" : "OFF"}
          </button>
          <HelpTooltip
            content="미국·유럽 야간·프리마켓 ADR·GDR 프록시 시세를 반영해 국내 종목 단기 예측에 가중합니다. SK하이닉스는 SKHY ADR 우선(폴백 HY9H.F), 삼성전자는 SMSN.IL GDR이에요."
            label="해외 야간 안내"
            side="bottom"
          />
          <span className="text-xs text-muted-foreground tabular">
            {watchCodes.length}/{MAX_WATCH}
          </span>
          </div>
        </div>
        {defaultSavedHint && (
          <p className="text-[11px] text-up">현재 목록을 기본값으로 저장했어요.</p>
        )}

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

      {/* 테마별 보기 — 기본 접힘. AI 반도체·배터리·방산 등 묶음 + 동조율 표시. */}
      <ThemeGroupView
        indicators={snap.indicators}
        watchlist={watchCodes}
        onAddToWatchlist={handleAddFromRecommendation}
        maxWatch={MAX_WATCH}
      />

      {/* 종목 디테일 패널 (데스크탑 전용 고정) — 탭 구조 [예측 | 컨센서스 | 수급 | 뉴스].
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
          marketSemiHeat={snap.marketMood.semiHeat}
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
              variant={isMobile ? "mobile" : "desktop"}
              onSelect={(code) => {
                setSelected(code);
                // 모바일: 카드 탭 시 모달 대신 카드 내 인라인 상세(수급·컨센서스) 사용
              }}
              krwRate={krwRate}
              kisActive={snap.kisActive}
              analysisPending={analysisPending || pendingCodes.has(p.meta.code)}
              marketSemiHeat={snap.marketMood.semiHeat}
              priceOverride={realtimeFresh(p.meta.code)}
              tradeOverride={realtimeTradeFresh(p.meta.code)}
              onOpenDetailSheet={
                isMobile ? () => setSheetOpen(true) : undefined
              }
            />
          </div>
        ))}
        {/* 추가 직후 데이터 도착 전 placeholder 카드 — 종목명 + 로딩 안내 즉시 표시 */}
        {placeholderSymbols.map((s, i) => (
          <div
            key={`pending-${s.code}`}
            className="card-fade-in"
            style={{ animationDelay: `${(visiblePrimaries.length + i) * 60}ms` }}
          >
            <PendingStockCard name={s.name} />
          </div>
        ))}
        {visiblePrimaries.length === 0 && placeholderSymbols.length === 0 && (
          <div className="md:col-span-2 lg:col-span-3 text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-xl">
            {watchLoading
              ? "종목 데이터를 불러오는 중…"
              : "선택한 관심종목 데이터를 불러오는 중입니다."}
          </div>
        )}
      </div>

      {/* 통합 일정 — 임박(D-N) + 월별 캘린더 */}
      <UnifiedSchedulePanel snapshot={snap} />

      {/* 모바일 sheet 모달 — 자체적으로 lg:hidden 가드 + open 상태에 따라 슬라이드 인/아웃 */}
      <MobileDetailSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        snap={selectedSnap ?? null}
        allNews={snap.news}
        krwRate={krwRate}
        kisActive={snap.kisActive}
        marketSemiHeat={snap.marketMood.semiHeat}
      />

      {error && (
        <div className="rounded-xl border border-down/30 bg-down/10 text-down text-sm px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <span>{error}</span>
          {analysisGaveUp && (
            <button
              type="button"
              className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-down/40 bg-card text-foreground hover:bg-muted transition-colors"
              onClick={() => {
                analysisStartedAtRef.current = Date.now();
                setAnalysisGaveUp(false);
                setError(null);
                fullRetryCountRef.current = 0;
                inflightAnalysisKeyRef.current = null;
                setFullRetryNonce((n) => n + 1);
              }}
            >
              분석 다시 시도
            </button>
          )}
        </div>
      )}
      {!error && analysisGaveUp && snap.phase === "lite" && (
        <div className="rounded-xl border border-border bg-muted/30 text-muted-foreground text-sm px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <span>예측·수급 분석을 불러오지 못했어요. 시세는 유지됩니다.</span>
          <button
            type="button"
            className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-muted transition-colors"
            onClick={() => {
              analysisStartedAtRef.current = Date.now();
              setAnalysisGaveUp(false);
              fullRetryCountRef.current = 0;
              inflightAnalysisKeyRef.current = null;
              setFullRetryNonce((n) => n + 1);
            }}
          >
            분석 다시 시도
          </button>
        </div>
      )}

      {/* 시장 신호 + 이벤트 캘린더 — 차트는 카드별 sparkline 으로 대체되어 메인에서 제거됐다.
          (selected 종목의 풀 차트는 StockDetailPanel "예측" 탭에서 별도 노출 가능.) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MarketPanel indicators={snap.indicators} />
      </div>

      {/* 뉴스 — full snapshot + idle/2s defer */}
      {showNews ? (
        <NewsPanel
          items={snap.news}
          fetchFailed={snap.newsFetchFailed}
          onRetry={() => void refresh(undefined, undefined, true, false, "full")}
          selectedSymbol={
            selectedSnap
              ? { code: selectedSnap.meta.code, name: selectedSnap.meta.name }
              : null
          }
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
          {error
            ? "뉴스·분석을 아직 못 가져왔어요. 위 안내를 확인하거나 새로고침 해 주세요."
            : "뉴스 수집 중…"}
        </div>
      )}

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
