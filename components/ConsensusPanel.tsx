"use client";

import type { SignalStatus, StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { changeColor, fmtNumber, fmtPercent } from "@/lib/utils";
import { Target, Users, ScrollText, Building2 } from "lucide-react";

const LONG_SIGNAL_LABEL: Record<SignalStatus, string> = {
  BUY: "신규 매수",
  ADD: "분할 매수",
  HOLD: "보유",
  WATCH: "관망",
  SELL: "비중 축소",
};

const LONG_SIGNAL_VARIANT: Record<
  SignalStatus,
  "buy" | "add" | "hold" | "watch" | "sell"
> = {
  BUY: "buy",
  ADD: "add",
  HOLD: "hold",
  WATCH: "watch",
  SELL: "sell",
};

// 선택된 종목의 컨센서스 / 밸류에이션 / 리서치 노트를 한 패널에 모은다.
// 사이드 폭이 좁으면 정보가 빽빽해지므로, 차트 아래 별도 행에 가로로 길게 둔다.
//
// 데이터 출처: Yahoo quoteSummary + 네이버 integration (6시간 캐시).
//   - Yahoo: targetMean/High/Low, 애널 분포, 추천 키
//   - 네이버: 한국 종목 PER/PBR/EPS/52주, 리서치 리포트
export function ConsensusPanel({ snap }: { snap?: StockSnapshot | null }) {
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
  const longSig = snap.analysis.longTerm;
  const verdict = snap.analysis.verdict;

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle>컨센서스 · 밸류에이션 — {snap.meta.name}</CardTitle>
            {/* 메인 결론 verdict — 사이드에서도 같은 결론을 확인 */}
            <Badge variant={verdict.tone} size="md" className="shrink-0">
              {verdict.label}
            </Badge>
            <Badge
              variant={LONG_SIGNAL_VARIANT[longSig.signal]}
              size="sm"
              className="shrink-0"
            >
              장기 · {LONG_SIGNAL_LABEL[longSig.signal]}
            </Badge>
          </div>
          {/* 첫 줄 — verdict.headline (통합 결론) */}
          <p className="text-sm font-semibold mt-1.5 leading-snug">
            {verdict.headline}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            {verdict.detail} · 장기 헤드라인: {longSig.headline}
            <span className="ml-2 tabular">종합 {longSig.score}</span>
          </p>
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
      <CardBody>
        {!hasAnything ? (
          <p className="text-sm text-muted-foreground">
            컨센서스/밸류에이션 데이터를 불러오지 못했습니다. 일부 종목은 Yahoo·네이버에서 제공되지 않을 수 있습니다.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-5">
            {c && c.targetMean != null && (
              <Section
                title="컨센서스 목표주가"
                icon={<Target className="h-3.5 w-3.5" />}
              >
                <ConsensusTargetBar
                  currentPrice={price}
                  low={c.targetLow}
                  mean={c.targetMean}
                  high={c.targetHigh}
                />
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <MiniMetric label="최저" value={fmtNumber(c.targetLow, 0)} />
                  <MiniMetric
                    label="평균"
                    value={fmtNumber(c.targetMean, 0)}
                    color={changeColor(c.upsidePercent)}
                    sub={c.upsidePercent != null ? fmtPercent(c.upsidePercent, 1) : undefined}
                  />
                  <MiniMetric label="최고" value={fmtNumber(c.targetHigh, 0)} />
                </div>
                {c.analystCount != null && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    애널리스트 {c.analystCount}명
                    {c.recommendationKey && (
                      <>
                        {" · "}
                        <span className="font-medium text-foreground">
                          {recommendationLabel(c.recommendationKey)}
                        </span>
                      </>
                    )}
                  </p>
                )}
              </Section>
            )}

            {c && (c.strongBuy + c.buy + c.hold + c.sell + c.strongSell) > 0 && (
              <Section
                title="애널리스트 분포"
                icon={<Users className="h-3.5 w-3.5" />}
              >
                <AnalystDistributionBars consensus={c} />
              </Section>
            )}

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
        )}
      </CardBody>
    </Card>
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
