"use client";

import type { StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";
import {
  changeColor,
  extendedSessionLabel,
  fmtNumber,
  fmtPercent,
  fmtSigned,
  fmtTime,
  marketDisplayLabel,
  priceTimeLabel,
} from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

const SIGNAL_LABEL: Record<string, string> = {
  BUY: "신규 매수",
  ADD: "분할 추매",
  HOLD: "보유 유지",
  WATCH: "관망",
  SELL: "비중 축소",
};

const SIGNAL_VARIANT = {
  BUY: "buy",
  ADD: "add",
  HOLD: "hold",
  WATCH: "watch",
  SELL: "sell",
} as const;

export function StockCard({ snap, onSelect, selected }: {
  snap: StockSnapshot;
  onSelect?: (code: string) => void;
  selected?: boolean;
}) {
  const { meta, quote, tech, flow, analysis } = snap;
  const trendIcon =
    quote.changeRate > 0 ? <TrendingUp className="h-4 w-4" /> :
    quote.changeRate < 0 ? <TrendingDown className="h-4 w-4" /> :
    <Minus className="h-4 w-4" />;

  const market = marketDisplayLabel(quote);
  const isRegular = (quote.marketState ?? "").toUpperCase() === "REGULAR";
  // 정규장 중에는 시간외 박스를 숨김 (데이터가 잘못 와도 사용자 혼란 방지)
  const ext = !isRegular ? quote.extendedHours ?? null : null;

  return (
    <Card
      role="button"
      onClick={() => onSelect?.(meta.code)}
      className={`cursor-pointer transition-shadow hover:shadow-md ${selected ? "ring-2 ring-accent" : ""}`}
    >
      <CardHeader className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold">{meta.name}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <span>{meta.code}</span>
            <Badge variant={market.variant}>{market.label}</Badge>
          </div>
        </div>
        <Badge variant={SIGNAL_VARIANT[analysis.signal]} size="md">
          {SIGNAL_LABEL[analysis.signal]}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* 가격 */}
        <div className="flex items-end justify-between">
          <div>
            <div className={`tabular text-3xl font-bold ${changeColor(quote.changeRate)}`}>
              {fmtNumber(quote.price, 0)}
            </div>
            <div className={`tabular text-sm mt-1 inline-flex items-center gap-1 ${changeColor(quote.changeRate)}`}>
              {trendIcon}
              {fmtSigned(quote.changeAbs)} ({fmtPercent(quote.changeRate)})
            </div>
            {quote.priceTime && (
              <div className="text-[11px] text-muted-foreground mt-1 tabular">
                {ext ? "정규장 종가 · " : "기준 "}
                {priceTimeLabel(quote.priceTime)}
              </div>
            )}
          </div>
          <div className="text-right text-xs text-muted-foreground space-y-1">
            <div>고가 <span className="tabular text-foreground">{fmtNumber(quote.high, 0)}</span></div>
            <div>저가 <span className="tabular text-foreground">{fmtNumber(quote.low, 0)}</span></div>
          </div>
        </div>

        {/* 시간외(프리/애프터/한국 시간외 단일가) 가격 */}
        {ext && (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <Badge variant={ext.active ? "good" : "neutral"} size="sm">
                {extendedSessionLabel(ext.session)}
                {ext.active ? " · 거래중" : ""}
              </Badge>
              {ext.time && (
                <span className="text-muted-foreground tabular">
                  {fmtTime(ext.time)}
                </span>
              )}
            </div>
            <div className="text-right">
              <div className={`tabular text-base font-semibold ${changeColor(ext.changeRate)}`}>
                {fmtNumber(ext.price, 0)}
              </div>
              <div className={`tabular text-[11px] ${changeColor(ext.changeRate)}`}>
                {fmtSigned(ext.changeAbs)} ({fmtPercent(ext.changeRate)})
              </div>
            </div>
          </div>
        )}

        {/* 핵심 지표 그리드 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-border pt-3">
          <Row label="거래량" value={fmtNumber(quote.volume)} />
          <Row label="RSI(14)" value={tech.rsi14 != null ? tech.rsi14.toFixed(0) : "—"} />
          <Row
            label="외인 순매수"
            value={flowLabel(flow.foreignNet)}
            color={flow.foreignNet != null ? changeColor(flow.foreignNet) : undefined}
          />
          <Row
            label="기관 순매수"
            value={flowLabel(flow.institutionNet)}
            color={flow.institutionNet != null ? changeColor(flow.institutionNet) : undefined}
          />
        </div>

        {/* 시그널 + 한줄 헤드라인 */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs text-muted-foreground tracking-wide uppercase">분석</div>
          <div className="font-medium">{analysis.headline}</div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="neutral">과열 {analysis.heatScore}</Badge>
            <Badge variant="neutral">매수우위 {analysis.buyScore}</Badge>
            {tech.trend === "uptrend" && <Badge variant="good">상승추세</Badge>}
            {tech.trend === "downtrend" && <Badge variant="bad">하락추세</Badge>}
          </div>
          <ul className="text-xs text-muted-foreground space-y-0.5 mt-1">
            {analysis.reasons.slice(0, 2).map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>

          {/* 1주 예상 범위 요약 (있을 때만) */}
          {(() => {
            const oneWeek = snap.predictions?.ranges.find(
              (r) => r.horizonDays === 5
            );
            if (!oneWeek || quote.price <= 0) return null;
            const lowPct = oneWeek.low / quote.price - 1;
            const highPct = oneWeek.high / quote.price - 1;
            return (
              <div className="text-[11px] text-muted-foreground tabular mt-1.5">
                1주 예상 {fmtPercent(lowPct, 1)} ~ {fmtPercent(highPct, 1)}{" "}
                <span className="text-[10px]">(68%)</span>
              </div>
            );
          })()}
        </div>
      </CardBody>
    </Card>
  );
}

function Row({ label, value, color }: { label: React.ReactNode; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular font-medium ${color ?? ""}`}>{value}</span>
    </div>
  );
}

function flowLabel(v: number | null): string {
  if (v == null) return "—";
  const eok = v / 1e8;
  const sign = eok > 0 ? "+" : "";
  return `${sign}${eok.toFixed(0)}억`;
}
