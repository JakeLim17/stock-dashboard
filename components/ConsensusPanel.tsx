"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AnalystConsensus,
  AnalystReport,
  StockSnapshot,
} from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { changeColor, fmtNumber, fmtPercent } from "@/lib/utils";
import {
  Target,
  Users,
  ScrollText,
  Building2,
  TableProperties,
} from "lucide-react";

// 컨센서스 / 밸류에이션 / 리서치 / 증권사별 표 — 선택된 종목 1개의 펀더멘털 보조 데이터.
//
// 3-way 토글 (KR / US / 통합) — 컨센서스 데이터 출처를 사용자가 직접 비교.
//   - KR  : wisereport 국내 증권사 평균
//   - US  : Yahoo quoteSummary 외국계 broker 평균
//   - 통합: 두 평균의 카운트 가중평균
// 디폴트는 한국 종목이면 KR, 미국 종목이면 US. 데이터 없는 view는 자동 비활성.
//
// 데이터 출처: Yahoo quoteSummary + wisereport + 네이버 integration (6시간 캐시).
export function ConsensusPanel({
  snap,
  embedded = false,
}: {
  snap?: StockSnapshot | null;
  // StockDetailPanel 내부에 임베드되어 있을 때 true. 헤더의 verdict 부분을 숨겨
  // 부모 헤더와 중복을 피한다.
  embedded?: boolean;
}) {
  if (!snap) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>컨센서스 · 밸류에이션</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-muted-foreground">
            종목을 선택하세요.
          </p>
        </CardBody>
      </Card>
    );
  }

  const c = snap.consensus;
  const v = snap.consensusValuation;
  const researches = snap.researches ?? [];
  const price = snap.quote.price;
  const hasAnything = !!c || !!v || researches.length > 0;

  const inner = (
    <>
      {!hasAnything ? (
        <p className="text-sm text-muted-foreground">
          컨센서스/밸류에이션 데이터를 불러오지 못했습니다. 일부 종목은 Yahoo·네이버에서 제공되지 않을 수 있습니다.
        </p>
      ) : (
        <div className="space-y-5">
          {c && <ConsensusThreeWaySection consensus={c} stockCode={snap.meta.code} price={price} />}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-5">
            {v && (
              <Section
                title="밸류에이션"
                icon={<Building2 className="h-3.5 w-3.5" />}
              >
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <MiniMetric
                    label="PER"
                    value={v.per != null ? `${v.per.toFixed(2)}배` : "—"}
                  />
                  <MiniMetric
                    label="추정 PER"
                    value={v.forwardPer != null ? `${v.forwardPer.toFixed(2)}배` : "—"}
                    color={
                      v.forwardPer != null && v.forwardPer < 10
                        ? "text-up"
                        : v.forwardPer != null && v.forwardPer > 25
                          ? "text-down"
                          : ""
                    }
                  />
                  <MiniMetric
                    label="PBR"
                    value={v.pbr != null ? `${v.pbr.toFixed(2)}배` : "—"}
                  />
                  <MiniMetric
                    label="EPS"
                    value={v.eps != null ? fmtNumber(v.eps, 0) : "—"}
                  />
                </div>
                {v.week52Low != null && v.week52High != null && price > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>52주 위치</span>
                      <span className="tabular">
                        {fmtPercent(
                          (price - v.week52Low) /
                            (v.week52High - v.week52Low),
                          0
                        ).replace("+", "")}
                      </span>
                    </div>
                    <RangeBar
                      currentPrice={price}
                      low={v.week52Low}
                      high={v.week52High}
                    />
                    <div className="flex items-center justify-between text-[10px] tabular text-muted-foreground">
                      <span>{fmtNumber(v.week52Low, 0)}</span>
                      <span>{fmtNumber(v.week52High, 0)}</span>
                    </div>
                  </div>
                )}
                {v.dividendYield != null && v.dividendYield > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    배당수익률 {(v.dividendYield * 100).toFixed(2)}%
                  </p>
                )}
              </Section>
            )}

            {c && (c.strongBuy + c.buy + c.hold + c.sell + c.strongSell) > 0 && (
              <Section
                title="애널리스트 분포 (Yahoo)"
                icon={<Users className="h-3.5 w-3.5" />}
              >
                <AnalystDistributionBars consensus={c} />
              </Section>
            )}

            {researches.length > 0 && (
              <Section
                title="최근 리서치 (네이버)"
                icon={<ScrollText className="h-3.5 w-3.5" />}
              >
                <ul className="space-y-2 text-[12px]">
                  {researches.slice(0, 3).map((r, idx) => (
                    <li
                      key={`${r.id ?? idx}`}
                      className="border-b border-border/50 pb-2 last:border-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                        <span className="font-medium text-foreground">
                          {r.brokerage || "—"}
                        </span>
                        <span className="tabular">{r.date || ""}</span>
                      </div>
                      <p className="leading-snug line-clamp-2">{r.title}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </div>
      )}

      {/* 증권사별 목표주가 표 — 한국 종목에서만 채워진다 (wisereport 출처).
          그리드 밖에 풀 폭으로 두어 가로 스크롤 없이 모든 컬럼이 보이게 한다. */}
      {c?.reports && c.reports.length > 0 && (
        <div className="mt-6">
          <h4 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            <TableProperties className="h-3.5 w-3.5" />
            증권사별 목표주가 (최근 {Math.min(c.reports.length, 12)}건)
          </h4>
          <BrokerReportTable reports={c.reports} currentPrice={price} />
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-5">{inner}</div>;
  }

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>컨센서스 · 밸류에이션 — {snap.meta.name}</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            애널리스트 목표주가 · 분포 · 밸류 지표 · 최근 리서치 (6시간 캐시)
          </p>
        </div>
        {c?.source && (
          <Badge variant="neutral" size="sm" className="shrink-0">
            출처 {c.source}
          </Badge>
        )}
      </CardHeader>
      <CardBody>{inner}</CardBody>
    </Card>
  );
}

// 3-way 컨센서스 뷰 (KR / US / 통합) — 사용자가 토글로 비교.
//   - 디폴트: 한국 종목 → KR(있으면), 미국 종목 → US
//   - 데이터 없는 탭은 disabled (tooltip: "데이터 없음")
type ConsensusView = "domestic" | "global" | "merged";

function ConsensusThreeWaySection({
  consensus,
  stockCode,
  price,
}: {
  consensus: AnalystConsensus;
  stockCode: string;
  price: number;
}) {
  const isKr = /\.K[SQ]$/.test(stockCode);

  const hasDomestic =
    consensus.domesticMean != null && (consensus.domesticCount ?? 0) > 0;
  const hasGlobal =
    consensus.globalMean != null && (consensus.globalCount ?? 0) > 0;
  const hasMerged = consensus.targetMean != null;

  const defaultView: ConsensusView = useMemo(() => {
    if (isKr) {
      if (hasDomestic) return "domestic";
      if (hasGlobal) return "global";
      return "merged";
    }
    if (hasGlobal) return "global";
    if (hasDomestic) return "domestic";
    return "merged";
  }, [isKr, hasDomestic, hasGlobal]);

  const [view, setView] = useState<ConsensusView>(defaultView);

  // 종목이 바뀌면 디폴트를 다시 적용. (선택 상태 누수 방지)
  useEffect(() => {
    setView(defaultView);
  }, [defaultView, stockCode]);

  const ensureAvailable = (v: ConsensusView): ConsensusView => {
    if (v === "domestic" && !hasDomestic) return defaultView;
    if (v === "global" && !hasGlobal) return defaultView;
    if (v === "merged" && !hasMerged) return defaultView;
    return v;
  };
  const activeView = ensureAvailable(view);

  // view별 mean/high/low/count/upside 추출
  const viewData = (() => {
    switch (activeView) {
      case "domestic":
        return {
          mean: consensus.domesticMean ?? null,
          high: consensus.domesticHigh ?? null,
          low: consensus.domesticLow ?? null,
          count: consensus.domesticCount ?? 0,
          upside: consensus.domesticUpsidePercent ?? null,
          caption: "국내 증권사(wisereport) 평균",
        };
      case "global":
        return {
          mean: consensus.globalMean ?? null,
          high: consensus.globalHigh ?? null,
          low: consensus.globalLow ?? null,
          count: consensus.globalCount ?? 0,
          upside: consensus.globalUpsidePercent ?? null,
          caption: "Yahoo 외국계 broker 평균",
        };
      case "merged":
      default:
        return {
          mean: consensus.targetMean ?? null,
          high: consensus.targetHigh ?? null,
          low: consensus.targetLow ?? null,
          count: consensus.analystCount ?? 0,
          upside: consensus.upsidePercent ?? null,
          caption:
            hasDomestic && hasGlobal
              ? "Yahoo + KR 카운트 가중평균"
              : hasDomestic
                ? "국내만(외국 broker 없음)"
                : "외국만(국내 데이터 없음)",
        };
    }
  })();

  const tabs: Array<{
    key: ConsensusView;
    label: string;
    enabled: boolean;
    title: string;
  }> = [
    {
      key: "domestic",
      label: "KR",
      enabled: hasDomestic,
      title: hasDomestic
        ? `국내 ${consensus.domesticCount}사`
        : "국내 증권사 데이터 없음",
    },
    {
      key: "global",
      label: "US",
      enabled: hasGlobal,
      title: hasGlobal
        ? `글로벌 ${consensus.globalCount}명`
        : "외국 broker 데이터 없음",
    },
    {
      key: "merged",
      label: "통합",
      enabled: hasMerged,
      title: hasMerged ? "Yahoo + KR 가중평균" : "통합 데이터 없음",
    },
  ];

  return (
    <Section
      title="컨센서스 목표주가"
      icon={<Target className="h-3.5 w-3.5" />}
    >
      {/* 3-way 토글 */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={!t.enabled}
              onClick={() => setView(t.key)}
              title={t.title}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${
                activeView === t.key
                  ? "bg-foreground text-background font-medium"
                  : t.enabled
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/40 cursor-not-allowed"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {viewData.caption}
        </span>
      </div>

      {viewData.mean != null ? (
        <>
          <ConsensusTargetBar
            currentPrice={price}
            low={viewData.low}
            mean={viewData.mean}
            high={viewData.high}
          />
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <MiniMetric label="최저" value={fmtNumber(viewData.low, 0)} />
            <MiniMetric
              label="평균"
              value={fmtNumber(viewData.mean, 0)}
              color={changeColor(viewData.upside)}
              sub={
                viewData.upside != null
                  ? fmtPercent(viewData.upside, 1)
                  : undefined
              }
            />
            <MiniMetric label="최고" value={fmtNumber(viewData.high, 0)} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {activeView === "domestic"
              ? `국내 ${viewData.count}사`
              : activeView === "global"
                ? `글로벌 ${viewData.count}명`
                : `통합 ${viewData.count}명`}
            {consensus.recommendationKey && activeView !== "domestic" && (
              <>
                {" · "}
                <span className="font-medium text-foreground">
                  {recommendationLabel(consensus.recommendationKey)}
                </span>
              </>
            )}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          이 view의 컨센서스 데이터가 없습니다.
        </p>
      )}
    </Section>
  );
}

// 증권사별 투자의견·목표가 표.
//   - 컬럼: 증권사 / 목표가 / vs현재가 / 의견 / 발행일 / 직전대비
//   - KR 배지로 국내 증권사 식별. 외국인 행은 "Global" 배지.
//   - 정렬은 발행일 최신순(이미 reports에서 정렬되어 들어옴)
function BrokerReportTable({
  reports,
  currentPrice,
}: {
  reports: AnalystReport[];
  currentPrice: number;
}) {
  const rows = reports.slice(0, 12);
  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="w-full text-[11px] tabular">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium">증권사</th>
            <th className="text-right px-2 py-1.5 font-medium">목표가</th>
            <th className="text-right px-2 py-1.5 font-medium">vs 현재가</th>
            <th className="text-left px-2 py-1.5 font-medium">의견</th>
            <th className="text-left px-2 py-1.5 font-medium">발행일</th>
            <th className="text-right px-2 py-1.5 font-medium">직전대비</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const upside =
              currentPrice > 0 ? r.targetPrice / currentPrice - 1 : null;
            const dateLabel = r.publishDate
              ? new Date(r.publishDate).toISOString().slice(2, 10).replace(/-/g, ".")
              : "—";
            const prevDelta =
              r.previousTarget != null && r.previousTarget > 0
                ? r.targetPrice / r.previousTarget - 1
                : null;
            return (
              <tr
                key={`${r.brokerName}-${r.publishDate ?? idx}`}
                className="border-t border-border/50"
              >
                <td className="px-2 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-medium">{r.brokerName}</span>
                    <Badge
                      variant={r.isDomestic ? "neutral" : "watch"}
                      size="sm"
                      className="text-[9px] py-0 px-1"
                    >
                      {r.isDomestic ? "KR" : "Global"}
                    </Badge>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  {fmtNumber(r.targetPrice, 0)}
                </td>
                <td
                  className={`px-2 py-1.5 text-right ${changeColor(upside)}`}
                >
                  {upside != null ? fmtPercent(upside, 1) : "—"}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {r.opinion || "—"}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {dateLabel}
                </td>
                <td
                  className={`px-2 py-1.5 text-right ${changeColor(prevDelta)}`}
                >
                  {prevDelta != null && prevDelta !== 0
                    ? fmtPercent(prevDelta, 1)
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function recommendationLabel(
  key: NonNullable<NonNullable<StockSnapshot["consensus"]>["recommendationKey"]>
): string {
  switch (key) {
    case "strong_buy":
      return "Strong Buy";
    case "buy":
      return "Buy";
    case "hold":
      return "Hold";
    case "sell":
      return "Sell";
    case "strong_sell":
      return "Strong Sell";
  }
}

// 컨센서스 low~mean~high 막대. 현재가 마커가 위에 표시됨.
function ConsensusTargetBar({
  currentPrice,
  low,
  mean,
  high,
}: {
  currentPrice: number;
  low: number | null;
  mean: number | null;
  high: number | null;
}) {
  if (mean == null || currentPrice <= 0) return null;

  // 현재가도 막대 안에 들어오도록 visualization 폭 결정
  const candidates = [
    low ?? mean,
    high ?? mean,
    mean,
    currentPrice,
  ].filter((v): v is number => v != null && Number.isFinite(v));
  const minV = Math.min(...candidates);
  const maxV = Math.max(...candidates);
  const span = Math.max(maxV - minV, 1);
  const padding = span * 0.1;
  const visLow = minV - padding;
  const visHigh = maxV + padding;
  const totalSpan = visHigh - visLow;

  const pct = (v: number) =>
    Math.max(0, Math.min(100, ((v - visLow) / totalSpan) * 100));

  const lowPct = low != null ? pct(low) : pct(mean);
  const highPct = high != null ? pct(high) : pct(mean);
  const meanPct = pct(mean);
  const currentPct = pct(currentPrice);

  return (
    <div className="relative h-3 w-full">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-muted rounded-full" />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-accent/40 rounded-full"
        style={{ left: `${lowPct}%`, width: `${Math.max(highPct - lowPct, 1)}%` }}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-accent"
        style={{ left: `${meanPct}%` }}
        title={`평균 ${fmtNumber(mean, 0)}`}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-4 w-1 rounded bg-foreground"
        style={{ left: `calc(${currentPct}% - 2px)` }}
        title={`현재가 ${fmtNumber(currentPrice, 0)}`}
      />
    </div>
  );
}

// 52주 막대 — low~high 범위에서 현재가 위치
function RangeBar({
  currentPrice,
  low,
  high,
}: {
  currentPrice: number;
  low: number;
  high: number;
}) {
  if (high <= low) return null;
  const totalSpan = high - low;
  const currentPct = Math.max(
    0,
    Math.min(100, ((currentPrice - low) / totalSpan) * 100)
  );
  return (
    <div className="relative h-2 w-full">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-muted rounded-full" />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-accent/40"
        style={{ width: "100%" }}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-3 w-1 rounded bg-foreground"
        style={{ left: `calc(${currentPct}% - 2px)` }}
        title={`현재가 ${fmtNumber(currentPrice, 0)}`}
      />
    </div>
  );
}

function AnalystDistributionBars({
  consensus,
}: {
  consensus: NonNullable<StockSnapshot["consensus"]>;
}) {
  const items: Array<{ label: string; value: number; color: string }> = [
    {
      label: "Strong Buy",
      value: consensus.strongBuy,
      color: "bg-up",
    },
    {
      label: "Buy",
      value: consensus.buy,
      color: "bg-up/70",
    },
    {
      label: "Hold",
      value: consensus.hold,
      color: "bg-muted-foreground",
    },
    {
      label: "Sell",
      value: consensus.sell,
      color: "bg-down/70",
    },
    {
      label: "Strong Sell",
      value: consensus.strongSell,
      color: "bg-down",
    },
  ];
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-1.5">
      {items.map((it) => {
        const widthPct = (it.value / max) * 100;
        const sharePct = ((it.value / total) * 100).toFixed(0);
        return (
          <div key={it.label} className="flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground w-20 shrink-0">
              {it.label}
            </span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${it.color} transition-all`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="tabular text-foreground w-14 text-right">
              {it.value} ({sharePct}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}

function MiniMetric({
  label,
  value,
  sub,
  color = "",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`tabular text-sm font-semibold ${color}`}>{value}</div>
      {sub && (
        <div className={`text-[10px] mt-0.5 tabular ${color || "text-muted-foreground"}`}>
          {sub}
        </div>
      )}
    </div>
  );
}
