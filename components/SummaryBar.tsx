"use client";

import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { Badge } from "./ui/Badge";
import { changeColor, fmtNumber, fmtPercent, marketStateLabel } from "@/lib/utils";
import { Activity, AlertTriangle, Newspaper } from "lucide-react";

interface Props {
  snapshot: DashboardSnapshot;
  lastUpdatedLabel?: string;
}

export function SummaryBar({ snapshot, lastUpdatedLabel }: Props) {
  const fx = snapshot.indicators.find((i) => i.code === "KRW=X");
  const nq = snapshot.indicators.find((i) => i.code === "NQ=F");
  const newsCount = snapshot.news.length;
  const mood = snapshot.marketMood;
  // 한국장 상태는 첫번째 관심종목의 marketState 기준
  const krState = snapshot.primaries[0]?.quote.marketState;
  const krMarket = marketStateLabel(krState);

  return (
    <div className="bg-card border border-border rounded-2xl px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3 shadow-sm">
      <Clock />
      <Stat
        label="한국장"
        value={
          <span className="inline-flex items-center gap-1.5">
            <Badge variant={krMarket.variant} size="md">{krMarket.label}</Badge>
            {krMarket.hint && (
              <span className="text-[11px] text-warn">{krMarket.hint}</span>
            )}
          </span>
        }
      />
      <Stat label="시장 분위기" value={<MoodBadge mood={mood.label} />} />
      <Stat
        label="반도체 과열도"
        value={
          <span className="tabular text-base font-semibold">
            {mood.semiHeat}
            <span className="text-xs text-muted-foreground ml-1">/100</span>
          </span>
        }
      />
      {fx && (
        <Stat
          label="달러/원"
          value={
            <span className={`tabular text-base font-semibold ${changeColor(fx.changeRate)}`}>
              {fmtNumber(fx.value, 2)}{" "}
              <span className="text-xs">({fmtPercent(fx.changeRate)})</span>
            </span>
          }
        />
      )}
      {nq && (
        <Stat
          label="나스닥 선물"
          value={
            <span className={`tabular text-base font-semibold ${changeColor(nq.changeRate)}`}>
              {fmtPercent(nq.changeRate)}
            </span>
          }
        />
      )}
      <Stat
        label="오늘 뉴스"
        value={
          <span className="inline-flex items-center gap-1">
            <Newspaper className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="tabular text-base font-semibold">{newsCount}</span>
          </span>
        }
      />
      {mood.riskKeywords.length > 0 && (
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-warn" />
          {mood.riskKeywords.map((k) => (
            <Badge key={k} variant="warn">
              {k}
            </Badge>
          ))}
        </div>
      )}
      {lastUpdatedLabel && (
        <div className="ml-auto text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Activity className="h-3 w-3" />
          {lastUpdatedLabel}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function MoodBadge({ mood }: { mood: "강세" | "중립" | "약세" }) {
  if (mood === "강세") return <Badge variant="good" size="md">강세</Badge>;
  if (mood === "약세") return <Badge variant="bad" size="md">약세</Badge>;
  return <Badge variant="neutral" size="md">중립</Badge>;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const label = now.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const date = now.toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">현재 시각</span>
      <span className="tabular text-base font-semibold">
        {label} <span className="text-xs text-muted-foreground ml-1">{date}</span>
      </span>
    </div>
  );
}
