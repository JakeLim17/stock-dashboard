"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Layers,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  resolveThemes,
  type ThemeTag,
  type ResolvedTheme,
} from "@/lib/symbols";
import type {
  MarketIndicator,
  Recommendation,
  RecommendationsResponse,
  SignalMark,
  SymbolMeta,
} from "@/lib/types";
import { Badge } from "./ui/Badge";
import { Card, CardBody } from "./ui/Card";
import { SignalMarkBadges } from "./SignalMarkBadges";
import { changeColor, fmtPercent } from "@/lib/utils";

interface Props {
  // 시장 지표 — NVDA 등 MARKET_INDICATORS 종목의 등락률 데이터 (스냅샷에서 직접 전달)
  indicators: MarketIndicator[];
  // 부모 watchlist (테마 종목이 이미 있으면 "관심종목" 라벨, 없으면 "추가" 버튼)
  watchlist: string[];
  // 관심종목 추가 핸들러 — DashboardClient.commitWatch와 동일 시그니처
  onAddToWatchlist: (code: string) => void;
  maxWatch: number;
}

interface ThemeMemberView {
  meta: SymbolMeta;
  // /api/recommendations 또는 indicators에서 끌어온 라이브 데이터 (없을 수 있음)
  changeRate: number | null;
  price: number | null;
  rec?: Recommendation; // 워치리스트 후보 — 풀 분석 데이터
}

