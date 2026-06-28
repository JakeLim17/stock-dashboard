"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScheduleEntry, ScheduleKind } from "@/lib/monthly-schedule-types";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";

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

interface ApiResponse {
  year: number;
  month: number;
  items: ScheduleEntry[];
}

interface Style {
  emoji: string;
  variant: "good" | "warn" | "buy" | "neutral" | "bad";
  tab: FilterTab;
  shortLabel: string;
}

const STYLE: Record<ScheduleKind, Style> = {
  earnings: { emoji: "📊", variant: "buy", tab: "earnings", shortLabel: "실적" },
  dividend: { emoji: "💰", variant: "good", tab: "earnings", shortLabel: "배당" },
  fomc: { emoji: "🇺🇸", variant: "warn", tab: "macro", shortLabel: "FOMC" },
  bok_rate: { emoji: "🇰🇷", variant: "warn", tab: "macro", shortLabel: "금통위" },
  us_cpi: { emoji: "🇺🇸", variant: "warn", tab: "macro", shortLabel: "CPI" },
  us_ppi: { emoji: "🇺🇸", variant: "neutral", tab: "macro", shortLabel: "PPI" },
  us_nfp: { emoji: "🇺🇸", variant: "warn", tab: "macro", shortLabel: "NFP" },
  kr_trade: { emoji: "🇰🇷", variant: "neutral", tab: "macro", shortLabel: "수출입" },
  kospi_expiry: { emoji: "🔁", variant: "neutral", tab: "macro", shortLabel: "만기" },
  holiday: { emoji: "🌙", variant: "neutral", tab: "holiday", shortLabel: "휴장" },
  custom: { emoji: "📌", variant: "neutral", tab: "macro", shortLabel: "일정" },
  conference: { emoji: "🌐", variant: "neutral", tab: "macro", shortLabel: "회의" },
  ipo: { emoji: "🚀", variant: "buy", tab: "earnings", shortLabel: "상장" },
};

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "macro", label: "거시" },
  { id: "earnings", label: "실적" },
  { id: "holiday", label: "휴장" },
];

function nowKstParts(): { year: number; month: number } {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return { year: kst.getUTCFullYear(), month: kst.getUTCMonth() + 1 };
}

function matchesFilter(entry: ScheduleEntry, tab: FilterTab): boolean {
  if (tab === "all") return true;
  const style = STYLE[entry.kind];
  if (tab === "holiday") return entry.isHoliday === true || entry.kind === "holiday";
  return style.tab === tab;
}

const CLIENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — 달 이동 시 재호출 최소화

export function MonthlySchedulePanel() {
  const initial = nowKstParts();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [items, setItems] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [open, setOpen] = useState(true);
  const clientCache = useRef(
    new Map<string, { items: ScheduleEntry[]; at: number }>()
  );

  const load = useCallback(async (y: number, m: number) => {
    const cacheKey = `${y}-${m}`;
    const hit = clientCache.current.get(cacheKey);
    if (hit && Date.now() - hit.at < CLIENT_CACHE_TTL_MS) {
      setItems(hit.items);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule?year=${y}&month=${m}`);
      if (!res.ok) throw new Error("일정을 불러오지 못했습니다");
      const data = (await res.json()) as ApiResponse;
      clientCache.current.set(cacheKey, { items: data.items, at: Date.now() });
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load(year, month);
  }, [year, month, load, open]);

  const filtered = useMemo(
    () => items.filter((e) => matchesFilter(e, filter)),
    [items, filter]
  );

  const title = `${month}월 주요 일정`;

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

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-accent shrink-0" />
            <h2 className="text-sm font-semibold">{title}</h2>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            거시·실적·휴장·커스텀 — 「다가올 이벤트」와 별도로 월 전체 일정을 봅니다
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

          {loading ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              일정 불러오는 중…
            </p>
          ) : error ? (
            <p className="text-xs text-down py-2">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              이 달에 해당하는 일정이 없습니다
            </p>
          ) : (
            <ul className="space-y-0 divide-y divide-border/60">
              {filtered.map((e) => (
                <ScheduleRow key={e.id} entry={e} />
              ))}
            </ul>
          )}

          <p className="text-[10px] text-muted-foreground/80 leading-snug pt-1 border-t border-border/50">
            ※ 일정은 상황에 따라 변경될 수 있습니다. 실적·배당은 야후 일정 기준이며
            한국 종목은 누락될 수 있습니다.
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function ScheduleRow({ entry }: { entry: ScheduleEntry }) {
  const style = STYLE[entry.kind];
  const dateLabel = formatDateRange(entry.startDate, entry.endDate);

  return (
    <li className="flex items-start gap-2.5 py-2.5 first:pt-0">
      <span className="text-lg shrink-0 leading-none mt-0.5" aria-hidden>
        {style.emoji}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant={style.variant} size="sm">
            {style.shortLabel}
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

function formatDateRange(startMs: number, endMs?: number): string {
  const fmt = (ms: number) => {
    const kst = new Date(ms + 9 * 3600 * 1000);
    const m = kst.getUTCMonth() + 1;
    const d = kst.getUTCDate();
    return `${m}/${d}`;
  };
  if (endMs != null && endMs !== startMs) {
    return `${fmt(startMs)} – ${fmt(endMs)}`;
  }
  return fmt(startMs);
}
