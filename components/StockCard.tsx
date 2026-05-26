"use client";

import type { StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";
import {
  changeColor,
  fmtNumber,
  fmtPercent,
  fmtSigned,
  marketStateLabel,
  priceTimeLabel,
} from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus, FlaskConical } from "lucide-react";

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

  const market = marketStateLabel(quote.marketState);
  const flowIsMock = flow.source === "mock";

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
                기준 {priceTimeLabel(quote.priceTime)}
              </div>
            )}
          </div>
          <div className="text-right text-xs text-muted-foreground space-y-1">
            <div>고가 <span className="tabular text-foreground">{fmtNumber(quote.high, 0)}</span></div>
            <div>저가 <span className="tabular text-foreground">{fmtNumber(quote.low, 0)}</span></div>
          </div>
        </div>

        {/* 핵심 지표 그리드 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-border pt-3">
          <Row label="거래량" value={fmtNumber(quote.volume)} />
          <Row label="RSI(14)" value={tech.rsi14 != null ? tech.rsi14.toFixed(0) : "—"} />
          <Row
            label={
              <span className="inline-flex items-center gap-1">
                외인 순매수
                {flowIsMock && <FlaskConical className="h-3 w-3 text-warn" />}
              </span>
            }
            value={flowLabel(flow.foreignNet)}
            color={flow.foreignNet != null ? changeColor(flow.foreignNet) : undefined}
          />
          <Row
            label={
              <span className="inline-flex items-center gap-1">
                기관 순매수
                {flowIsMock && <FlaskConical className="h-3 w-3 text-warn" />}
              </span>
            }
            value={flowLabel(flow.institutionNet)}
            color={flow.institutionNet != null ? changeColor(flow.institutionNet) : undefined}
          />
        </div>
        {flowIsMock && (
          <div className="text-[11px] text-warn -mt-2 flex items-center gap-1">
            <FlaskConical className="h-3 w-3" /> 외인/기관은 예측치 (KIS 키 연결 시 실데이터 전환)
          </div>
        )}

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
