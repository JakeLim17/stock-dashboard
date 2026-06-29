"use client";

import { useState } from "react";
import type { EventItem, StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { SignalDetailBadges } from "./SignalDetailBadges";
import { RiskBadge } from "./RiskBadge";
import { OpportunityBadge } from "./OpportunityBadge";
import { MarketAlertBadge } from "./MarketAlertBadge";
import { VolatilityBadge } from "./VolatilityBadge";
import { SectorLeaderBadge } from "./SectorLeaderBadge";
import { SignalMarkBadges } from "./SignalMarkBadges";
import { DataQualityBadge } from "./DataQualityBadge";
import { PriceTicker } from "./PriceTicker";
import { PriceWithKrw } from "./PriceWithKrw";
import { CardSparkline } from "./CardSparkline";
import { PredictionBlock } from "./PredictionBlock";
import { ConsensusPanel } from "./ConsensusPanel";
import { StockFundamentalsBlock } from "./StockFundamentalsBlock";
import { VerdictHint } from "./VerdictHint";
import { VerdictReasonLine } from "./VerdictReasonLine";
import { VerdictReasonBullets } from "./VerdictReasonBullets";
import {
  buildMultiHorizonFairValue,
  buildPredictionCompactLine,
  type FairValueHorizonId,
  type FairValueResult,
} from "@/lib/prediction-display";
import { FAIR_VALUE_BACKTEST_META } from "@/lib/fair-value";
import { SIGNAL_LABEL } from "@/lib/signal-labels";
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
import { TrendingDown, TrendingUp, Minus, Loader2 } from "lucide-react";

function fmtFullPrice(v: number | null | undefined, currency: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (currency === "USD") return v.toFixed(2);
  return Math.round(v).toLocaleString("ko-KR");
}

const SIGNAL_VARIANT = {
  BUY: "buy",
  ADD: "add",
  HOLD: "hold",
  WATCH: "watch",
  SELL: "sell",
} as const;

type SignalKey = keyof typeof SIGNAL_VARIANT;

export function StockCard({
  snap,
  onSelect,
  selected,
  krwRate,
  kisActive,
  priceOverride,
  tradeOverride,
  analysisPending = false,
  marketSemiHeat,
  /** mobile: 기본 정보만 / desktop: 카드에 분석·예측 블록까지 전부 */
  variant = "desktop",
  onOpenDetailSheet,
}: {
  snap: StockSnapshot;
  onSelect?: (code: string) => void;
  selected?: boolean;
  krwRate?: number | null;
  kisActive?: boolean;
  analysisPending?: boolean;
  marketSemiHeat?: number | null;
  priceOverride?: number | null;
  tradeOverride?: { cumVolume?: number; cumTradeValue?: number } | null;
  variant?: "mobile" | "desktop";
  /** 모바일 — 뉴스·호가 전체 패널(시트) 열기 */
  onOpenDetailSheet?: () => void;
}) {
  const isMobile = variant === "mobile";
  const { meta, quote, tech, analysis } = snap;
  const fairValueHorizons = buildMultiHorizonFairValue(snap);
  const { primary } = pickPrimaryQuote(quote);
  const currency = currencyOf(meta.code, meta.currency);
  const market = marketDisplayLabel(quote);
  const decimals = currency === "USD" ? 2 : 0;
  const compactPredLine = buildPredictionCompactLine(snap, decimals);

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
      <CardHeader className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="text-base font-semibold">{meta.name}</div>
            <SectorLeaderBadge meta={meta} size="sm" />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span>{meta.code}</span>
            <Badge variant={market.variant}>{market.label}</Badge>
            <MarketAlertBadge alert={quote.marketAlert} />
            <DataQualityBadge dq={snap.dataQuality} />
            <SignalMarkBadges marks={snap.signalMarks} size="sm" />
            <UpcomingEventBadges events={snap.upcomingEvents} />
            {!isMobile && (
              <ShortBalanceBadge short={snap.shortBalance} />
            )}
          </div>
        </div>
        <div className="inline-flex flex-col items-end gap-0.5 shrink-0">
          <div className="inline-flex items-center gap-1.5">
            <Badge
              variant={analysis.verdict.tone}
              size="md"
              className={analysis.verdict.tone === "sell" ? "shake-warn" : undefined}
            >
              {analysis.verdict.label}
            </Badge>
            {!isMobile && <VerdictHint />}
          </div>
          <VerdictReasonLine line={analysis.verdict.reasonLine} className="text-right" />
          {!isMobile && (
            <VerdictReasonBullets
              snap={snap}
              marketSemiHeat={marketSemiHeat}
              className="text-right max-w-[220px]"
            />
          )}
        </div>
      </CardHeader>

      <CardBody className="space-y-3">
        {/* 가격 + 스파크라인 */}
        <div>
          <div className="flex items-end gap-3">
            <div
              className={`text-xl font-bold tabular leading-none shrink-0 ${changeColor(liveChangeRate)}`}
            >
              <PriceTicker value={livePrice} decimals={decimals} />
            </div>
            <CardSparkline
              code={meta.code}
              currentPrice={quote.price}
              height={isMobile ? 36 : 32}
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
          <div className="flex items-start justify-between gap-2 mt-1 flex-wrap">
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
          {primary.isExtended && primary.isLive ? (
            <div className="text-[11px] mt-1 tabular flex items-center gap-1.5 flex-wrap">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-up animate-pulse"
                aria-hidden
              />
              <span className="text-foreground font-medium">시간외 거래중</span>
              <span className="text-muted-foreground">
                · {primary.sessionLabel}
                {primary.time ? ` · ${fmtTime(primary.time)}` : ""}
              </span>
            </div>
          ) : primary.time ? (
            <div className="text-[11px] text-muted-foreground mt-1 tabular">
              {primary.sessionLabel} · {priceTimeLabel(primary.time)}
              {(() => {
                const f = priceFreshness(primary.time, quote.marketState);
                return f ? ` · ${f.label}` : "";
              })()}
            </div>
          ) : null}
        </div>

        {/* 익일 추정가 — 탭 클릭이 카드 선택(모달)으로 전파되지 않게 격리 */}
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <FairValueSection horizons={fairValueHorizons} currency={currency} />
        </div>

        {/* 펀더멘털 — 카드 기본 정보 (모바일·데스크탑 공통) */}
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <StockFundamentalsBlock
            snap={snap}
            krwRate={krwRate}
            variant="card"
            kisActive={kisActive}
            tradeOverride={tradeOverride}
            analysisPending={analysisPending}
          />
        </div>

        {/* 수급 · 컨센서스 — 모달 대신 카드 아래 인라인 펼침 */}
        <CardFlowConsensusExpand
          snap={snap}
          krwRate={krwRate}
          kisActive={kisActive}
          isMobile={isMobile}
          analysisPending={analysisPending}
          onOpenDetailSheet={onOpenDetailSheet}
        />

        {/* 분석 요약 — 모바일은 한 줄, 데스크탑은 전체 */}
        <AnalysisSection
          snap={snap}
          analysisPending={analysisPending}
          isMobile={isMobile}
          compactPredLine={compactPredLine}
        />

        {/* 데스크탑만 — 카드에 예측 블록 전체 */}
        {!isMobile && !analysisPending && (
          <div onClick={(e) => e.stopPropagation()}>
            <PredictionBlock snap={snap} krwRate={krwRate} />
          </div>
        )}

        {isMobile && (
          <p className="text-[10px] text-muted-foreground text-center pt-1">
            가격 추정 탭 · 수급·컨센서스 상세는 카드 안에서 펼쳐 보기
          </p>
        )}
      </CardBody>
    </Card>
  );
}

