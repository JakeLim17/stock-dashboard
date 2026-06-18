"use client";

import { useEffect, useMemo, useState } from "react";
import type { StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { PriceWithKrw } from "./PriceWithKrw";
import {
  changeColor,
  currencyOf,
  fmtNumber,
  fmtPercent,
  fmtRelative,
} from "@/lib/utils";
import {
  Crosshair,
  LineChart,
  MoonStar,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

// 통계 기반 예측 패널. 내부 종목 선택을 지원해 카드 선택과 별도로 비교 가능.
//
// embedded=true 면 헤더/selector를 숨겨 StockDetailPanel 같은 부모 컨테이너 안에
// 깔끔하게 임베드된다. 부모가 헤더와 종목 결정을 책임지므로 selectedCode 1개만 사용.
export function PredictionPanel({
  snaps,
  selectedCode,
  embedded = false,
  krwRate,
  detailDefaultOpen = false,
}: {
  snaps: StockSnapshot[];
  selectedCode?: string;
  embedded?: boolean;
  /** USDKRW 환율 — USD 종목 SL/TP1/TP2/진입가 원화 병기에 사용. 없으면 보조 표시 생략. */
  krwRate?: number | null;
  /** 모바일 모달(MobileDetailSheet) 안에서는 sheet 자체가 좁아 접힘이 어색하다.
   *  true 면 "상세 예측 보기" details 를 기본 펼쳐서 노출. 데스크탑 패널에선 기본 false 유지. */
  detailDefaultOpen?: boolean;
}) {
  const [activeCode, setActiveCode] = useState(
    () => selectedCode ?? snaps[0]?.meta.code ?? ""
  );

  useEffect(() => {
    if (selectedCode) setActiveCode(selectedCode);
  }, [selectedCode]);

  useEffect(() => {
    if (snaps.some((s) => s.meta.code === activeCode)) return;
    setActiveCode(snaps[0]?.meta.code ?? "");
  }, [activeCode, snaps]);

  const snap = useMemo(
    () => snaps.find((s) => s.meta.code === activeCode) ?? snaps[0],
    [activeCode, snaps]
  );

  if (!snap) {
    if (embedded) {
      return (
        <p className="text-sm text-muted-foreground">
          데이터가 충분하지 않아 변동 참고 구간을 표시할 수 없습니다.
        </p>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>가격 변동 추정</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-muted-foreground">
            데이터가 충분하지 않아 변동 참고 구간을 표시할 수 없습니다.
          </p>
        </CardBody>
      </Card>
    );
  }

  const p = snap.predictions;
  const price = snap.quote.price;

  if (!p) {
    if (embedded) {
      return (
        <p className="text-sm text-muted-foreground">
          데이터가 충분하지 않아 변동 참고 구간을 표시할 수 없습니다.
        </p>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>가격 변동 추정 — {snap.meta.name}</CardTitle>
        </CardHeader>
        <CardBody>
          <StockSelector
            snaps={snaps}
            activeCode={snap.meta.code}
            onSelect={setActiveCode}
          />
          <p className="text-sm text-muted-foreground">
            데이터가 충분하지 않아 변동 참고 구간을 표시할 수 없습니다.
          </p>
        </CardBody>
      </Card>
    );
  }

  const oneDay = p.ranges.find((r) => r.horizonDays === 1);
  const oneWeek = p.ranges.find((r) => r.horizonDays === 5);
  const primaryRange = oneDay ?? oneWeek ?? p.ranges[0];
  // 활성 종목 통화 — USD면 진입/손절/목표 가격에 원화 병기. KRW면 보조 표시 생략(회귀 방지).
  const currency = currencyOf(snap.meta.code, snap.meta.currency);

  const inner = (
    <>
      {!embedded && (
        <StockSelector
          snaps={snaps}
          activeCode={snap.meta.code}
          onSelect={setActiveCode}
        />
      )}

        {/* embedded(StockDetailPanel)에서는 Hero와 중복되는 카드 3개(예상 범위/강도/손절·목표1)를 숨기고 Hero에 없는 카드만 노출 */}
        <div
          className={
            embedded
              ? "grid grid-cols-2 gap-3"
              : "grid grid-cols-2 lg:grid-cols-5 gap-3"
          }
        >
          {!embedded && (
            <SummaryCard
              label={primaryRange ? `${primaryRange.horizonLabel} 변동 참고` : "변동 참고"}
              value={
                primaryRange
                  ? `${fmtNumber(primaryRange.low)} ~ ${fmtNumber(primaryRange.high)}`
                  : "—"
              }
            />
          )}
          <SummaryCard
            label="해외 환산"
            value={
              p.nightSignal?.impliedKrwPrice
                ? fmtNumber(p.nightSignal.impliedKrwPrice)
                : "OFF/없음"
            }
            color={p.nightSignal ? changeColor(p.nightSignal.premiumRate) : ""}
          />
          <SummaryCard
            label="밸류 위험"
            value={p.valuation ? `${p.valuation.label} ${p.valuation.riskScore}` : "—"}
            color={valuationRiskColor(p.valuation?.riskScore)}
          />
          {!embedded && (
            <SummaryCard
              label="매수 / 매도 강도"
              value={`${p.strength.buy} / ${p.strength.sell}`}
            />
          )}
          {!embedded && (
            <SummaryCard
              label="손절 / 목표1"
              value={
                p.targets
                  ? `${fmtNumber(p.targets.stopLoss)} / ${fmtNumber(p.targets.takeProfit1)}`
                  : "—"
              }
            />
          )}
        </div>

        {p.nightSignal && <NightValuationCard signal={p.nightSignal} />}

        <details
          className="rounded-xl border border-border bg-muted/20 p-3"
          open={detailDefaultOpen ? true : undefined}
        >
          <summary className="cursor-pointer text-sm font-medium">
            상세 변동 구간 보기
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-5 pt-4">
            {/* A. 가격 범위 — 변동성 신뢰구간 (drift=0).
                신규(EWMA + t df=5)는 95% 신뢰, 옛 캐시(stddev + 정규)는 68%로 표기. */}
            {p.ranges.length > 0 && (
              <Section
                title={`변동성 범위 (${Math.round((p.ranges[0].confidence ?? 0.68) * 100)}% 신뢰)`}
                icon={<LineChart className="h-3.5 w-3.5" />}
              >
                <div className="space-y-2">
                  {p.ranges.map((r) => {
                    // drift=0 이라 center=현재가. 폭만 ±%로 표시.
                    const halfWidth =
                      price > 0 ? Math.max(r.high / price - 1, 1 - r.low / price) : 0;
                    return (
                      <div key={r.horizonDays} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {r.horizonLabel} 후
                          </span>
                          <span className="tabular text-muted-foreground text-[11px]">
                            ±{fmtPercent(halfWidth, 1).replace("+", "")}
                          </span>
                        </div>
                        <RangeBar
                          currentPrice={price}
                          low={r.low}
                          center={r.center}
                          high={r.high}
                        />
                        <div className="flex items-center justify-between text-[11px] tabular text-muted-foreground">
                          <span>{fmtNumber(r.low)}</span>
                          <span>{fmtNumber(r.high)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {p.targets && (
              <Section
                title="진입 · 손절 · 목표 (ATR 기반)"
                icon={<Crosshair className="h-3.5 w-3.5" />}
              >
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <PriceRow
                    label="진입 기준"
                    value={p.targets.entry}
                    currency={currency}
                    krwRate={krwRate ?? null}
                  />
                  <PriceRow
                    label="손절"
                    value={p.targets.stopLoss}
                    refPrice={price}
                    tone="down"
                    currency={currency}
                    krwRate={krwRate ?? null}
                  />
                  <PriceRow
                    label="목표 1"
                    value={p.targets.takeProfit1}
                    refPrice={price}
                    tone="up"
                    currency={currency}
                    krwRate={krwRate ?? null}
                  />
                  <PriceRow
                    label="목표 2"
                    value={p.targets.takeProfit2}
                    refPrice={price}
                    tone="up"
                    currency={currency}
                    krwRate={krwRate ?? null}
                  />
                  <PriceRow
                    label="지지선 (20일)"
                    value={p.targets.support}
                    currency={currency}
                    krwRate={krwRate ?? null}
                  />
                  <PriceRow
                    label="저항선 (20일)"
                    value={p.targets.resistance}
                    currency={currency}
                    krwRate={krwRate ?? null}
                  />
                </div>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/60 text-xs">
                  <span className="text-muted-foreground">손익비</span>
                  <span className="tabular font-medium">
                    {p.targets.riskReward != null ? (
                      <>
                        1 : {p.targets.riskReward.toFixed(2)}
                        {p.targets.riskReward >= 2 && (
                          <span className="text-up ml-1.5">우수</span>
                        )}
                        {p.targets.riskReward < 1 && p.targets.riskReward > 0 && (
                          <span className="text-down ml-1.5">불리</span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">계산 불가</span>
                    )}
                  </span>
                </div>
              </Section>
            )}

            {p.scenarios.length > 0 && (
              <Section
                title="시장 시나리오 (60일 회귀)"
                icon={<TrendingUp className="h-3.5 w-3.5" />}
              >
                <ul className="space-y-1.5 text-sm">
                  {p.scenarios.map((s, i) => {
                    const conf = s.confidence;
                    const isLow = conf === "low";
                    const confLabel =
                      conf === "high"
                        ? "높음"
                        : conf === "medium"
                          ? "보통"
                          : conf === "low"
                            ? "낮음"
                            : null;
                    const confTone =
                      conf === "high"
                        ? "text-up"
                        : conf === "medium"
                          ? "text-muted-foreground"
                          : "text-down";
                    return (
                      <li
                        key={`${s.label}-${i}`}
                        className={`flex items-center justify-between ${
                          isLow ? "opacity-60" : ""
                        }`}
                        title={
                          s.r2 != null
                            ? `회귀 적합도 R²=${s.r2.toFixed(2)} (시장이 종목을 ${(s.r2 * 100).toFixed(0)}% 설명)`
                            : undefined
                        }
                      >
                        <span className="text-muted-foreground">{s.label}</span>
                        <span
                          className={`tabular font-medium ${changeColor(s.expected)}`}
                        >
                          {fmtPercent(s.expected)}
                          <span className="text-[11px] text-muted-foreground ml-1.5 tabular">
                            β {s.beta.toFixed(2)}
                          </span>
                          {confLabel && (
                            <span
                              className={`text-[10px] ml-1.5 px-1.5 py-0.5 rounded border border-border ${confTone}`}
                            >
                              신뢰 {confLabel}
                              {s.r2 != null && (
                                <span className="ml-1 tabular">
                                  R² {s.r2.toFixed(2)}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            {p.valuation && (
              <Section
                title="밸류 위험 (PER/PBR)"
                icon={<TrendingDown className="h-3.5 w-3.5" />}
              >
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-3 gap-2">
                    <MiniMetric
                      label="PER"
                      value={p.valuation.per != null ? `${p.valuation.per.toFixed(1)}배` : "—"}
                    />
                    <MiniMetric
                      label="추정PER"
                      value={p.valuation.forwardPer != null ? `${p.valuation.forwardPer.toFixed(1)}배` : "—"}
                    />
                    <MiniMetric
                      label="PBR"
                      value={p.valuation.pbr != null ? `${p.valuation.pbr.toFixed(1)}배` : "—"}
                    />
                  </div>
                  <StrengthBar
                    label={`위험도 ${p.valuation.label}`}
                    value={p.valuation.riskScore}
                    color={
                      p.valuation.riskScore >= 45 ? "bg-down" : "bg-muted-foreground"
                    }
                  />
                  <ul className="text-xs text-muted-foreground space-y-1">
                    {p.valuation.reasons.map((r) => (
                      <li key={r}>· {r}</li>
                    ))}
                  </ul>
                </div>
              </Section>
            )}

            <Section
              title="신호 강도"
              icon={<TrendingDown className="h-3.5 w-3.5" />}
            >
              <StrengthBar label="매수 강도" value={p.strength.buy} color="bg-up" />
              <StrengthBar
                label="매도 강도"
                value={p.strength.sell}
                color="bg-down"
              />
            </Section>
          </div>
        </details>
    </>
  );

  // σ 배지 — 신규 응답엔 volatilityModel.dailySigma 가 직접 들어옴.
  // 옛 캐시 호환: 범위에서 역추출(stdSigma) 했지만 95% 신뢰구간 곱하기 t-multiplier 가 섞여있어
  // 부정확하므로 volatilityModel 우선.
  const dailySigmaPct =
    p.volatilityModel?.dailySigma != null
      ? p.volatilityModel.dailySigma
      : stdSigma(p);
  const modelLabel =
    p.volatilityModel?.kind === "ewma-t"
      ? `EWMA · t분포(df=${p.volatilityModel.df ?? 5}) · ${Math.round((p.volatilityModel.confidence ?? 0.95) * 100)}% 신뢰`
      : "최근 90일 변동성 기반";

  if (embedded) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground">{modelLabel}</span>
          <div className="flex items-center gap-2">
            {p.eventVolatility && (
              <Badge
                variant="warn"
                size="sm"
                className="shrink-0 whitespace-nowrap"
                title={`${p.eventVolatility.eventLabel} — σ × ${p.eventVolatility.factor.toFixed(2)} 부풀림 적용`}
              >
                📅 {p.eventVolatility.shortLabel} D
                {p.eventVolatility.daysToEvent >= 0
                  ? `-${p.eventVolatility.daysToEvent}`
                  : `+${Math.abs(p.eventVolatility.daysToEvent)}`}{" "}
                · +{Math.round((p.eventVolatility.factor - 1) * 100)}%
              </Badge>
            )}
            <Badge
              variant="neutral"
              size="sm"
              className="shrink-0 whitespace-nowrap"
            >
              σ {(dailySigmaPct * 100).toFixed(2)}%/일
            </Badge>
          </div>
        </div>
        {inner}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>가격 변동 추정</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">{modelLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {p.eventVolatility && (
            <Badge
              variant="warn"
              size="sm"
              className="shrink-0 whitespace-nowrap"
              title={`${p.eventVolatility.eventLabel} — σ × ${p.eventVolatility.factor.toFixed(2)} 부풀림 적용`}
            >
              📅 {p.eventVolatility.shortLabel} D
              {p.eventVolatility.daysToEvent >= 0
                ? `-${p.eventVolatility.daysToEvent}`
                : `+${Math.abs(p.eventVolatility.daysToEvent)}`}
            </Badge>
          )}
          <Badge
            variant="neutral"
            size="sm"
            className="shrink-0 whitespace-nowrap"
          >
            σ {(dailySigmaPct * 100).toFixed(2)}%/일
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">{inner}</CardBody>
    </Card>
  );
}

function StockSelector({
  snaps,
  activeCode,
  onSelect,
}: {
  snaps: StockSnapshot[];
  activeCode: string;
  onSelect: (code: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {snaps.map((s) => (
        <button
          key={s.meta.code}
          type="button"
          onClick={() => onSelect(s.meta.code)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            activeCode === s.meta.code
              ? "bg-foreground text-background border-foreground"
              : "bg-background border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          {s.meta.name}
        </button>
      ))}
    </div>
  );
}

type NightSignal = NonNullable<
  NonNullable<StockSnapshot["predictions"]>["nightSignal"]
>;

function NightValuationCard({ signal }: { signal: NightSignal }) {
  const premium = signal.premiumRate;
  const state = nightMarketState(signal.marketState);
  const staleMs =
    signal.time && signal.marketState?.toUpperCase() === "REGULAR"
      ? Date.now() - signal.time
      : 0;
  const isDelayed = staleMs > 15 * 60 * 1000;
  const isEur = signal.currency?.toUpperCase() === "EUR";
  const fxText = isEur
    ? `${fmtNumber(signal.price, 2)} × ${fmtNumber(signal.eurUsd, 4)} × ${fmtNumber(signal.usdKrw, 0)} ÷ ${signal.sharesPerReceipt ?? 1}`
    : `${fmtNumber(signal.price, 2)} × ${fmtNumber(signal.fxToKrw, 0)} ÷ ${signal.sharesPerReceipt ?? 1}`;

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Badge variant={state.variant} size="sm" className="mb-2">
            <MoonStar className="h-3 w-3" />
            {state.label}
          </Badge>
          <div className="text-sm text-muted-foreground">
            {signal.label} · {signal.source}
          </div>
        </div>
        <div className="text-right text-[11px] text-muted-foreground tabular whitespace-nowrap">
          {signal.fetchedAt && <div>조회 {fmtRelative(signal.fetchedAt)}</div>}
          {signal.time && <div>체결 {fmtRelative(signal.time)}</div>}
        </div>
      </div>

      {isDelayed && (
        <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          해외 소스 체결 시각이 15분 이상 지연되어 있습니다. 화면은 30초마다
          재조회하지만, 원천 데이터가 늦으면 가격도 늦게 바뀝니다.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <div className="text-[11px] text-muted-foreground mb-1">
            원화 환산가
          </div>
          <div className={`tabular text-2xl font-bold ${changeColor(premium)}`}>
            {fmtNumber(signal.impliedKrwPrice, 0)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            KRX 정규 종가 {fmtNumber(signal.krxClose, 0)} 대비
          </div>
        </div>
        <MiniMetric
          label="괴리율"
          value={fmtPercent(premium)}
          color={changeColor(premium)}
        />
        <MiniMetric
          label={`${signal.currency ?? ""} 원가격`}
          value={`${fmtNumber(signal.price, 2)} ${signal.currency ?? ""}`}
          sub={`${signal.sharesPerReceipt ?? 1}주 환산`}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <MiniMetric label="장 구분" value={state.label} />
        {isEur && (
          <MiniMetric label="EURUSD" value={fmtNumber(signal.eurUsd, 4)} />
        )}
        <MiniMetric label="USDKRW" value={fmtNumber(signal.usdKrw, 0)} />
        <MiniMetric
          label="GDR 등락"
          value={fmtPercent(signal.expectedRate)}
          color={changeColor(signal.expectedRate)}
        />
      </div>

      <div className="rounded-lg bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <div className="font-medium text-foreground mb-1">계산 방법</div>
        <div className="tabular">
          {fxText} = {fmtNumber(signal.impliedKrwPrice, 0)}
        </div>
      </div>
    </div>
  );
}

function nightMarketState(state?: string): {
  label: string;
  variant: "good" | "neutral" | "warn";
} {
  switch ((state ?? "").toUpperCase()) {
    case "REGULAR":
      return { label: "해외장 장중", variant: "good" };
    case "PRE":
    case "PREPRE":
      return { label: "해외장 장전", variant: "neutral" };
    case "POST":
    case "POSTPOST":
      return { label: "해외장 장후", variant: "neutral" };
    case "CLOSED":
      return { label: "해외장 마감", variant: "warn" };
    default:
      return { label: "해외장 상태 미확인", variant: "neutral" };
  }
}

function valuationRiskColor(score?: number | null): string {
  if (score == null) return "";
  if (score >= 70) return "text-down";
  if (score >= 45) return "text-warn";
  if (score <= 15) return "text-up";
  return "";
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
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className={`tabular text-base font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color = "",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2">
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className={`tabular text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

// 통계 σ 역추출 — 1일 horizonSigma = σ × √1 = σ.
// drift=0 이라 center=price, low=center·exp(-σ). log(center/low) = σ.
// 표시용 σ% 배지에만 사용.
function stdSigma(p: { ranges: { horizonDays: number; center: number; low: number }[] }): number {
  const oneDay = p.ranges.find((r) => r.horizonDays === 1);
  if (!oneDay || oneDay.center <= 0 || oneDay.low <= 0) return 0;
  return Math.log(oneDay.center / oneDay.low);
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

function PriceRow({
  label,
  value,
  refPrice,
  tone,
  currency,
  krwRate,
}: {
  label: string;
  value: number;
  refPrice?: number;
  tone?: "up" | "down";
  currency?: "KRW" | "USD";
  krwRate?: number | null;
}) {
  const delta =
    refPrice && refPrice > 0 ? value / refPrice - 1 : null;
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "";
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className={`tabular text-sm font-medium ${toneClass}`}>
          {fmtNumber(value)}
          {delta !== null && Math.abs(delta) >= 0.001 && (
            <span className="text-[11px] text-muted-foreground ml-1 tabular">
              ({fmtPercent(delta, 1)})
            </span>
          )}
        </span>
        {/* USD 종목 — 환율 적용 원화 보조. 환율 없으면 자동 생략. */}
        {currency === "USD" && (
          <span className="block text-[10px] leading-tight mt-0.5">
            <PriceWithKrw
              price={value}
              currency={currency}
              krwRate={krwRate ?? null}
              prefix=""
            />
          </span>
        )}
      </span>
    </div>
  );
}

// 가격 범위 막대: 현재가 마커가 위에 표시되고 low~high가 한 줄
function RangeBar({
  currentPrice,
  low,
  center,
  high,
}: {
  currentPrice: number;
  low: number;
  center: number;
  high: number;
}) {
  // 시각화 범위: low/high의 ±20%까지 여백
  const span = high - low;
  if (span <= 0) return null;
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

  return (
    <div className="relative h-2 w-full">
      {/* 전체 트랙 */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-muted rounded-full" />
      {/* low~high 범위 */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-accent/40 rounded-full"
        style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
      />
      {/* 중심 */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-2 w-0.5 bg-accent"
        style={{ left: `${centerPct}%` }}
      />
      {/* 현재가 마커 */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 h-3 w-1 rounded ${
          inRange ? "bg-foreground" : "bg-warn"
        }`}
        style={{ left: `calc(${currentPct}% - 2px)` }}
        title={`현재가 ${fmtNumber(currentPrice)}`}
      />
    </div>
  );
}

function StrengthBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>{label}</span>
        <span className="tabular font-medium text-foreground">{value}</span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
