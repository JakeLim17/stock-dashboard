"use client";

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
import { PriceTicker } from "./PriceTicker";
import { PriceWithKrw } from "./PriceWithKrw";
import { StockFundamentalsBlock } from "./StockFundamentalsBlock";
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

// 단기·장기 시그널 → 사용자 표시 라벨/색 (상세 영역에서만 사용)
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

type SignalKey = keyof typeof SIGNAL_VARIANT;

export function StockCard({ snap, onSelect, selected, krwRate }: {
  snap: StockSnapshot;
  onSelect?: (code: string) => void;
  selected?: boolean;
  /** USDKRW 환율 — USD 종목 원화 병기에 사용. null이면 보조 표시 생략. */
  krwRate?: number | null;
}) {
  const { meta, quote, tech, analysis, consensus } = snap;

  // 메인 가격 — "지금 진행 중인 거래"가 있으면 그게 메인.
  // secondary(시간외 vs 정규장 종가)는 StockFundamentalsBlock에서 자동 노출.
  const { primary } = pickPrimaryQuote(quote);
  // 통화 — 한국 종목은 KRW(보조 표시 생략), 미국 종목은 USD(원화 병기).
  const currency = currencyOf(meta.code, meta.currency);

  const trendIcon =
    primary.changeRate > 0 ? <TrendingUp className="h-4 w-4" /> :
    primary.changeRate < 0 ? <TrendingDown className="h-4 w-4" /> :
    <Minus className="h-4 w-4" />;

  const market = marketDisplayLabel(quote);

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
            {/* 분야 대장주 배지 (재미 요소) — 종목명 옆 amber 톤 👑 */}
            <SectorLeaderBadge meta={meta} size="sm" />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span>{meta.code}</span>
            <Badge variant={market.variant}>{market.label}</Badge>
            {/* 한국거래소 시장경보 — 헤더에서 한눈에 보이도록 시장 상태 배지 옆에 노출 */}
            <MarketAlertBadge alert={quote.marketAlert} />
            {/* 시그널 마크 — 신고가/거래량폭발/외인픽 등 한눈에 보이는 신호. 자리가 좁으면 wrap. */}
            <SignalMarkBadges marks={snap.signalMarks} size="sm" />
            {/* 7일 이내 가격 이벤트(실적/배당) D-N — 임박 알림용. 7일 초과는 EventCalendar에서만. */}
            <UpcomingEventBadges events={snap.upcomingEvents} />
          </div>
        </div>
        {/* 메인 결론 — 단·장기 통합 verdict. 카드 한눈 스캔용. */}
        <Badge variant={analysis.verdict.tone} size="md">
          {analysis.verdict.label}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* 가격 — 메인은 항상 "지금 진행 중인 거래". 시간외 거래중이면 시간외가 메인. */}
        <div className="flex items-end justify-between">
          <div>
            <div className={`text-3xl font-bold ${changeColor(primary.changeRate)}`}>
              <PriceTicker value={primary.price} decimals={0} />
            </div>
            {/* USD 종목 — 환율 적용 원화 보조 표시. 환율 없으면 자동 생략. */}
            {currency === "USD" && (
              <div className="text-[11px] mt-0.5">
                <PriceWithKrw
                  price={primary.price}
                  currency={currency}
                  krwRate={krwRate ?? null}
                />
              </div>
            )}
            <div className={`tabular text-sm mt-1 inline-flex items-center gap-1 ${changeColor(primary.changeRate)}`}>
              {trendIcon}
              {fmtSigned(primary.changeAbs)} ({fmtPercent(primary.changeRate)})
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
                {(() => {
                  const f = priceFreshness(primary.time);
                  if (!f) return null;
                  return (
                    <span className={f.stale ? "text-warn" : "text-muted-foreground"}>
                      · {f.label}
                    </span>
                  );
                })()}
              </div>
            ) : primary.time ? (
              (() => {
                const f = priceFreshness(primary.time);
                const isStale = !!f?.stale;
                return (
                  <div
                    className={`text-[11px] mt-1 tabular flex items-center gap-1.5 flex-wrap ${
                      isStale ? "text-warn" : "text-muted-foreground"
                    }`}
                  >
                    <span>
                      {primary.isLive ? "기준 " : `${primary.sessionLabel} · `}
                      {priceTimeLabel(primary.time)}
                    </span>
                    {f && (
                      <span className={isStale ? "" : "text-muted-foreground"}>
                        · {f.label}
                      </span>
                    )}
                  </div>
                );
              })()
            ) : null}
          </div>
          <div className="text-right text-xs text-muted-foreground space-y-1">
            <div>고가 <span className="tabular text-foreground">{fmtNumber(quote.high, 0)}</span></div>
            <div>저가 <span className="tabular text-foreground">{fmtNumber(quote.low, 0)}</span></div>
          </div>
        </div>

        {/* 펀더멘털 블록 — 시간외 secondary + 거래량/RSI + 수급(외인/기관/개인 당일·5일·출처).
            StockDetailPanel "수급" 탭과 동일 컴포넌트 재사용. */}
        <StockFundamentalsBlock snap={snap} krwRate={krwRate} variant="card" />
        

        {/* 분석 — 메인 결론(verdict)을 위로 크게, 단기/장기 상세는 접힘으로 정리.
            "사라는 건지 말라는 건지" 피드백에 맞춰 1초 안에 행동을 정하도록 통합.

            선택 카드(데스크탑 전용 노출)에서는 단·장기/변동성/기회/리스크 배지를
            Detail 패널 헤더에서 이미 보여주므로 중복 제거. verdict.headline은 카드별
            액션 가이드 문장이라 항상 노출. */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs text-muted-foreground tracking-wide uppercase">
            분석
          </div>

          {!selected && (
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
          )}
          <p className="text-sm font-semibold leading-snug">
            {analysis.verdict.headline}
          </p>

          {/* 추세 배지(공통) — Detail 패널에는 없는 카드 고유 정보라 선택 여부와 무관하게 유지. */}
          {(tech.trend === "uptrend" || tech.trend === "downtrend") && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {tech.trend === "uptrend" && (
                <Badge variant="good">상승추세</Badge>
              )}
              {tech.trend === "downtrend" && (
                <Badge variant="bad">하락추세</Badge>
              )}
            </div>
          )}

          {/* 상세 — 단기/장기 시그널 + 근거 (기본 접힘) */}
          <details className="group [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer list-none text-[11px] text-muted-foreground hover:text-foreground select-none inline-flex items-center gap-1 mt-1">
              <span className="group-open:hidden">상세 보기 ▾</span>
              <span className="hidden group-open:inline">상세 닫기 ▴</span>
            </summary>
            <div className="mt-2 space-y-2 pt-2 border-t border-border/60">
              <SignalRow
                label="단기"
                signal={analysis.shortTerm.signal}
                headline={analysis.shortTerm.headline}
                chips={[
                  `과열 ${analysis.heatScore}`,
                  `매수우위 ${analysis.buyScore}`,
                ]}
              />
              <SignalRow
                label="장기"
                signal={analysis.longTerm.signal}
                headline={analysis.longTerm.headline}
                chips={longTermChips(snap)}
              />
              <ul className="text-[11px] text-muted-foreground space-y-0.5 pl-9">
                {analysis.shortTerm.reasons.slice(0, 2).map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
            </div>
          </details>
        </div>

        {/* 예상 변동 범위 — 1일/1주 horizon을 stack으로 노출. 카드만 보고도 즉시 판단 가능.
            오늘(1일) 진폭은 ATR/분봉 가중 intradayRange를 우선 사용해 더 현실에 가깝게. */}
        {(() => {
          const ranges = snap.predictions?.ranges;
          const intradayRange = snap.predictions?.intradayRange;
          if (!ranges || quote.price <= 0) return null;
          const oneDay = ranges.find((r) => r.horizonDays === 1);
          const oneWeek = ranges.find((r) => r.horizonDays === 5);
          if (!oneWeek) return null;
          const rows: { label: string; low: number; high: number; suffix?: string }[] = [];
          if (intradayRange && intradayRange.expectedRangePct > 0) {
            rows.push({
              label: "오늘",
              low: intradayRange.expectedLow / quote.price - 1,
              high: intradayRange.expectedHigh / quote.price - 1,
              suffix:
                intradayRange.source === "intraday-blend" ? "분봉" : "ATR",
            });
          } else if (oneDay) {
            rows.push({
              label: "1일",
              low: oneDay.low / quote.price - 1,
              high: oneDay.high / quote.price - 1,
            });
          }
          rows.push({
            label: "1주",
            low: oneWeek.low / quote.price - 1,
            high: oneWeek.high / quote.price - 1,
          });
          return (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] tabular space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">예상 변동 범위</span>
                <span className="text-muted-foreground text-[10px]">68%</span>
              </div>
              <div className="space-y-0.5">
                {rows.map((r) => (
                  <div
                    key={r.label}
                    className="flex items-center justify-between"
                  >
                    <span className="text-muted-foreground">
                      {r.label}
                      {r.suffix && (
                        <span className="ml-1 text-[9px] opacity-70">
                          · {r.suffix}
                        </span>
                      )}
                    </span>
                    <span className="font-medium">
                      <span className="text-down">{fmtPercent(r.low, 1)}</span>
                      {" ~ "}
                      <span className="text-up">{fmtPercent(r.high, 1)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* 컨센서스 한 줄 — 평균 목표가, 상승여력, Strong Buy / Buy / Hold 분포.
            한국 종목인 경우 국내(국내 N사) 평균 + 통합 평균 두 줄로 분리 노출. */}
        {consensus && consensus.targetMean != null && (
          <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] tabular space-y-1">
            {consensus.domesticMean != null &&
              (consensus.domesticCount ?? 0) > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">
                    국내 {consensus.domesticCount}사 평균
                  </span>
                  <span className="font-medium text-right">
                    <span>{fmtNumber(consensus.domesticMean, 0)}</span>
                    {consensus.domesticUpsidePercent != null && (
                      <span
                        className={`ml-1.5 ${changeColor(consensus.domesticUpsidePercent)}`}
                      >
                        ({fmtPercent(consensus.domesticUpsidePercent, 1)})
                      </span>
                    )}
                  </span>
                </div>
              )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground shrink-0">
                {consensus.domesticMean != null ? "통합 평균" : "컨센서스"}
              </span>
              <span className="font-medium text-right">
                <span>{fmtNumber(consensus.targetMean, 0)}</span>
                {consensus.upsidePercent != null && (
                  <span
                    className={`ml-1.5 ${changeColor(consensus.upsidePercent)}`}
                  >
                    ({fmtPercent(consensus.upsidePercent, 1)})
                  </span>
                )}
                {(consensus.strongBuy + consensus.buy + consensus.hold) > 0 && (
                  <span className="text-muted-foreground ml-1.5 text-[10px]">
                    · SB {consensus.strongBuy}/{consensus.buy}/{consensus.hold}
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// 단기 / 장기 한 줄 — 배지 + 헤드라인 + 작은 점수 칩.
// 모바일에선 헤드라인이 다음 줄로 stack.
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
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-9">
          {chips.map((c) => (
            <span
              key={c}
              className="text-[10px] tabular text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// 카드 헤더용 — 다가올 가격 이벤트(실적/배당) 중 7일 이내인 것만 D-N 배지로.
// EventItem.kind 가 종목 관련(earnings/dividend)이라는 전제. 매크로는 EventCalendar 에서만.
function UpcomingEventBadges({ events }: { events: EventItem[] | undefined }) {
  if (!events || events.length === 0) return null;
  const now = Date.now();
  const cutoff = now + 7 * 86_400_000;
  const within = events
    .filter((e) => e.kind === "earnings" || e.kind === "dividend")
    .filter((e) => e.date >= now - 86_400_000 && e.date <= cutoff)
    .slice(0, 2);
  if (within.length === 0) return null;
  return (
    <>
      {within.map((e) => {
        const dn = Math.round((e.date - now) / 86_400_000);
        const isUrgent = dn <= 1;
        const emoji = e.kind === "earnings" ? "📊" : "💰";
        const kindShort = e.kind === "earnings" ? "실적" : "배당";
        return (
          <Badge
            key={`${e.kind}-${e.date}`}
            variant={isUrgent ? "warn" : "neutral"}
            size="sm"
            title={e.label + (e.detail ? ` · ${e.detail}` : "")}
          >
            {emoji} {kindShort} {dnLabel(dn)}
          </Badge>
        );
      })}
    </>
  );
}

// 장기 시그널 옆에 보일 작은 컨센·밸류 요약 칩. 데이터 없으면 빈 배열.
function longTermChips(snap: StockSnapshot): string[] {
  const chips: string[] = [];
  const c = snap.consensus;
  const v = snap.consensusValuation;
  if (c?.upsidePercent != null) {
    const sign = c.upsidePercent >= 0 ? "+" : "";
    chips.push(`컨센 ${sign}${(c.upsidePercent * 100).toFixed(0)}%`);
  }
  if (v?.forwardPer != null) {
    chips.push(`추정PER ${v.forwardPer.toFixed(1)}`);
  } else if (v?.per != null) {
    chips.push(`PER ${v.per.toFixed(1)}`);
  }
  return chips;
}
