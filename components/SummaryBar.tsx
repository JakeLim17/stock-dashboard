"use client";

import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { Badge } from "./ui/Badge";
import { changeColor, fmtNumber, fmtPercent, marketDisplayLabel } from "@/lib/utils";
import { Activity, AlertTriangle, Newspaper } from "lucide-react";

interface Props {
  snapshot: DashboardSnapshot;
  lastUpdatedLabel?: string;
}

export function SummaryBar({ snapshot, lastUpdatedLabel }: Props) {
  const fx = snapshot.indicators.find((i) => i.code === "KRW=X");
  const nq = snapshot.indicators.find((i) => i.code === "NQ=F");
  const kospi = snapshot.indicators.find((i) => i.code === "^KS11");
  const kosdaq = snapshot.indicators.find((i) => i.code === "^KQ11");
  const newsCount = snapshot.news.length;
  const mood = snapshot.marketMood;
  // 한국장 상태는 한국 종목 중 첫 번째 quote 기준 (시간외 활성도 함께 반영)
  const krQuote =
    snapshot.primaries.find((p) => p.meta.kind === "kr-stock")?.quote ??
    snapshot.primaries[0]?.quote;
  const krMarket = marketDisplayLabel(krQuote ?? {});

  // 지수 신선도 — KIS는 priceTime을 즉시(방금) 박아주고 Yahoo는 거래소 시각.
  // 차이가 작으면 "방금", 크면 "N분 전". MarketPanel과 동일 로직을 짧게 노출.
  // 장 마감(PREPRE/POSTPOST/CLOSED) 상태에서는 시각이 7시간+ 전이라 의미 없음 →
  // "종가 기준" 카피로 단축. priceFreshness 와 동일한 분기 기준을 사용.
  function freshLabel(ind: typeof kospi): string | null {
    if (!ind?.priceTime) return null;
    const stateUpper = (ind.marketState ?? "").toUpperCase();
    const isClosed =
      stateUpper === "PREPRE" ||
      stateUpper === "POSTPOST" ||
      stateUpper === "CLOSED";
    if (isClosed) return "종가 기준";
    const diff = Date.now() - ind.priceTime;
    if (diff < 30_000) return "방금";
    if (diff < 60_000) return "1분 전";
    if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}분 전`;
    return null;
  }

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
      {kospi && (
        <Stat
          label="코스피"
          value={
            <span className="inline-flex items-baseline gap-1">
              <span className={`tabular text-base font-semibold ${changeColor(kospi.changeRate)}`}>
                {fmtNumber(kospi.value, 2)}
              </span>
              <span className={`text-xs tabular ${changeColor(kospi.changeRate)}`}>
                ({fmtPercent(kospi.changeRate)})
              </span>
              {freshLabel(kospi) && (
                <span className="text-[10px] text-muted-foreground ml-1">
                  · {freshLabel(kospi)}
                </span>
              )}
            </span>
          }
        />
      )}
      {kosdaq && (
        <Stat
          label="코스닥"
          value={
            <span className="inline-flex items-baseline gap-1">
              <span className={`tabular text-base font-semibold ${changeColor(kosdaq.changeRate)}`}>
                {fmtNumber(kosdaq.value, 2)}
              </span>
              <span className={`text-xs tabular ${changeColor(kosdaq.changeRate)}`}>
                ({fmtPercent(kosdaq.changeRate)})
              </span>
              {freshLabel(kosdaq) && (
                <span className="text-[10px] text-muted-foreground ml-1">
                  · {freshLabel(kosdaq)}
                </span>
              )}
            </span>
          }
        />
      )}
      <Stat
        label="반도체 과열도"
        value={
          // SOX·NVDA 데이터가 모두 들어와야만 계산됨. 결손 시 mood.semiHeat=null → "—" 표시.
          // 값이 있을 때는 0(급랭)·50(중립)·100(과열) 의미를 한눈에 알 수 있도록 톤 라벨 동반.
          // (사용자가 "0/100" 을 "데이터 없음" 으로 오해하는 사례 방지.)
          mood.semiHeat != null ? (
            <span
              className="tabular text-base font-semibold inline-flex items-baseline gap-1"
              title="SOX·NVDA 평균 등락률을 0~100으로 환산. 50=중립, 0=급랭, 100=과열."
            >
              <span className={semiHeatTone(mood.semiHeat).color}>
                {mood.semiHeat}
              </span>
              <span className="text-xs text-muted-foreground">/100</span>
              <span className={`text-[10px] ml-1 ${semiHeatTone(mood.semiHeat).color}`}>
                {semiHeatTone(mood.semiHeat).label}
              </span>
            </span>
          ) : (
            <span
              className="tabular text-base font-semibold text-muted-foreground"
              title="SOX 또는 NVDA 데이터 대기 중 — 다음 갱신에서 채워집니다"
            >
              —
            </span>
          )
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

// 반도체 과열도 점수를 짧은 톤 라벨 + 색으로 환산.
// 0/100 같은 극단값이 "데이터 없음" 이 아니라 실제 시장 상태임을 시각적으로 보강.
function semiHeatTone(v: number): { label: string; color: string } {
  if (v <= 20) return { label: "급랭", color: "text-down" };
  if (v <= 40) return { label: "약세", color: "text-muted-foreground" };
  if (v <= 60) return { label: "중립", color: "text-foreground" };
  if (v <= 80) return { label: "강세", color: "text-up" };
  return { label: "과열", color: "text-warn" };
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