const HORIZON_TABS: { id: FairValueHorizonId; short: string }[] = [
  { id: "today", short: "오늘" },
  { id: "tomorrow", short: "내일" },
  { id: "week", short: "다음 주" },
  { id: "month", short: "1개월" },
];

function CardFlowConsensusExpand({
  snap,
  krwRate,
  kisActive,
  isMobile,
  analysisPending,
  onOpenDetailSheet,
}: {
  snap: StockSnapshot;
  krwRate?: number | null;
  kisActive?: boolean;
  isMobile: boolean;
  analysisPending: boolean;
  onOpenDetailSheet?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasConsensus = !!snap.consensus || !!snap.consensusValuation;

  return (
    <div
      className="border-t border-border pt-2"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1"
        aria-expanded={open}
      >
        <span className="font-medium">
          수급 · 컨센서스 {open ? "닫기" : "상세보기"}
        </span>
        <span className="text-[10px] tabular shrink-0">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
          {isMobile && !analysisPending && (
            <PredictionBlock snap={snap} krwRate={krwRate} />
          )}
          {hasConsensus ? (
            <ConsensusPanel snap={snap} embedded />
          ) : (
            <p className="text-[11px] text-muted-foreground px-1">
              컨센서스 데이터를 불러오지 못했습니다.
            </p>
          )}
          <StockFundamentalsBlock
            snap={snap}
            krwRate={krwRate}
            variant="detail"
            kisActive={kisActive}
            analysisPending={analysisPending}
          />
          {isMobile && onOpenDetailSheet && (
            <button
              type="button"
              onClick={onOpenDetailSheet}
              className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground py-1.5 border border-dashed border-border rounded-md"
            >
              뉴스 · 상세 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FairValueSection({
  horizons,
  currency,
}: {
  horizons: ReturnType<typeof buildMultiHorizonFairValue>;
  currency: string;
}) {
  const [active, setActive] = useState<FairValueHorizonId>("tomorrow");
  const current = horizons.find((h) => h.id === active) ?? horizons[1];
  const fairValue = current?.estimate;

  if (!fairValue) return null;

  return (
    <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
          가격 추정 · {current.label}
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-md bg-muted/60 border border-border/50">
          {HORIZON_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActive(t.id);
              }}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                active === t.id
                  ? "bg-background font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.short}
            </button>
          ))}
        </div>
      </div>

      <FairValueBody fairValue={fairValue} currency={currency} active={active} />
    </div>
  );
}

function FairValueBody({
  fairValue,
  currency,
  active,
}: {
  fairValue: FairValueResult;
  currency: string;
  active: FairValueHorizonId;
}) {
  if (fairValue.ready) {
    const topMacro = fairValue.macroFactors
      .filter((f) => Math.abs(f.bps) >= 1)
      .sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps))
      .slice(0, 3);
    const dualLeg = active === "tomorrow";
    return (
      <>
        <div className="text-[10px] text-muted-foreground">
          {fairValue.targetDateLabel} · {fairValue.settlementLabel}
        </div>

        {dualLeg ? (
          <>
            <FairValueLegRow
              label="시가"
              leg={fairValue.open}
              settlementPrice={fairValue.settlementPrice}
              currency={currency}
              mapeHint={FAIR_VALUE_BACKTEST_META.nightToNextOpen.mape}
              emphasized
            />
            <FairValueLegRow
              label="종가"
              leg={fairValue.close}
              settlementPrice={fairValue.settlementPrice}
              currency={currency}
              mapeHint={FAIR_VALUE_BACKTEST_META.nightToNextClose.mape}
            />
          </>
        ) : (
          <FairValueLegRow
            label={active === "today" ? "종가" : "목표가"}
            leg={fairValue.close}
            settlementPrice={fairValue.settlementPrice}
            currency={currency}
            mapeHint={FAIR_VALUE_BACKTEST_META.nightToNextClose.mape}
            emphasized
          />
        )}

        {topMacro.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {topMacro.map((f) => (
              <span
                key={f.label}
                className={`text-[9px] px-1.5 py-0.5 rounded tabular ${
                  f.bps >= 0
                    ? "bg-rise/10 text-rise"
                    : "bg-fall/10 text-fall"
                }`}
              >
                {f.label} {f.bps >= 0 ? "+" : ""}
                {(f.bps / 100).toFixed(1)}%
              </span>
            ))}
          </div>
        )}
        {active === "tomorrow" && (
          <div className="text-[10px] text-muted-foreground/60">
            앱장 기준 백테스트 오차 시가{" "}
            {(FAIR_VALUE_BACKTEST_META.ahCloseToNextOpen.mape * 100).toFixed(1)}%
            · 종가{" "}
            {(FAIR_VALUE_BACKTEST_META.ahCloseToNextClose.mape * 100).toFixed(1)}%
          </div>
        )}
      </>
    );
  }
  return (
    <div className="text-[11px] text-muted-foreground text-center py-1">
      {fairValue.pendingReason}
    </div>
  );
}

