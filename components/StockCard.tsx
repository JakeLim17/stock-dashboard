"use client";

import type { EventItem, StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { MarketAlertBadge } from "./MarketAlertBadge";
import { SectorLeaderBadge } from "./SectorLeaderBadge";
import { SignalMarkBadges } from "./SignalMarkBadges";
import { PriceTicker } from "./PriceTicker";
import { PriceWithKrw } from "./PriceWithKrw";
import { CardSparkline } from "./CardSparkline";
import { buildFairValueEstimate } from "@/lib/prediction-display";
import { FAIR_VALUE_BACKTEST_META } from "@/lib/fair-value";
import { dnLabel } from "./EventCalendar";
import {
  changeColor,
  currencyOf,
  fmtNumber,
  fmtPercent,
  fmtSigned,
  fmtTime,
  marketDisplayLabel,
  pickPrimaryQuote,
  priceFreshness,
  priceTimeLabel,
} from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

function fmtFullPrice(v: number | null | undefined, currency: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (currency === "USD") return v.toFixed(2);
  return Math.round(v).toLocaleString("ko-KR");
}

export function StockCard({
  snap,
  onSelect,
  selected,
  krwRate,
  priceOverride,
}: {
  snap: StockSnapshot;
  onSelect?: (code: string) => void;
  selected?: boolean;
  krwRate?: number | null;
  priceOverride?: number | null;
}) {
  const { meta, quote, analysis } = snap;
  const fairValue = buildFairValueEstimate(snap);
  const { primary } = pickPrimaryQuote(quote);
  const currency = currencyOf(meta.code, meta.currency);
  const market = marketDisplayLabel(quote);

  const liveOverride =
    typeof priceOverride === "number" &&
    Number.isFinite(priceOverride) &&
    priceOverride > 0 &&
    primary.isLive &&
    !primary.isExtended &&
    quote.prevClose > 0
      ? priceOverride
      : null;

  const livePrice = liveOverride ?? primary.price;
  const liveChangeAbs =
    liveOverride != null ? liveOverride - quote.prevClose : primary.changeAbs;
  const liveChangeRate =
    liveOverride != null && quote.prevClose > 0
      ? (liveOverride - quote.prevClose) / quote.prevClose
      : primary.changeRate;

  const trendIcon =
    liveChangeRate > 0 ? (
      <TrendingUp className="h-4 w-4" />
    ) : liveChangeRate < 0 ? (
      <TrendingDown className="h-4 w-4" />
    ) : (
      <Minus className="h-4 w-4" />
    );

  return (
    <Card
      role="button"
      onClick={() => onSelect?.(meta.code)}
      className={`cursor-pointer transition-shadow hover:shadow-md ${selected ? "ring-2 ring-accent" : ""}`}
    >
      <CardHeader className="flex items-start justify-between gap-2 pb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="text-base font-semibold">{meta.name}</div>
            <SectorLeaderBadge meta={meta} size="sm" />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span>{meta.code}</span>
            <Badge variant={market.variant}>{market.label}</Badge>
            <MarketAlertBadge alert={quote.marketAlert} />
            <SignalMarkBadges marks={snap.signalMarks} size="sm" />
            <UpcomingEventBadges events={snap.upcomingEvents} />
          </div>
        </div>
        <Badge
          variant={analysis.verdict.tone}
          size="md"
          className="shrink-0"
        >
          {analysis.verdict.label}
        </Badge>
      </CardHeader>

      <CardBody className="space-y-3 pt-0">
        <div>
          <div className="flex items-end gap-3">
            <div
              className={`text-2xl font-bold tabular leading-none shrink-0 ${changeColor(liveChangeRate)}`}
            >
              <PriceTicker
                value={livePrice}
                decimals={currency === "USD" ? 2 : 0}
              />
            </div>
            <CardSparkline
              code={meta.code}
              currentPrice={quote.price}
              height={36}
              className="flex-1 min-w-[120px]"
            />
          </div>

          {currency === "USD" && (
            <div className="mt-1">
              <PriceWithKrw
                price={livePrice}
                currency={currency}
                krwRate={krwRate ?? null}
                size="md"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 mt-1 flex-wrap">
            <div
              className={`tabular text-sm inline-flex items-center gap-1 ${changeColor(liveChangeRate)}`}
            >
              {trendIcon}
              {fmtSigned(liveChangeAbs)} ({fmtPercent(liveChangeRate)})
            </div>
            <div className="text-[11px] text-muted-foreground tabular flex gap-x-2">
              <span>
                고{" "}
                <span className="text-foreground">
                  {fmtFullPrice(quote.high, currency)}
                </span>
              </span>
              <span>
                저{" "}
                <span className="text-foreground">
                  {fmtFullPrice(quote.low, currency)}
                </span>
              </span>
            </div>
          </div>

          {primary.time && (
            <div className="text-[11px] text-muted-foreground mt-1 tabular">
              {primary.sessionLabel} · {priceTimeLabel(primary.time)}
              {(() => {
                const f = priceFreshness(primary.time, quote.marketState);
                return f ? ` · ${f.label}` : "";
              })()}
            </div>
          )}
        </div>

        {/* 익일 추정가 — 앱장·시간외까지 끝난 뒤에만 */}
        {fairValue.ready ? (
          <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              익일 추정가 · {fairValue.methodLabel}
            </div>
            <div
              className={`tabular text-xl font-bold mt-0.5 ${changeColor(fairValue.vsSettlementRate)}`}
            >
              {fmtNumber(fairValue.price, currency === "USD" ? 2 : 0)}
            </div>
            <div className="text-[11px] text-muted-foreground tabular mt-0.5">
              <span className={changeColor(fairValue.vsSettlementRate)}>
                {fairValue.settlementLabel}(
                {fmtNumber(fairValue.settlementPrice, 0)}) 대비{" "}
                {fmtSigned(
                  fairValue.vsSettlementRate * fairValue.settlementPrice
                )}{" "}
                ({fmtPercent(fairValue.vsSettlementRate)})
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground/60 mt-1">
              백테스트 오차 익일종가{" "}
              {(FAIR_VALUE_BACKTEST_META.nightToNextClose.mape * 100).toFixed(1)}
              %
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground text-center">
            {fairValue.pendingReason}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground text-center">
          탭하여 예측 · 컨센서스 · 수급 · 호가 · 뉴스 보기
        </p>
      </CardBody>
    </Card>
  );
}

function UpcomingEventBadges({ events }: { events: EventItem[] | undefined }) {
  if (!events?.length) return null;
  const now = Date.now();
  const cutoff = now + 7 * 86_400_000;
  const within = events
    .filter((e) => e.kind === "earnings" || e.kind === "dividend")
    .filter((e) => e.date >= now - 86_400_000 && e.date <= cutoff)
    .slice(0, 1);
  if (!within.length) return null;
  return (
    <>
      {within.map((e) => {
        const dn = Math.round((e.date - now) / 86_400_000);
        const emoji = e.kind === "earnings" ? "📊" : "💰";
        return (
          <Badge key={`${e.kind}-${e.date}`} variant="neutral" size="sm">
            {emoji} {dnLabel(dn)}
          </Badge>
        );
      })}
    </>
  );
}