// 테마별 그룹 뷰 — 사용자가 "AI 반도체 묶음으로 한 번에 보고 싶다" 요구를 충족.
// 토글 펼침 + 테마 탭 + 종목 미니 카드 + 동조율(테마 평균/상승률 N/M).
//
// 데이터 흐름:
//   - 펼침 시 lazy fetch /api/recommendations (RecommendationsPanel과 같은 캐시 — 30분 TTL)
//   - 응답에 없는 코드(예: NVDA — MARKET_INDICATORS에만 있음)는 indicators에서 보완
//   - 둘 다 없으면 changeRate=null, "데이터 없음" 표시
export function ThemeGroupView({
  indicators,
  watchlist,
  onAddToWatchlist,
  maxWatch,
}: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTheme, setActiveTheme] = useState<ThemeTag | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchedOnce = useRef(false);

  const fetchData = useCallback(async (refresh = false) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/recommendations${refresh ? "?refresh=1" : ""}`,
        { cache: "no-store", signal: ctrl.signal }
      );
      if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
      const j = (await r.json()) as RecommendationsResponse;
      setData(j);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // 펼침 시 lazy fetch — 처음 열 때 한 번만
  useEffect(() => {
    if (!open) return;
    if (fetchedOnce.current) return;
    fetchedOnce.current = true;
    void fetchData(false);
  }, [open, fetchData]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // 코드 → 라이브 데이터 매핑
  const codeMap = useMemo(() => {
    const m = new Map<string, { rec?: Recommendation; ind?: MarketIndicator }>();
    if (data) {
      for (const r of data.items) m.set(r.code, { rec: r });
    }
    for (const i of indicators) {
      const e = m.get(i.code) ?? {};
      e.ind = i;
      m.set(i.code, e);
    }
    return m;
  }, [data, indicators]);

  // 가용 테마 — 적어도 1개 이상의 코드가 카탈로그에 잡히는 것만
  const themes = useMemo<ResolvedTheme[]>(() => resolveThemes(), []);

  // 활성 테마 기본값 — 첫 가용 테마
  useEffect(() => {
    if (activeTheme) return;
    if (themes.length === 0) return;
    setActiveTheme(themes[0].id);
  }, [activeTheme, themes]);

  // 활성 테마의 members + 라이브 데이터 결합
  const activeView = useMemo(() => {
    const t = themes.find((x) => x.id === activeTheme);
    if (!t) return null;
    const members: ThemeMemberView[] = t.members.map((meta) => {
      const live = codeMap.get(meta.code);
      const rec = live?.rec;
      const ind = live?.ind;
      return {
        meta,
        rec,
        price: rec?.price ?? ind?.value ?? null,
        changeRate: rec?.changeRate ?? ind?.changeRate ?? null,
      };
    });
    return { theme: t, members };
  }, [themes, activeTheme, codeMap]);

  // 동조율 — 데이터 있는 멤버들의 평균 등락률 / 상승 종목 수.
  const concord = useMemo(() => {
    if (!activeView) return null;
    const rates = activeView.members
      .map((m) => m.changeRate)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (rates.length === 0) return null;
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const ups = rates.filter((r) => r > 0).length;
    // 표준편차 — 낮을수록 동조율 높음
    const variance =
      rates.reduce((a, b) => a + (b - avg) * (b - avg), 0) / rates.length;
    const std = Math.sqrt(variance);
    // 동조도 점수: 평균이 같은 방향이고 std가 작을수록 높음. 0~100 환산.
    // |avg| 큰 + std 작을수록 ↑.
    const directionalStrength = Math.min(1, Math.abs(avg) * 100); // 1% 이동 → 1.0
    const consistency = std === 0 ? 1 : Math.max(0, 1 - std * 50); // std 2% → 0
    const score = Math.round((directionalStrength * 0.4 + consistency * 0.6) * 100);
    return {
      avg,
      ups,
      total: rates.length,
      std,
      score,
    };
  }, [activeView]);

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);

  return (
    <Card className="border-accent/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors rounded-2xl"
        aria-expanded={open}
      >
        <Layers className="h-4 w-4 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">테마별 보기</span>
            <span className="text-[11px] text-muted-foreground">
              {open
                ? `${themes.length}개 테마 · ${
                    activeView ? activeView.members.length : 0
                  }개 종목`
                : "AI 반도체·배터리·방산 등 묶음으로 보기"}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <CardBody className="pt-0 space-y-3">
          <div className="flex items-center gap-2 pt-2 border-t border-border/60">
            <p className="text-[11px] text-muted-foreground flex-1 min-w-0">
              테마 안 종목들의 평균 등락·상승 비율을 한눈에. 관심종목에 없는
              종목은 옆 ＋ 버튼으로 즉시 추가.
            </p>
            <button
              type="button"
              onClick={() => void fetchData(true)}
              disabled={loading}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border bg-card hover:bg-muted disabled:opacity-50 transition-colors"
              title="테마 분석 다시 불러오기 (캐시 무시)"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              />
              새로고침
            </button>
          </div>

          {/* 테마 탭 */}
          <div className="flex flex-wrap gap-1.5">
            {themes.map((t) => (
              <ThemeTab
                key={t.id}
                active={activeTheme === t.id}
                onClick={() => setActiveTheme(t.id)}
                emoji={t.emoji}
                label={t.label}
                count={t.members.length}
              />
            ))}
          </div>

          {/* 로딩 상태 — 데이터 없는 첫 진입 */}
          {loading && !data && (
            <div className="text-xs text-muted-foreground py-4 text-center inline-flex items-center justify-center gap-2 w-full">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              테마 분석 데이터 가져오는 중…
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg border border-down/30 bg-down/10 text-down text-xs px-3 py-2">
              {error} — 일부 종목 가격은 시장 지표만 표시됩니다.
            </div>
          )}

          {/* 활성 테마 본문 */}
          {activeView && (
            <div className="space-y-2.5">
              {/* 동조율 / 평균 등락 요약 */}
              {concord && (
                <ThemeSummary
                  theme={activeView.theme}
                  avg={concord.avg}
                  ups={concord.ups}
                  total={concord.total}
                  score={concord.score}
                />
              )}

              {/* 종목 미니 카드 grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {activeView.members.map((member) => (
                  <ThemeMemberCard
                    key={member.meta.code}
                    member={member}
                    inWatchlist={watchSet.has(member.meta.code)}
                    canAdd={
                      !watchSet.has(member.meta.code) &&
                      watchlist.length < maxWatch
                    }
                    onAdd={() => onAddToWatchlist(member.meta.code)}
                  />
                ))}
              </div>
            </div>
          )}

          {!activeView && !loading && !error && (
            <div className="text-xs text-muted-foreground py-4 text-center">
              표시할 테마가 없습니다.
            </div>
          )}
        </CardBody>
      )}
    </Card>
  );
}

function ThemeTab({
  active,
  emoji,
  label,
  count,
  onClick,
}: {
  active: boolean;
  emoji: string;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1 ${
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-card border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
      <span className="opacity-70 tabular">{count}</span>
    </button>
  );
}

// 테마 요약 — 평균 등락, 상승/전체, 동조율 점수.
// 평균이 같은 방향 + std 작을수록 동조율 ↑.
function ThemeSummary({
  theme,
  avg,
  ups,
  total,
  score,
}: {
  theme: { emoji: string; label: string; description?: string };
  avg: number;
  ups: number;
  total: number;
  score: number;
}) {
  const tone =
    avg >= 0.005 ? "good" : avg <= -0.005 ? "bad" : "neutral";
  const tonalRow =
    tone === "good"
      ? "border-up/30 bg-up/8"
      : tone === "bad"
        ? "border-down/30 bg-down/8"
        : "border-border bg-muted/30";
  // 동조율 점수 라벨
  const scoreLabel =
    score >= 70
      ? "강한 동조"
      : score >= 45
        ? "동조 중"
        : score >= 25
          ? "혼조"
          : "산개";
  return (
    <div
      className={`rounded-xl border px-3 py-2 flex items-center gap-3 flex-wrap ${tonalRow}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-base" aria-hidden>
          {theme.emoji}
        </span>
        <div>
          <div className="text-sm font-semibold leading-tight">
            {theme.label}
          </div>
          {theme.description && (
            <div className="text-[10px] text-muted-foreground leading-tight">
              {theme.description}
            </div>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3 flex-wrap text-xs">
        <div>
          <span className="text-muted-foreground">평균 </span>
          <span className={`font-semibold tabular ${changeColor(avg)}`}>
            {fmtPercent(avg, 2)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">상승 </span>
          <span className="font-semibold tabular">
            {ups}/{total}
          </span>
        </div>
        <div className="inline-flex items-center gap-1">
          <span className="text-muted-foreground">동조율 </span>
          <span className="font-semibold tabular">{score}</span>
          <span className="text-[10px] text-muted-foreground">({scoreLabel})</span>
        </div>
      </div>
    </div>
  );
}

// 테마 멤버 미니 카드 — 종목명, 가격/등락, 시그널 마크, 추가 버튼.
function ThemeMemberCard({
  member,
  inWatchlist,
  canAdd,
  onAdd,
}: {
  member: ThemeMemberView;
  inWatchlist: boolean;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const { meta, rec, changeRate, price } = member;
  const signalMarks: SignalMark[] | undefined = rec?.signalMarks;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 space-y-1.5 hover:border-foreground/20 transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold truncate">{meta.name}</span>
            {rec?.verdict && (
              <Badge variant={rec.verdict.tone} size="sm">
                {rec.verdict.label}
              </Badge>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground tabular">
            {meta.code}
            {meta.sector && <span> · {meta.sector}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          {price != null ? (
            <div className="text-sm font-semibold tabular leading-tight">
              {price.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground leading-tight">—</div>
          )}
          {changeRate != null ? (
            <div
              className={`text-[11px] tabular ${changeColor(changeRate)}`}
            >
              {fmtPercent(changeRate, 2)}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">데이터 없음</div>
          )}
        </div>
      </div>
      {signalMarks && signalMarks.length > 0 && (
        <SignalMarkBadges marks={signalMarks} size="xs" />
      )}
      <div className="flex items-center justify-end pt-0.5">
        {inWatchlist ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground px-2 py-0.5 rounded-md border border-border bg-muted/40">
            <Check className="h-3 w-3" />
            관심종목
          </span>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            disabled={!canAdd}
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={canAdd ? "관심종목에 추가" : "관심종목이 가득 찼습니다"}
          >
            <Plus className="h-3 w-3" />
            추가
          </button>
        )}
      </div>
    </div>
  );
}
