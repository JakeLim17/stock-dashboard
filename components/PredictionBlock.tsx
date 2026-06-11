"use client";

import type { StockSnapshot } from "@/lib/types";
import { PriceWithKrw } from "./PriceWithKrw";
import {
  currencyOf,
  fmtNumber,
  fmtPercent,
} from "@/lib/utils";

// 종목 카드 전용 "예측 블록" — 기존 PredictionHero(상단 별도 패널)의 핵심을 카드 안으로 흡수.
// HERO 와 비교한 차이점:
//   - 카드 폭(~280-360px)에 맞춰 폰트/스페이싱 축소.
//   - 좌·중·우 3-col 그리드 대신 stack 레이아웃.
//   - 종목명/현재가는 카드 상단 가격 블록이 이미 담당 → 여기선 예측 정보만.
//
// 보여주는 항목 (위→아래):
//   1) 헤더 (라벨 + 변동성 모델 텍스트 + 이벤트 부풀림 배지)
//   2) 1일/1주 예측 범위 가로 막대 (PredictionRangeRow)
//   3) 오늘 진폭 ± % · 변동성 점수
//   4) 매수/매도 강도 게이지
//   5) 손익비 + 손절/목표1
//
// 데이터가 없으면 컴포넌트 자체를 렌더하지 않는다 (null 반환).

