"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardSnapshot, EventItem, EventKind } from "@/lib/types";
import type { ScheduleEntry, ScheduleKind } from "@/lib/monthly-schedule-types";
import { dnLabel } from "./EventCalendar";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";

type ViewTab = "upcoming" | "monthly";
type FilterTab = "all" | "macro" | "earnings" | "holiday";

const MACRO_KINDS: ScheduleKind[] = [
  "fomc",
  "bok_rate",
  "us_cpi",
  "us_ppi",
  "us_nfp",
  "kr_trade",
  "kospi_expiry",
];

interface EventStyle {
  emoji: string;
  variant: "good" | "warn" | "buy" | "neutral" | "bad";
  shortKindLabel: string;
  filterTab: FilterTab;
}

const EVENT_STYLE: Record<EventKind, EventStyle> = {
  earnings: { emoji: "📊", variant: "buy", shortKindLabel: "실적", filterTab: "earnings" },
  dividend: { emoji: "💰", variant: "good", shortKindLabel: "배당", filterTab: "earnings" },
  fomc: { emoji: "🇺🇸", variant: "warn", shortKindLabel: "FOMC", filterTab: "macro" },
  kospi_expiry: { emoji: "🔁", variant: "neutral", shortKindLabel: "만기", filterTab: "macro" },
  holiday: { emoji: "🌙", variant: "neutral", shortKindLabel: "휴장", filterTab: "holiday" },
  bok_rate: { emoji: "🏦", variant: "warn", shortKindLabel: "금통위", filterTab: "macro" },
  us_cpi: { emoji: "📈", variant: "warn", shortKindLabel: "CPI", filterTab: "macro" },
  us_ppi: { emoji: "🏭", variant: "neutral", shortKindLabel: "PPI", filterTab: "macro" },
  us_nfp: { emoji: "💼", variant: "warn", shortKindLabel: "고용", filterTab: "macro" },
  kr_trade: { emoji: "🚢", variant: "neutral", shortKindLabel: "수출입", filterTab: "macro" },
};

const SCHEDULE_STYLE: Record<ScheduleKind, EventStyle & { tab: FilterTab }> = {
  earnings: { ...EVENT_STYLE.earnings, tab: "earnings" },
  dividend: { ...EVENT_STYLE.dividend, tab: "earnings" },
  fomc: { ...EVENT_STYLE.fomc, tab: "macro" },
  kospi_expiry: { ...EVENT_STYLE.kospi_expiry, tab: "macro" },
  holiday: { ...EVENT_STYLE.holiday, tab: "holiday" },
  bok_rate: { ...EVENT_STYLE.bok_rate, tab: "macro" },
  us_cpi: { ...EVENT_STYLE.us_cpi, tab: "macro" },
  us_ppi: { ...EVENT_STYLE.us_ppi, tab: "macro" },
  us_nfp: { ...EVENT_STYLE.us_nfp, tab: "macro" },
  kr_trade: { ...EVENT_STYLE.kr_trade, tab: "macro" },
  custom: { emoji: "📌", variant: "neutral", shortKindLabel: "일정", filterTab: "macro", tab: "macro" },
  conference: { emoji: "🌐", variant: "neutral", shortKindLabel: "회의", filterTab: "macro", tab: "macro" },
  ipo: { emoji: "🚀", variant: "buy", shortKindLabel: "상장", filterTab: "earnings", tab: "earnings" },
};

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "macro", label: "거시" },
  { id: "earnings", label: "실적" },
  { id: "holiday", label: "휴장" },
];

const CLIENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function nowKstParts(): { year: number; month: number } {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return { year: kst.getUTCFullYear(), month: kst.getUTCMonth() + 1 };
}

function importanceRank(level: "high" | "medium" | "low"): number {
  if (level === "high") return 0;
  if (level === "medium") return 1;
  return 2;
}

function daysUntil(epochMs: number): number {
  const now = new Date();
  const todayMid = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  return Math.round((epochMs - todayMid) / 86_400_000);
}

function fmtDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateRange(startMs: number, endMs?: number): string {
  const fmt = (ms: number) => {
    const kst = new Date(ms + 9 * 3600 * 1000);
    return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
  };
  if (endMs != null && endMs !== startMs) {
    return `${fmt(startMs)} – ${fmt(endMs)}`;
  }
  return fmt(startMs);
}

function collectUpcomingEvents(snapshot: DashboardSnapshot): EventItem[] {
  const symbolEvents = snapshot.primaries.flatMap(
    (p) => p.upcomingEvents ?? []
  );
  const macroEvents = snapshot.macroEvents ?? [];
  const seen = new Set<string>();
  const out: EventItem[] = [];
  for (const e of [...symbolEvents, ...macroEvents]) {
    const key = `${e.kind}|${e.symbolCode ?? ""}|${e.date}|${e.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date - b.date;
    return importanceRank(a.importance) - importanceRank(b.importance);
  });
}

function matchesEventFilter(e: EventItem, tab: FilterTab): boolean {
  if (tab === "all") return true;
  const style = EVENT_STYLE[e.kind];
  if (tab === "holiday") return e.kind === "holiday";
  return style.filterTab === tab;
}

function matchesScheduleFilter(e: ScheduleEntry, tab: FilterTab): boolean {
  if (tab === "all") return true;
  const style = SCHEDULE_STYLE[e.kind];
  if (tab === "holiday") return e.isHoliday === true || e.kind === "holiday";
  return style.tab === tab;
}

interface Props {
  snapshot: DashboardSnapshot;
}

export function UnifiedSchedulePanel({ snapshot }: Props) {
  const initial = nowKstParts();
  const [view, setView] = useState<ViewTab>("upcoming");
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [monthlyItems, setMonthlyItems] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const clientCache = useRef(
    new Map<string, { items: ScheduleEntry[]; at: number }>()
  );

  const upcomingAll = useMemo(
    () => collectUpcomingEvents(snapshot),
    [snapshot]
  );

  const loadMonthly = useCallback(async (y: number, m: number) => {
    const cacheKey = `${y}-${m}`;
    const hit = clientCache.current.get(cacheKey);
    if (hit && Date.now() - hit.at < CLIENT_CACHE_TTL_MS) {
      setMonthlyItems(hit.items);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule?year=${y}&month=${m}`);
      if (!res.ok) throw new Error("일정을 불러오지 못했습니다");
      const data = (await res.json()) as {
        year: number;
        month: number;
        items: ScheduleEntry[];
      };
      clientCache.current.set(cacheKey, { items: data.items, at: Date.now() });
      setMonthlyItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
      setMonthlyItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || view !== "monthly") return;
    void loadMonthly(year, month);
  }, [year, month, loadMonthly, open, view]);

  const cutoffMs = Date.now() + (expanded ? 60 : 30) * 86_400_000;
  const upcomingFiltered = upcomingAll
    .filter((e) => e.date <= cutoffMs)
    .filter((e) => matchesEventFilter(e, filter));
  const upcomingVisible = expanded
    ? upcomingFiltered
    : upcomingFiltered.slice(0, 6);

  const monthlyFiltered = monthlyItems.filter((e) =>
    matchesScheduleFilter(e, filter)
  );

  const title =
    view === "upcoming" ? "다가올 일정" : `${month}월 주요 일정`;

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setYear(y);
    setMonth(m);
  }

  if (upcomingAll.length === 0 && view === "upcoming" && !open) {
    return null;
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-accent shrink-0" />
            <h2 className="text-sm font-semibold">{title}</h2>
            {view === "upcoming" && (
              <span className="text-xs text-muted-foreground">
                ({upcomingAll.length}건)
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            거시·실적·휴장·커스텀 — 임박 일정과 월별 캘린더를 한곳에서 봅니다
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
          aria-expanded={open}
        >
          {open ? (
            <>
              <ChevronUp className="h-3 w-3" />
              접기
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              펼치기
            </>
          )}
        </button>
      </CardHeader>

      {open && (
        <CardBody className="space-y-3 pt-0">
          <div className="flex gap-1 p-0.5 rounded-lg bg-muted/50 border border-border/60">
            <button
              type="button"
              onClick={() => setView("upcoming")}
              className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                view === "upcoming"
                  ? "bg-background shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              임박 (D-N)
            </button>
            <button
              type="button"
              onClick={() => setView("monthly")}
              className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                view === "monthly"
                  ? "bg-background shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              월별
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {FILTER_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  filter === t.id
                    ? "bg-accent text-white border-accent"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {view === "monthly" && (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                aria-label="이전 달"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium tabular">
                {year}년 {month}월
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                aria-label="다음 달"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {view === "upcoming" ? (
            upcomingFiltered.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                {expanded ? "60일" : "30일"} 이내 일정 없음
              </p>
            ) : (
              <ul className="space-y-0 divide-y divide-border/60">
                {upcomingVisible.map((e, i) => (
                  <UpcomingRow key={`${e.kind}-${e.date}-${i}`} event={e} />
                ))}
              </ul>
            )
          ) : loading ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              일정 불러오는 중…
            </p>
          ) : error ? (
            <p className="text-xs text-down py-2">{error}</p>
          ) : monthlyFiltered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              이 달에 해당하는 일정이 없습니다
            </p>
          ) : (
            <ul className="space-y-0 divide-y divide-border/60">
              {monthlyFiltered.map((e) => (
                <MonthlyRow key={e.id} entry={e} />
              ))}
            </ul>
          )}

          {view === "upcoming" &&
            upcomingFiltered.length > upcomingVisible.length &&
            !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-xs text-accent hover:underline"
              >
                {upcomingFiltered.length - upcomingVisible.length}건 더 보기
                (60일)
              </button>
            )}
          {view === "upcoming" && expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-xs text-muted-foreground hover:underline"
            >
              접기
            </button>
          )}

          <p className="text-[10px] text-muted-foreground/80 leading-snug pt-1 border-t border-border/50">
            ※ 일정은 상황에 따라 변경될 수 있습니다. 실적·배당은 야후 일정
            기준이며 한국 종목은 누락될 수 있습니다.
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function UpcomingRow({ event }: { event: EventItem }) {
  const style = EVENT_STYLE[event.kind];
  const dn = daysUntil(event.date);
  const isUrgent = dn <= 1;

  return (
    <li className="flex items-center gap-2 py-2 first:pt-0">
      <span className="text-lg shrink-0" aria-hidden>
        {style.emoji}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant={style.variant} size="sm">
            {style.shortKindLabel}
          </Badge>
          <span className="text-sm font-medium truncate">{event.label}</span>
        </div>
        {event.detail && (
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
            {event.detail}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <div
          className={`text-xs tabular font-semibold ${
            isUrgent ? "text-warn" : "text-foreground"
          }`}
        >
          {dnLabel(dn)}
        </div>
        <div className="text-[10px] text-muted-foreground tabular">
          {fmtDate(event.date)}
        </div>
      </div>
    </li>
  );
}

function MonthlyRow({ entry }: { entry: ScheduleEntry }) {
  const style = SCHEDULE_STYLE[entry.kind];
  const dateLabel = formatDateRange(entry.startDate, entry.endDate);

  return (
    <li className="flex items-start gap-2.5 py-2.5 first:pt-0">
      <span className="text-lg shrink-0 leading-none mt-0.5" aria-hidden>
        {style.emoji}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant={style.variant} size="sm">
            {style.shortKindLabel}
          </Badge>
          {entry.isHoliday && (
            <span className="text-[10px] font-semibold text-down">(휴장)</span>
          )}
          <span className="text-sm font-medium leading-snug">{entry.label}</span>
        </div>
        {entry.detail && (
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
            {entry.detail}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-semibold tabular text-foreground">
          {dateLabel}
        </div>
      </div>
    </li>
  );
}
