"use client";

import type { StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { SignalDetailBadges } from "./SignalDetailBadges";
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

export function StockCard({ snap, onSelect, selected }: {
  snap: StockSnapshot;
  onSelect?: (code: string) => void;
  selected?: boolean;
}) {
  const { meta, quote, tech, flow, analysis, consensus } = snap;
  const trendIcon =
    quote.changeRate > 0 ? <TrendingUp className="h-4 w-4" /> :
    quote.changeRate < 0 ? <TrendingDown className="h-4 w-4" /> :
    <Minus className="h-4 w-4" />;

  const market = marketDisplayLabel(quote);
  const isRegular = (quote.marketState ?? "").toUpperCase() === "REGULAR";
  // 정규장 중에는 시간외 박스를 숨김 (데이터가 잘못 와도 사용자 혼란 방지)
  const ext = !isRegular ? quote.extendedHours ?? null : null;
  const priceTimePrefix =
    ext?.active === true
      ? `${extendedSessionLabel(ext.session)} · `
      : ext
        ? "정규장 종가 · "
        : "기준 ";

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
        {/* 메인 결론 — 단·장기 통합 verdict. 카드 한눈 스캔용. */}
        <Badge variant={analysis.verdict.tone} size="md">
          {analysis.verdict.label}
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
                {priceTimePrefix}
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
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-3">
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
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
              {ext.volume != null && (
                <div className="text-[11px] text-muted-foreground tabular">
                  시간외 거래량 {fmtNumber(ext.volume)}
                </div>
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

        {/* 분석 — 메인 결론(verdict)을 위로 크게, 단기/장기 상세는 접힘으로 정리.
            "사라는 건지 말라는 건지" 피드백에 맞춰 1초 안에 행동을 정하도록 통합. */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs text-muted-foreground tracking-wide uppercase">
            분석
          </div>

          {/* 메인 verdict 배지 + 단·장기 시그널 컬러 배지 (회색 detail 대체) */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={analysis.verdict.tone} size="lg">
              {analysis.verdict.label}
            </Badge>
            <SignalDetailBadges
              short={analysis.shortTerm.signal}
              long={analysis.longTerm.signal}
              title={analysis.verdict.detail}
            />
          </div>
          <p className="text-sm font-semibold leading-snug">
            {analysis.verdict.headline}
          </p>

          {/* 추세 배지(공통) */}
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

        {/* 1주 변동성 범위 요약 — 카드 맨 아래 별도 박스로 분리 */}
        {(() => {
          const oneWeek = snap.predictions?.ranges.find(
            (r) => r.horizonDays === 5
          );
          if (!oneWeek || quote.price <= 0) return null;
          const lowPct = oneWeek.low / quote.price - 1;
          const highPct = oneWeek.high / quote.price - 1;
          return (
            <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between text-[11px] tabular">
              <span className="text-muted-foreground">1주 변동 범위</span>
              <span className="font-medium">
                <span className="text-down">{fmtPercent(lowPct, 1)}</span>
                {" ~ "}
                <span className="text-up">{fmtPercent(highPct, 1)}</span>
                <span className="text-muted-foreground ml-1.5 text-[10px]">
                  68%
                </span>
              </span>
            </div>
          );
        })()}

        {/* 컨센서스 한 줄 — 평균 목표가, 상승여력, Strong Buy / Buy / Hold 분포 */}
        {consensus && consensus.targetMean != null && (
          <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] tabular flex items-center justify-between gap-2">
            <span className="text-muted-foreground shrink-0">컨센서스</span>
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
        )}
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
