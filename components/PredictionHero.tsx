"use client";

import type { StockSnapshot } from "@/lib/types";
import { Badge } from "./ui/Badge";
import { PriceTicker } from "./PriceTicker";
import { PriceWithKrw } from "./PriceWithKrw";
import {
  changeColor,
  currencyOf,
  fmtNumber,
  fmtPercent,
  fmtSigned,
  pickPrimaryQuote,
} from "@/lib/utils";
import { LineChart, TrendingUp } from "lucide-react";

// 대시보드 최상단 "예측 Hero" — 선택된 종목 1개의 단기 예측을 큰 시각으로 노출.
// 사용자가 시스템 열자마자 "이 종목 단기 어디까지 갈 수 있는지"를 한눈에 본다.
//
// 레이아웃 (lg+ 3-col):
//   좌 — 종목명 + 현재가 + verdict 메인 배지
//   중 — 1일/7일 예측 범위 가로 막대 + 현재가 마커
//   우 — 매수/매도 강도 게이지 + Risk-Reward
//
// 클릭 시 StockDetailPanel "예측" 탭으로 스크롤(부모가 onJumpToPrediction 핸들러 전달).
export function PredictionHero({
  snap,
  onJumpToPrediction,
  krwRate,
}: {
  snap?: StockSnapshot | null;
  onJumpToPrediction?: () => void;
  /** USDKRW 환율 — USD 종목 원화 병기에 사용. 없으면 보조 표시 생략. */
  krwRate?: number | null;
}) {
  if (!snap) return null;

  const { primary } = pickPrimaryQuote(snap.quote);
  const p = snap.predictions;
  const verdict = snap.analysis.verdict;
  const currency = currencyOf(snap.meta.code, snap.meta.currency);
  const oneDay = p?.ranges.find((r) => r.horizonDays === 1) ?? null;
  const oneWeek = p?.ranges.find((r) => r.horizonDays === 5) ?? null;
  const buyStrength = p?.strength.buy ?? snap.analysis.buyScore;
  const sellStrength = p?.strength.sell ?? snap.analysis.heatScore;
  const rr = p?.targets?.riskReward ?? null;
  const intradayRange = p?.intradayRange ?? null;
  const volatility = snap.analysis.volatility ?? null;
  const volModel = p?.volatilityModel ?? null;
  const eventVol = p?.eventVolatility ?? null;
  // 변동성 모델 라벨 — 신규 응답엔 항상 채워지지만, 옛 캐시 호환 위해 폴백.
  const modelLabel =
    volModel?.kind === "ewma-t"
      ? `EWMA · t분포(df=${volModel.df ?? 5}) · ${Math.round((volModel.confidence ?? 0.95) * 100)}% 신뢰`
      : "최근 90일 변동성 기반";

  const handleClick = () => {
    onJumpToPrediction?.();
  };

  return (
    <section
      role={onJumpToPrediction ? "button" : undefined}
      tabIndex={onJumpToPrediction ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (!onJumpToPrediction) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`relative overflow-hidden rounded-2xl border-2 border-accent/40 bg-gradient-to-br from-accent/10 via-card to-card shadow-md ${
        onJumpToPrediction ? "cursor-pointer transition-shadow hover:shadow-lg" : ""
      }`}
    >
      <div className="px-5 py-4 md:py-5">
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wider text-accent font-semibold">
            <LineChart className="h-3.5 w-3.5" />
            예측 Hero · 선택 종목
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* 이벤트 부풀림 배지 — D-day 임박 시 noisy하지 않도록 factor>1.05 일 때만 노출.
                예: "📅 실적 D-2 · 범위 +60%" — 사용자가 "오늘 예측 폭이 왜 크지?" 의문을 즉시 해소. */}
            {eventVol && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 text-warn px-2 py-0.5 text-[11px] font-medium"
                title={`${eventVol.eventLabel} (D${eventVol.daysToEvent >= 0 ? "-" : "+"}${Math.abs(eventVol.daysToEvent)}) — σ × ${eventVol.factor.toFixed(2)} 적용`}
              >
                📅 {eventVol.shortLabel} D
                {eventVol.daysToEvent >= 0
                  ? `-${eventVol.daysToEvent}`
                  : `+${Math.abs(eventVol.daysToEvent)}`}{" "}
                · 범위 +{Math.round((eventVol.factor - 1) * 100)}%
              </span>
            )}
            {p && (
              <span className="text-[11px] text-muted-foreground">
                {modelLabel}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          {/* 좌 — 종목 정체 + 현재가 + verdict */}
          <div className="lg:col-span-3 space-y-2">
            <div className="text-xs text-muted-foreground">
              {snap.meta.code}
            </div>
            <div className="text-xl md:text-2xl font-bold leading-tight">
              {snap.meta.name}
            </div>
            <div
              className={`text-2xl md:text-3xl font-bold ${changeColor(primary.changeRate)}`}
            >
              <PriceTicker value={primary.price} decimals={0} />
            </div>
            {/* USD 종목 — 환율 적용 원화 보조. 환율 없으면 자동 생략. */}
            {currency === "USD" && (
              <div className="text-xs">
                <PriceWithKrw
                  price={primary.price}
                  currency={currency}
                  krwRate={krwRate ?? null}
                />
              </div>
            )}
            <div
              className={`tabular text-sm ${changeColor(primary.changeRate)}`}
            >
              {fmtSigned(primary.changeAbs)} ({fmtPercent(primary.changeRate)})
            </div>
            <div className="pt-1">
              <Badge variant={verdict.tone} size="lg">
                {verdict.label}
              </Badge>
            </div>
          </div>

          {/* 중 — 1일/7일 예측 범위 가로 막대 */}
          <div className="lg:col-span-6 space-y-3">
            {p && (oneDay || oneWeek) ? (
              <>
                {oneDay && (
                  <PredictionRangeRow
                    horizonLabel="1일 후"
                    currentPrice={snap.quote.price}
                    low={oneDay.low}
                    high={oneDay.high}
                    center={oneDay.center}
                  />
                )}
                {oneWeek && (
                  <PredictionRangeRow
                    horizonLabel="1주 후"
                    currentPrice={snap.quote.price}
                    low={oneWeek.low}
                    high={oneWeek.high}
                    center={oneWeek.center}
                  />
                )}
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                예측 데이터를 산정하지 못했습니다.
              </div>
            )}
            {/* verdict.headline 한 줄 */}
            <div className="text-sm font-semibold leading-snug pt-1 border-t border-border/60">
              {verdict.headline}
            </div>
            {/* 오늘 진폭 + 변동성 점수 한 줄 — 도박장 등급은 톤 강조. */}
            {(intradayRange || volatility) && (
              <div className="flex items-center gap-3 flex-wrap text-[12px] tabular pt-0.5">
                {intradayRange && intradayRange.expectedRangePct > 0 && (
                  <span className="text-muted-foreground">
                    오늘 진폭{" "}
                    <span className="font-semibold text-foreground">
                      ±{(intradayRange.expectedRangePct * 100).toFixed(1)}%
                    </span>
                    {intradayRange.source === "intraday-blend" && (
                      <span className="ml-1 text-[10px] opacity-70">
                        · 분봉
                      </span>
                    )}
                  </span>
                )}
                {volatility && volatility.level !== "stable" && (
                  <span
                    className={`font-medium ${
                      volatility.level === "gambling"
                        ? "text-down"
                        : volatility.level === "high"
                          ? "text-warn"
                          : "text-muted-foreground"
                    }`}
                  >
                    변동성 점수{" "}
                    <span className="tabular font-semibold">
                      {volatility.score}
                    </span>
                    {volatility.level === "gambling" && " · 도박장 ⚠"}
                    {volatility.level === "high" && " · 고변동"}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 우 — 매수/매도 강도 + RR */}
          <div className="lg:col-span-3 space-y-3">
            <StrengthGauge
              label="매수 강도"
              value={buyStrength}
              color="bg-up"
            />
            <StrengthGauge
              label="매도 강도"
              value={sellStrength}
              color="bg-down"
            />
            <div className="rounded-lg border border-border bg-background px-3 py-2 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">손익비</span>
              <span className="tabular text-sm font-semibold">
                {rr != null ? (
                  <>
                    1 : {rr.toFixed(2)}
                    {rr >= 2 && <span className="ml-1.5 text-up">우수</span>}
                    {rr < 1 && rr > 0 && (
                      <span className="ml-1.5 text-down">불리</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </div>
            {p?.targets && (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-md bg-muted/40 px-2 py-1.5">
                  <div className="text-muted-foreground">손절</div>
                  <div className="tabular font-semibold text-down">
                    {fmtNumber(p.targets.stopLoss, 0)}
                  </div>
                  {currency === "USD" && (
                    <div className="text-[10px] leading-tight mt-0.5">
                      <PriceWithKrw
                        price={p.targets.stopLoss}
                        currency={currency}
                        krwRate={krwRate ?? null}
                        prefix=""
                      />
                    </div>
                  )}
                </div>
                <div className="rounded-md bg-muted/40 px-2 py-1.5">
                  <div className="text-muted-foreground">목표1</div>
                  <div className="tabular font-semibold text-up">
                    {fmtNumber(p.targets.takeProfit1, 0)}
                  </div>
                  {currency === "USD" && (
                    <div className="text-[10px] leading-tight mt-0.5">
                      <PriceWithKrw
                        price={p.targets.takeProfit1}
                        currency={currency}
                        krwRate={krwRate ?? null}
                        prefix=""
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {onJumpToPrediction && (
          <div className="mt-3 text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            상세 예측 보기 · 클릭하면 아래 예측 탭으로 이동
          </div>
        )}
      </div>
    </section>
  );
}

// 한 줄 — 예측 범위 막대 + low/high 라벨.
// 현재가는 마커로 표시. low~high 양 끝에 ± 변동률을 같이 노출해 직관성을 높인다.
function PredictionRangeRow({
  horizonLabel,
  currentPrice,
  low,
  high,
  center,
}: {
  horizonLabel: string;
  currentPrice: number;
  low: number;
  high: number;
  center: number;
}) {
  const span = high - low;
  if (span <= 0 || currentPrice <= 0) return null;
  const padding = span * 0.2;
  const visLow = low - padding;
  const visHigh = high + padding;
  const totalSpan = visHigh - visLow;
  const pct = (v: number) =>
    Math.max(0, Math.min(100, ((v - visLow) / totalSpan) * 100));
  const lowPct = pct(low);
  const highPct = pct(high);
  const centerPct = pct(center);
  const currentPct = pct(currentPrice);
  const inRange = currentPrice >= low && currentPrice <= high;
  const lowDelta = low / currentPrice - 1;
  const highDelta = high / currentPrice - 1;

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-muted-foreground uppercase tracking-wider">
          {horizonLabel}
        </span>
        <span className="tabular text-muted-foreground">
          ± {fmtPercent((high - low) / (2 * currentPrice), 1).replace("+", "")}
        </span>
      </div>
      <div className="relative h-3 w-full">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-muted rounded-full" />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2 bg-accent/40 rounded-full"
          style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-accent"
          style={{ left: `${centerPct}%` }}
          title={`중심 ${fmtNumber(center, 0)}`}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 h-4 w-1 rounded ${
            inRange ? "bg-foreground" : "bg-warn"
          }`}
          style={{ left: `calc(${currentPct}% - 2px)` }}
          title={`현재가 ${fmtNumber(currentPrice, 0)}`}
        />
      </div>
      <div className="flex items-center justify-between mt-1 text-[11px] tabular">
        <span className="text-down">
          {fmtNumber(low, 0)}
          <span className="text-muted-foreground ml-1">
            ({fmtPercent(lowDelta, 1)})
          </span>
        </span>
        <span className="text-up">
          {fmtNumber(high, 0)}
          <span className="text-muted-foreground ml-1">
            ({fmtPercent(highDelta, 1)})
          </span>
        </span>
      </div>
    </div>
  );
}

function StrengthGauge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular font-semibold">{value}</span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}
