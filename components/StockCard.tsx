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
import { CardSparkline } from "./CardSparkline";
import { PredictionBlock } from "./PredictionBlock";
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

// 카드 가로 폭 제약 안에서 H/L 라벨을 한 줄로 유지하기 위한 컴팩트 가격 포맷.
// KRW: 6자리 가격 → "319.5K" / "1.81M". USD: 2자리 그대로(짧음).
function fmtCompactPrice(v: number | null | undefined, currency: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (currency === "USD") return v.toFixed(2);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString("ko-KR");
}

const SIGNAL_VARIANT = {
  BUY: "buy",
  ADD: "add",
  HOLD: "hold",
  WATCH: "watch",
  SELL: "sell",
} as const;

type SignalKey = keyof typeof SIGNAL_VARIANT;

export function StockCard({ snap, onSelect, selected, krwRate, kisActive, priceOverride }: {
  snap: StockSnapshot;
  onSelect?: (code: string) => void;
  selected?: boolean;
  /** USDKRW 환율 — USD 종목 원화 병기에 사용. null이면 보조 표시 생략. */
  krwRate?: number | null;
  /** KIS Open API 활성 여부. DashboardSnapshot.kisActive 미러 — 펀더멘털 안내 분기. */
  kisActive?: boolean;
  /**
   * KIS WebSocket H0STCNT0(체결가) 실시간 override. `useRealtime` 훅이 흘려보낸 최신 체결가.
   * 정규장 진행 중일 때만 적용되며, 시간외/장마감 상태이면 무시한다.
   * 등락 절대값/등락률은 `quote.prevClose` 로 즉석 재계산.
   * undefined/null/비정상 값이면 기존 snapshot 그대로 사용 (회귀 0).
   */
  priceOverride?: number | null;
}) {
  const { meta, quote, tech, analysis, consensus } = snap;

  // 메인 가격 — "지금 진행 중인 거래"가 있으면 그게 메인.
  // secondary(시간외 vs 정규장 종가)는 StockFundamentalsBlock에서 자동 노출.
  const { primary } = pickPrimaryQuote(quote);
  // 통화 — 한국 종목은 KRW(보조 표시 생략), 미국 종목은 USD(원화 병기).
  const currency = currencyOf(meta.code, meta.currency);

  // 실시간 override 적용 조건:
  //  - priceOverride 가 양수 finite
  //  - 메인이 정규장 라이브 (시간외/마감 상태에서는 무시 → 시간외 가격이 덮이지 않게)
  //  - quote.prevClose 가 있어야 등락 재계산 가능
  const liveOverride =
    typeof priceOverride === "number" &&
    Number.isFinite(priceOverride) &&
    priceOverride > 0 &&
    primary.isLive &&
    !primary.isExtended &&
    typeof quote.prevClose === "number" &&
    quote.prevClose > 0
      ? priceOverride
      : null;

  const livePrice = liveOverride ?? primary.price;
  const liveChangeAbs =
    liveOverride != null && typeof quote.prevClose === "number"
      ? liveOverride - quote.prevClose
      : primary.changeAbs;
  const liveChangeRate =
    liveOverride != null && typeof quote.prevClose === "number" && quote.prevClose > 0
      ? (liveOverride - quote.prevClose) / quote.prevClose
      : primary.changeRate;

  const trendIcon =
    liveChangeRate > 0 ? <TrendingUp className="h-4 w-4" /> :
    liveChangeRate < 0 ? <TrendingDown className="h-4 w-4" /> :
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
            {/* 공매도 잔고 — KIS 활성 시. 비율 ≥ 2% 면 warn 톤, 그 외 neutral. */}
            <ShortBalanceBadge short={snap.shortBalance} />
          </div>
        </div>
        {/* 메인 결론 — 단·장기 통합 verdict. 카드 한눈 스캔용. */}
        <Badge variant={analysis.verdict.tone} size="md">
          {analysis.verdict.label}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* 가격 + 인라인 sparkline.
            큰 가격 숫자 우측에 가로로 길게 늘어난 미니 라인 → Toss 증권 카드 스타일.
            sparkline 색상은 오늘 시가 vs 현재가 기준으로 자동 (var(--color-up)/down). */}
        <div className="min-w-0 flex-1">
          <div className="flex items-end gap-3">
            <div
              className={`text-xl font-bold tabular leading-none shrink-0 ${changeColor(liveChangeRate)}`}
            >
              <PriceTicker
                value={livePrice}
                decimals={currency === "USD" ? 2 : 0}
              />
            </div>
            <CardSparkline
              code={meta.code}
              currentPrice={quote.price}
              height={32}
              className="flex-1 min-w-[140px]"
            />
          </div>
            {/* USD 종목 — 환율 적용 원화 병기. 잘 보이도록 본문 톤 medium + md 사이즈. */}
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
            <div className="flex items-center justify-between gap-2 mt-1">
              <div className={`tabular text-sm inline-flex items-center gap-1 ${changeColor(liveChangeRate)}`}>
                {trendIcon}
                {fmtSigned(liveChangeAbs)} ({fmtPercent(liveChangeRate)})
              </div>
              <div className="text-[10px] text-muted-foreground tabular shrink-0 whitespace-nowrap">
                H <span className="text-foreground">{fmtCompactPrice(quote.high, currency)}</span>
                <span className="mx-1 opacity-50">·</span>
                L <span className="text-foreground">{fmtCompactPrice(quote.low, currency)}</span>
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

        {/* 펀더멘털 블록 — 시간외 secondary + 거래량/RSI + 수급(외인/기관/개인 당일·5일·출처).
            StockDetailPanel "수급" 탭과 동일 컴포넌트 재사용. */}
        <StockFundamentalsBlock
          snap={snap}
          krwRate={krwRate}
          variant="card"
          kisActive={kisActive}
        />
        

        {/* 분석 — 메인 결론(verdict)을 위로 크게, 단기/장기 상세는 접힘으로 정리.
            "사라는 건지 말라는 건지" 피드백에 맞춰 1초 안에 행동을 정하도록 통합.

            데스크탑에서 여러 카드를 한 줄에 두고 비교할 때 모든 카드에 같은 배지가
            보여야 직관적이라는 사용자 피드백에 따라, 선택 여부와 무관하게 단·장기/
            변동성/기회/리스크 배지를 항상 노출한다. 모바일 중복은 W4(Detail 패널이
            열렸을 때 카드 자동 숨김)로 이미 해결됨. */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs text-muted-foreground tracking-wide uppercase">
            분석
          </div>

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

        {/* 예측 블록 — 기존 상단 PredictionHero 의 핵심(1일/1주 범위 막대 · 매수/매도 강도 ·
            손익비 · 손절·목표가 · 오늘 진폭 · 변동성 점수 · 변동성 모델 · 이벤트 부풀림)
            을 카드 안으로 흡수. 모바일에서 카드 자체로 결정 가능하도록. */}
        <PredictionBlock snap={snap} krwRate={krwRate} />

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

// 공매도 잔고 배지 — 비율 ≥ 2.5% 이면 warn, ≥ 1% 이면 neutral, 그 미만 미노출.
// 데이터 자체가 없으면 미노출 (KIS 비활성 / 응답 실패).
function ShortBalanceBadge({
  short,
}: {
  short: import("@/lib/types").ShortBalanceData | null | undefined;
}) {
  if (!short || short.ratio == null) return null;
  const pct = short.ratio * 100;
  if (pct < 1) return null;
  const tone: "warn" | "neutral" = pct >= 2.5 ? "warn" : "neutral";
  return (
    <Badge
      variant={tone}
      size="sm"
      title={`공매도 잔고 비율 ${pct.toFixed(2)}%${
        short.asOf
          ? ` · 기준 ${new Date(short.asOf).toLocaleDateString("ko-KR", {
              month: "2-digit",
              day: "2-digit",
            })}`
          : ""
      }`}
    >
      공매도 {pct.toFixed(1)}%
    </Badge>
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
