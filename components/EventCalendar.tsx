"use client";

import { useMemo, useState } from "react";
import type { DashboardSnapshot, EventItem, EventKind } from "@/lib/types";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { CalendarDays, ChevronDown, ChevronUp } from "lucide-react";

// 이벤트 캘린더 — DashboardSnapshot 의 종목별 upcomingEvents + 매크로 macroEvents 를 합쳐서
// 다음 7일(기본) 또는 30일을 날짜 오름차순으로 보여준다.
//
// 색상·아이콘은 종류별 분기:
//   earnings     accent  📊
//   dividend     good    💰
//   fomc         warn    🇺🇸
//   kospi_expiry neutral 🔁
//   holiday      muted   🌙
//
// 사용자 페인 포인트: "다음 주에 무슨 이벤트가 있는지" 한눈에 알고 매매 호흡을 조절.

interface Props {
  snapshot: DashboardSnapshot;
}

interface EventStyle {
  emoji: string;
  variant: "good" | "warn" | "buy" | "neutral" | "bad";
  shortKindLabel: string;
}

const STYLE_BY_KIND: Record<EventKind, EventStyle> = {
  earnings: { emoji: "📊", variant: "buy", shortKindLabel: "실적" },
  dividend: { emoji: "💰", variant: "good", shortKindLabel: "배당" },
  fomc: { emoji: "🇺🇸", variant: "warn", shortKindLabel: "FOMC" },
  kospi_expiry: { emoji: "🔁", variant: "neutral", shortKindLabel: "만기" },
  holiday: { emoji: "🌙", variant: "neutral", shortKindLabel: "휴장" },
  // Fix4 — 매크로 이벤트 추가 (한국 금통위/미 CPI·PPI·NFP/한국 수출입)
  bok_rate: { emoji: "🏦", variant: "warn", shortKindLabel: "금통위" },
  us_cpi: { emoji: "📈", variant: "warn", shortKindLabel: "CPI" },
  us_ppi: { emoji: "🏭", variant: "neutral", shortKindLabel: "PPI" },
  us_nfp: { emoji: "💼", variant: "warn", shortKindLabel: "고용" },
  kr_trade: { emoji: "🚢", variant: "neutral", shortKindLabel: "수출입" },
};

export function EventCalendar({ snapshot }: Props) {
  const [expanded, setExpanded] = useState(false);
  // open=true 일 때만 패널을 펼친다. 기본 펼침 (사용자 즉시 확인 가치).
  const [open, setOpen] = useState(true);

  const allEvents = useMemo(() => {
    const symbolEvents = snapshot.primaries.flatMap(
      (p) => p.upcomingEvents ?? []
    );
    const macroEvents = snapshot.macroEvents ?? [];
    // 종목별 + 매크로 합쳐 날짜 오름차순. 같은 날짜는 importance high → medium → low
    return [...symbolEvents, ...macroEvents].sort((a, b) => {
      if (a.date !== b.date) return a.date - b.date;
      return importanceRank(a.importance) - importanceRank(b.importance);
    });
  }, [snapshot.primaries, snapshot.macroEvents]);

  // 기본 4건 + 더보기로 60일 전체. 사용자 요청: "각각 3~4개씩만 보여주고 더보기로".
  // 좌(시장신호 default 4개) 와 행 높이 매칭.
  const DEFAULT_LIMIT = 4;
  const cutoffMs = Date.now() + (expanded ? 60 : 30) * 86_400_000;
  const filtered = allEvents.filter((e) => e.date <= cutoffMs);
  const visible = expanded ? filtered : filtered.slice(0, DEFAULT_LIMIT);
  const hiddenCount = allEvents.length - visible.length;

  if (allEvents.length === 0) {
    // 데이터가 아예 없으면 패널 자체를 숨김 (조용한 실패 — 야후가 한국 종목 비웠을 때 빈 카드 방지)
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">다가올 이벤트</h2>
          <span className="text-xs text-muted-foreground">
            ({allEvents.length}건)
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
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
        <CardBody className="space-y-1.5">
          {visible.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              {expanded ? "60일" : "30일"} 이내 이벤트 없음
            </p>
          ) : (
            visible.map((e, i) => <EventRow key={rowKey(e, i)} event={e} />)
          )}
          {hiddenCount > 0 && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-xs text-accent hover:underline mt-1 inline-flex items-center gap-1"
            >
              {hiddenCount}건 더 보기 (60일 기준)
            </button>
          )}
          {expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-xs text-muted-foreground hover:underline mt-1"
            >
              접기
            </button>
          )}
          <p className="text-[10px] text-muted-foreground/80 leading-snug pt-1">
            ※ 실적·배당은 야후 일정 — 한국 종목은 누락 가능. 옵션 만기는 두 번째
            목요일 기본(휴장 시 직전 영업일).
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function rowKey(e: EventItem, i: number): string {
  return `${e.kind}-${e.symbolCode ?? "macro"}-${e.date}-${i}`;
}

function importanceRank(level: "high" | "medium" | "low"): number {
  if (level === "high") return 0;
  if (level === "medium") return 1;
  return 2;
}

function EventRow({ event }: { event: EventItem }) {
  const style = STYLE_BY_KIND[event.kind];
  const dn = daysUntil(event.date);
  const dLabel = dnLabel(dn);
  // D-day 강조 (오늘 또는 D-1) — 추가 톤
  const isUrgent = dn <= 1;

  return (
    <div className="flex items-center gap-2 py-1 border-b border-border/50 last:border-b-0">
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
          {dLabel}
        </div>
        <div className="text-[10px] text-muted-foreground tabular">
          {fmtDate(event.date)}
        </div>
      </div>
    </div>
  );
}

// 오늘(KST) 자정 기준 D-N. 미래 → 양수, 과거 → 음수.
function daysUntil(epochMs: number): number {
  // 클라이언트 로컬 자정으로 비교 — 사용자 체감과 일치
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // event.date 는 KST 자정 UTC ms. 사용자 로컬이 KST 가 아닐 때도 차이는 1일 이내라 OK.
  return Math.round((epochMs - todayMid) / 86_400_000);
}

export function dnLabel(d: number): string {
  if (d === 0) return "D-day";
  if (d < 0) return `D+${-d}`;
  return `D-${d}`;
}

function fmtDate(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
