"use client";

import type { StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { changeColor, fmtNumber, fmtPercent } from "@/lib/utils";
import { Crosshair, LineChart, TrendingDown, TrendingUp } from "lucide-react";

// 통계 기반 예측 패널 (선택된 종목 1개에 대해)
//  A: 가격 범위 (1σ)  B: 진입/손절/목표(ATR)  C: 시장 베타  E: 신호 강도
export function PredictionPanel({ snap }: { snap: StockSnapshot }) {
  const p = snap.predictions;
  const price = snap.quote.price;

  if (!p) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>예측</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-muted-foreground">
            데이터가 충분하지 않아 예측을 표시할 수 없습니다.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-2">
        <div>
          <CardTitle>예측 — {snap.meta.name}</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            최근 90일 변동성 기반 · 추세 가정 없음 · 투자조언 아님
          </p>
        </div>
        <Badge variant="neutral" size="sm">
          σ {(stdSigma(p) * 100).toFixed(2)}%/일
        </Badge>
      </CardHeader>
      <CardBody className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-5">
        {/* A. 가격 범위 — 변동성 신뢰구간 (drift=0) */}
        {p.ranges.length > 0 && (
          <Section
            title="변동성 범위 (68% 신뢰)"
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

        {/* B. 진입/손절/목표 */}
        {p.targets && (
          <Section
            title="진입 · 손절 · 목표 (ATR 기반)"
            icon={<Crosshair className="h-3.5 w-3.5" />}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <PriceRow label="진입 기준" value={p.targets.entry} />
              <PriceRow
                label="손절"
                value={p.targets.stopLoss}
                refPrice={price}
                tone="down"
              />
              <PriceRow
                label="목표 1"
                value={p.targets.takeProfit1}
                refPrice={price}
                tone="up"
              />
              <PriceRow
                label="목표 2"
                value={p.targets.takeProfit2}
                refPrice={price}
                tone="up"
              />
              <PriceRow label="지지선 (20일)" value={p.targets.support} />
              <PriceRow label="저항선 (20일)" value={p.targets.resistance} />
            </div>
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/60 text-xs">
              <span className="text-muted-foreground">손익비</span>
              <span className="tabular font-medium">
                1 : {p.targets.riskReward.toFixed(2)}
                {p.targets.riskReward >= 2 && (
                  <span className="text-up ml-1.5">우수</span>
                )}
                {p.targets.riskReward < 1 && p.targets.riskReward > 0 && (
                  <span className="text-down ml-1.5">불리</span>
                )}
              </span>
            </div>
          </Section>
        )}

        {/* C. 시장 시나리오 */}
        {p.scenarios.length > 0 && (
          <Section
            title="시장 시나리오 (60일 회귀)"
            icon={
              <TrendingUp className="h-3.5 w-3.5" />
            }
          >
            <ul className="space-y-1.5 text-sm">
              {p.scenarios.map((s, i) => (
                <li
                  key={`${s.label}-${i}`}
                  className="flex items-center justify-between"
                >
                  <span className="text-muted-foreground">{s.label}</span>
                  <span
                    className={`tabular font-medium ${changeColor(s.expected)}`}
                  >
                    {fmtPercent(s.expected)}
                    <span className="text-[11px] text-muted-foreground ml-1.5 tabular">
                      β {s.beta.toFixed(2)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* E. 신호 강도 */}
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
      </CardBody>
    </Card>
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
}: {
  label: string;
  value: number;
  refPrice?: number;
  tone?: "up" | "down";
}) {
  const delta =
    refPrice && refPrice > 0 ? value / refPrice - 1 : null;
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "";
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`tabular text-sm font-medium ${toneClass}`}>
        {fmtNumber(value)}
        {delta !== null && Math.abs(delta) >= 0.001 && (
          <span className="text-[11px] text-muted-foreground ml-1 tabular">
            ({fmtPercent(delta, 1)})
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