function FairValueLegRow({
  label,
  leg,
  settlementPrice,
  currency,
  mapeHint,
  emphasized = false,
}: {
  label: string;
  leg: { price: number; vsSettlementRate: number; methodLabel: string };
  settlementPrice: number;
  currency: string;
  mapeHint: number;
  emphasized?: boolean;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground">
          {label} · {leg.methodLabel}
        </div>
        <div
          className={`tabular font-bold leading-tight ${emphasized ? "text-lg" : "text-base"} ${changeColor(leg.vsSettlementRate)}`}
        >
          {fmtNumber(leg.price, currency === "USD" ? 2 : 0)}
        </div>
        <div className="text-[10px] text-muted-foreground tabular">
          <span className={changeColor(leg.vsSettlementRate)}>
            {fmtSigned(leg.vsSettlementRate * settlementPrice)} (
            {fmtPercent(leg.vsSettlementRate)})
          </span>
        </div>
      </div>
      <div className="text-[9px] text-muted-foreground/70 tabular shrink-0 text-right">
        오차
        <br />
        {(mapeHint * 100).toFixed(1)}%
      </div>
    </div>
  );
}

function AnalysisSection({
  snap,
  analysisPending,
  isMobile,
  compactPredLine,
}: {
  snap: StockSnapshot;
  analysisPending: boolean;
  isMobile: boolean;
  compactPredLine: string | null;
}) {
  const { analysis, tech } = snap;

  if (analysisPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        <span>분석 중…</span>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="border-t border-border pt-2 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SignalDetailBadges
            short={analysis.shortTerm.signal}
            long={analysis.longTerm.signal}
            title={analysis.verdict.detail}
          />
          <VolatilityBadge assessment={analysis.volatility} size="sm" />
        </div>
        <p className="text-sm font-medium leading-snug line-clamp-2">
          {analysis.verdict.headline}
        </p>
        {compactPredLine && (
          <p className="text-[11px] text-muted-foreground tabular">{compactPredLine}</p>
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="text-xs text-muted-foreground tracking-wide uppercase">분석</div>
      <div className="flex items-center gap-2 flex-wrap">
        <SignalDetailBadges
          short={analysis.shortTerm.signal}
          long={analysis.longTerm.signal}
          title={analysis.verdict.detail}
        />
        <VolatilityBadge assessment={analysis.volatility} />
        <OpportunityBadge assessment={analysis.externalOpportunity} />
        <RiskBadge assessment={analysis.externalRisk} />
      </div>
      <p className="text-sm font-semibold leading-snug">{analysis.verdict.headline}</p>
      {(tech.trend === "uptrend" || tech.trend === "downtrend") && (
        <div className="flex flex-wrap gap-1.5">
          {tech.trend === "uptrend" && <Badge variant="good">상승추세</Badge>}
          {tech.trend === "downtrend" && <Badge variant="bad">하락추세</Badge>}
        </div>
      )}
      <details className="group [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none text-[11px] text-muted-foreground hover:text-foreground select-none inline-flex items-center gap-1">
          <span className="group-open:hidden">상세 보기 ▾</span>
          <span className="hidden group-open:inline">상세 닫기 ▴</span>
        </summary>
        <div className="mt-2 space-y-2 pt-2 border-t border-border/60">
          <SignalRow
            label="단기"
            signal={analysis.shortTerm.signal}
            headline={analysis.shortTerm.headline}
            chips={[`과열 ${analysis.heatScore}`, `매수우위 ${analysis.buyScore}`]}
          />
          <SignalRow
            label="장기"
            signal={analysis.longTerm.signal}
            headline={analysis.longTerm.headline}
            chips={longTermChips(snap)}
          />
        </div>
      </details>
    </div>
  );
}

function SignalRow({
  label,
  signal,
  headline,
  chips,
}: {
  label: string;
  signal: SignalKey;
  headline: string;
  chips: string[];
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1 shrink-0 w-7">
          {label}
        </span>
        <Badge variant={SIGNAL_VARIANT[signal]} size="sm" className="shrink-0">
          {SIGNAL_LABEL[signal]}
        </Badge>
        <span className="text-[13px] leading-snug font-medium flex-1 min-w-0">
          {headline}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 pl-9">
        {chips.map((c) => (
          <span
            key={c}
            className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function longTermChips(snap: StockSnapshot): string[] {
  const chips: string[] = [];
  const c = snap.consensus;
  const v = snap.consensusValuation;
  if (c?.upsidePercent != null) {
    const sign = c.upsidePercent >= 0 ? "+" : "";
    chips.push(`컨센 ${sign}${(c.upsidePercent * 100).toFixed(0)}%`);
  }
  if (v?.forwardPer != null) chips.push(`추정PER ${v.forwardPer.toFixed(1)}`);
  else if (v?.per != null) chips.push(`PER ${v.per.toFixed(1)}`);
  return chips;
}

function UpcomingEventBadges({ events }: { events: EventItem[] | undefined }) {
  if (!events?.length) return null;
  const now = Date.now();
  const within = events
    .filter((e) => e.kind === "earnings" || e.kind === "dividend")
    .filter((e) => e.date >= now - 86_400_000 && e.date <= now + 7 * 86_400_000)
    .slice(0, 2);
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

function ShortBalanceBadge({
  short,
}: {
  short: StockSnapshot["shortBalance"];
}) {
  if (!short?.ratio) return null;
  const pct = short.ratio * 100;
  return (
    <Badge variant={pct >= 2 ? "warn" : "neutral"} size="sm">
      공매도 {pct.toFixed(1)}%
    </Badge>
  );
}