export function PredictionBlock({
  snap,
  krwRate,
}: {
  snap: StockSnapshot;
  krwRate?: number | null;
}) {
  const p = snap.predictions;
  const a = snap.analysis;
  const currency = currencyOf(snap.meta.code, snap.meta.currency);
  const decimals = currency === "USD" ? 2 : 0;

  const oneDay = p?.ranges.find((r) => r.horizonDays === 1) ?? null;
  const oneWeek = p?.ranges.find((r) => r.horizonDays === 5) ?? null;
  const buyStrength = p?.strength.buy ?? a.buyScore;
  const sellStrength = p?.strength.sell ?? a.heatScore;
  const rr = p?.targets?.riskReward ?? null;
  const intradayRange = p?.intradayRange ?? null;
  const volatility = a.volatility ?? null;
  const volModel = p?.volatilityModel ?? null;
  const eventVol = p?.eventVolatility ?? null;
  const macroBetas = p?.macroBetas ?? null;
  const modelConfidence = p?.modelConfidence ?? null;

  // 데이터가 거의 없으면 렌더 스킵 — 카드가 비대해지지 않게.
  const hasAny =
    !!oneDay ||
    !!oneWeek ||
    (intradayRange?.expectedRangePct ?? 0) > 0 ||
    !!p?.targets ||
    typeof buyStrength === "number";
  if (!hasAny) return null;

  // 모델 라벨 — EWMA + (있으면) 매크로 베타 + VIX 게이팅 한 줄. 카드 폭 좁아 약어로.
  const modelLabel = (() => {
    const parts: string[] = [];
    if (volModel?.kind === "ewma-t") {
      parts.push(`EWMA·t(df=${volModel.df ?? 5})`);
    } else {
      parts.push("최근 90일");
    }
    if (macroBetas && (macroBetas.kospi || macroBetas.ixic || macroBetas.sox)) {
      parts.push("β");
    }
    return parts.join(" · ");
  })();

  // modelConfidence 배지 색상 — high=up tint, medium=warn tint, low=muted.
  const confTone =
    modelConfidence?.label === "high"
      ? "border-up/40 bg-up/10 text-up"
      : modelConfidence?.label === "medium"
        ? "border-warn/40 bg-warn/10 text-warn"
        : "border-border bg-muted/40 text-muted-foreground";

  return (
    <div className="border-t border-border pt-3 space-y-2.5">
      {/* 헤더 — "시스템 예측 · 단기" 명확화 (컨센서스 탭의 "장기 목표주가"와 시계 구분).
          상세 분석 패널 컨센서스 탭에는 "증권사 컨센서스 · 장기 목표가" 라벨이 따로 있다.
          사용자가 카드의 손절/목표1과 컨센서스 목표가가 다른 시계임을 한눈에 인지하도록. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col">
          <div className="text-xs text-muted-foreground tracking-wide uppercase">
            시스템 예측 · 단기
          </div>
          <div className="text-[10px] text-muted-foreground/70 leading-snug">
            (1일 / 1주 — 컨센서스 탭의 장기 목표가와 다름)
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {eventVol && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 text-warn px-1.5 py-0.5 text-[10px] font-medium"
              title={`${eventVol.eventLabel} (D${
                eventVol.daysToEvent >= 0 ? "-" : "+"
              }${Math.abs(eventVol.daysToEvent)}) — σ × ${eventVol.factor.toFixed(2)} 적용`}
            >
              📅 {eventVol.shortLabel} D
              {eventVol.daysToEvent >= 0
                ? `-${eventVol.daysToEvent}`
                : `+${Math.abs(eventVol.daysToEvent)}`}{" "}
              · 범위 +{Math.round((eventVol.factor - 1) * 100)}%
            </span>
          )}
          {modelConfidence && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${confTone}`}
              title={modelConfidence.factors.join("\n")}
            >
              신뢰도 {modelConfidence.label === "high" ? "높음" : modelConfidence.label === "medium" ? "중간" : "낮음"}{" "}
              <span className="opacity-70 tabular">
                {Math.round(modelConfidence.score * 100)}%
              </span>
            </span>
          )}
          {p && (
            <span className="text-[10px] text-muted-foreground tabular">
              {modelLabel}
            </span>
          )}
        </div>
      </div>

      {/* 1일/1주 예측 범위 */}
      {(oneDay || oneWeek) && (
        <div className="space-y-2">
          {oneDay && (
            <PredictionRangeRow
              horizonLabel="1일 후"
              currentPrice={snap.quote.price}
              low={oneDay.low}
              high={oneDay.high}
              center={oneDay.center}
              decimals={decimals}
            />
          )}
          {oneWeek && (
            <PredictionRangeRow
              horizonLabel="1주 후"
              currentPrice={snap.quote.price}
              low={oneWeek.low}
              high={oneWeek.high}
              center={oneWeek.center}
              decimals={decimals}
            />
          )}
        </div>
      )}

      {/* 오늘 진폭 + 변동성 점수 한 줄 */}
      {(intradayRange || (volatility && volatility.level !== "stable")) && (
        <div className="flex items-center gap-3 flex-wrap text-[11px] tabular">
          {intradayRange && intradayRange.expectedRangePct > 0 && (
            <span className="text-muted-foreground">
              오늘 진폭{" "}
              <span className="font-semibold text-foreground">
                ±{(intradayRange.expectedRangePct * 100).toFixed(1)}%
              </span>
              {intradayRange.source === "intraday-blend" && (
                <span className="ml-1 text-[9px] opacity-70">·분봉</span>
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
              변동성{" "}
              <span className="tabular font-semibold">{volatility.score}</span>
              {volatility.level === "gambling" && " · 도박 ⚠"}
              {volatility.level === "high" && " · 고변동"}
            </span>
          )}
        </div>
      )}

      {/* 매수/매도 강도 게이지 — 카드 내에선 한 줄에 두 개 stack */}
      <div className="grid grid-cols-2 gap-2">
        <StrengthGauge label="매수 강도" value={buyStrength} kind="up" />
        <StrengthGauge label="매도 강도" value={sellStrength} kind="down" />
      </div>

      {/* 손익비 + 손절/목표1 한 줄 */}
      {(p?.targets || rr != null) && (
        <div className="grid grid-cols-3 gap-1.5 text-[11px]">
          <div className="rounded-md bg-muted/40 px-2 py-1.5">
            <div className="text-muted-foreground text-[10px]">손익비</div>
            <div className="tabular font-semibold">
              {rr != null ? (
                <>
                  1:{rr.toFixed(2)}
                  {rr >= 2 && (
                    <span className="ml-1 text-up text-[10px]">우수</span>
                  )}
                  {rr < 1 && rr > 0 && (
                    <span className="ml-1 text-down text-[10px]">불리</span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </div>
          {p?.targets && (
            <>
              <div className="rounded-md bg-muted/40 px-2 py-1.5">
                <div className="text-muted-foreground text-[10px]">손절</div>
                <div className="tabular font-semibold text-down">
                  {fmtNumber(p.targets.stopLoss, decimals)}
                </div>
                {currency === "USD" && (
                  <div className="mt-0.5">
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
                <div className="text-muted-foreground text-[10px]">목표1</div>
                <div className="tabular font-semibold text-up">
                  {fmtNumber(p.targets.takeProfit1, decimals)}
                </div>
                {currency === "USD" && (
                  <div className="mt-0.5">
                    <PriceWithKrw
                      price={p.targets.takeProfit1}
                      currency={currency}
                      krwRate={krwRate ?? null}
                      prefix=""
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* 단정 표현(목표가/손절) 보강 — 자본시장법 §49 / SEC IA Act §202 단정성 리스크.
          숫자는 그대로 두되 "통계적 참고선" 임을 footer 보다 더 가까이 알린다. */}
      {p?.targets && (
        <div className="text-[10px] text-muted-foreground/80 leading-snug">
          ※ 통계적 참고선 — 투자권유 아님
        </div>
      )}
    </div>
  );
}

// 예측 범위 한 줄 — 막대 + 현재가 마커 + 양 끝 ± 변동률.
// HERO 의 PredictionRangeRow 와 동일한 시각언어이지만 카드 폭에 맞춘 컴팩트 버전.
function PredictionRangeRow({
  horizonLabel,
  currentPrice,
  low,
  high,
  center,
  decimals,
}: {
  horizonLabel: string;
  currentPrice: number;
  low: number;
  high: number;
  center: number;
  decimals: number;
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
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-muted-foreground uppercase tracking-wider">
          {horizonLabel}
        </span>
        <span className="tabular text-muted-foreground">
          ± {fmtPercent((high - low) / (2 * currentPrice), 1).replace("+", "")}
        </span>
      </div>
      <div className="relative h-2.5 w-full">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-muted rounded-full" />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-accent/40 rounded-full"
          style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2.5 w-0.5 bg-accent"
          style={{ left: `${centerPct}%` }}
          title={`중심 ${fmtNumber(center, decimals)}`}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 h-3 w-1 rounded ${
            inRange ? "bg-foreground" : "bg-warn"
          }`}
          style={{ left: `calc(${currentPct}% - 2px)` }}
          title={`현재가 ${fmtNumber(currentPrice, decimals)}`}
        />
      </div>
      <div className="flex items-center justify-between mt-0.5 text-[10px] tabular">
        <span className="text-down">
          {fmtNumber(low, decimals)}
          <span className="text-muted-foreground ml-0.5">
            ({fmtPercent(lowDelta, 1)})
          </span>
        </span>
        <span className="text-up">
          {fmtNumber(high, decimals)}
          <span className="text-muted-foreground ml-0.5">
            ({fmtPercent(highDelta, 1)})
          </span>
        </span>
      </div>
    </div>
  );
}

// 매수/매도 강도 — 카드 안에선 한 줄에 두 개 stack 하므로 미니 폭.
// kind 으로 색상 분기 (up=빨강, down=파랑) — 한국식 컬러 토큰.
function StrengthGauge({
  label,
  value,
  kind,
}: {
  label: string;
  value: number;
  kind: "up" | "down";
}) {
  const safe = Math.max(0, Math.min(100, value));
  const fillClass = kind === "up" ? "bg-up" : "bg-down";
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular font-semibold">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${fillClass} transition-all`}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}
