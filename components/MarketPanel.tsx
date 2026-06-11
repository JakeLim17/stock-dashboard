"use client";

import { useMemo, useState } from "react";
import type { MarketIndicator } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { PriceTicker } from "./PriceTicker";
import { Sparkline } from "./Sparkline";
import { changeColor, fmtPercent, priceFreshness } from "@/lib/utils";
import { TrendingDown, TrendingUp, AlertTriangle, Minus } from "lucide-react";

// 사용자 핵심 지표 (default 노출). 나머지는 더보기 토글로 펼침.
// 한국 주식 트레이더 관점 4종: 코스피·코스닥·나스닥 선물(아시아 시간대 movement)·환율.
const DEFAULT_VISIBLE_CODES: ReadonlySet<string> = new Set([
  "^KS11",
  "^KQ11",
  "NQ=F",
  "KRW=X",
]);

export function MarketPanel({ indicators }: { indicators: MarketIndicator[] }) {
  const [expanded, setExpanded] = useState(false);

  const { defaultList, restList } = useMemo(() => {
    const pri: MarketIndicator[] = [];
    const rest: MarketIndicator[] = [];
    for (const i of indicators) {
      if (DEFAULT_VISIBLE_CODES.has(i.code)) pri.push(i);
      else rest.push(i);
    }
    // default 정렬 — DEFAULT_VISIBLE_CODES 등장 순서대로
    const order = Array.from(DEFAULT_VISIBLE_CODES);
    pri.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
    return { defaultList: pri, restList: rest };
  }, [indicators]);

  const visible = expanded ? [...defaultList, ...restList] : defaultList;
  const hiddenCount = restList.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>시장 신호</CardTitle>
      </CardHeader>
      <CardBody>
        <ul className="divide-y divide-border">
          {visible.map((i) => {
            // 장 마감(PREPRE/POSTPOST/CLOSED) 이면 5분 stale 임계는 의미 없으므로
            // priceFreshness 에 marketState 도 전달 → 정규장 종가 기준에선 회색 톤 유지.
            const fresh = priceFreshness(i.priceTime, i.marketState);
            const stateUpper = (i.marketState ?? "").toUpperCase();
            const isClosed =
              stateUpper === "POSTPOST" ||
              stateUpper === "PREPRE" ||
              stateUpper === "CLOSED";
            const stateLabel = marketStateShort(stateUpper);
            const decimals = decimalsFor(i.code);
            const hasRange =
              i.dayHigh != null &&
              i.dayLow != null &&
              i.dayHigh > 0 &&
              i.dayLow > 0;
            return (
              <li key={i.code} className="py-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={i.status} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{i.name}</div>
                      {i.hint && (
                        <div className="text-[11px] text-warn truncate">{i.hint}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* 미니 추세 차트 — 최근 30영업일 close. 일중 등락률 부호로 색상 결정.
                        좁은 컬럼이라 width 56·height 18로 최소화. 데이터 부족 시 자동 미렌더. */}
                    <Sparkline
                      data={i.closeHistory}
                      width={56}
                      height={18}
                      up={i.changeRate >= 0}
                      className="flex-shrink-0 opacity-80"
                    />
                    <div className="text-right">
                      <div className="text-sm font-semibold">
                        <PriceTicker value={i.value} decimals={decimals} />
                        {unitSuffixFor(i.code) && (
                          <span className="text-muted-foreground ml-0.5 text-[11px] font-normal">
                            {unitSuffixFor(i.code)}
                          </span>
                        )}
                      </div>
                      <div
                        className={`tabular text-xs inline-flex items-center gap-1 ${changeColor(i.changeRate)}`}
                      >
                        {iconFor(i)} {fmtPercent(i.changeRate)}
                        {i.changeAbs != null && (
                          <span className="text-muted-foreground font-normal">
                            ({fmtSignedDelta(i.changeAbs, decimals)})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 메타: 신선도 · 시장상태 · 일중 범위 · 전일 종가 */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] tabular text-muted-foreground pl-4">
                  {fresh && (
                    <span className={fresh.stale ? "text-warn" : ""}>
                      {isClosed ? "정규장 종가 · " : ""}
                      {fresh.label}
                    </span>
                  )}
                  {stateLabel && <span>· {stateLabel}</span>}
                  {hasRange && (
                    <span>
                      범위 {fmtNum(i.dayLow!, decimals)} ~ {fmtNum(i.dayHigh!, decimals)}
                    </span>
                  )}
                  {i.prevClose != null && i.prevClose > 0 && (
                    <span>전일 {fmtNum(i.prevClose, decimals)}</span>
                  )}
                </div>

                {/* 환율 변동성 — 일별 σ% (1M EWMA + 1W 표본) */}
                {i.volatility && (
                  <div className="text-[10px] tabular text-muted-foreground pl-4">
                    <span className="text-warn">{i.volatility.label}</span>
                    {i.volatility.secondaryWindow &&
                      i.volatility.secondarySigmaPct != null && (
                        <span className="ml-1">
                          · σ({i.volatility.secondaryWindow.toUpperCase()}){" "}
                          {i.volatility.secondarySigmaPct.toFixed(2)}%
                        </span>
                      )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {hiddenCount > 0 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs text-accent hover:underline mt-3 inline-flex items-center gap-1"
          >
            {hiddenCount}개 지표 더 보기
          </button>
        )}
        {expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs text-muted-foreground hover:underline mt-3"
          >
            접기
          </button>
        )}
      </CardBody>
    </Card>
  );
}

function StatusDot({ status }: { status: MarketIndicator["status"] }) {
  const cls =
    status === "up" ? "bg-up" : status === "down" ? "bg-down" : status === "warn" ? "bg-warn" : "bg-muted-foreground";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

function iconFor(i: MarketIndicator) {
  if (i.status === "warn") return <AlertTriangle className="h-3 w-3" />;
  if (i.changeRate > 0) return <TrendingUp className="h-3 w-3" />;
  if (i.changeRate < 0) return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

function decimalsFor(code: string): number {
  // ^TNX 는 % yield 라 소수 2자리 (예: 4.32). VIX/DXY/지수도 2자리 충분.
  if (code === "KRW=X") return 2;
  return 2;
}

// Yahoo는 ^TNX 의 value 를 percent 그대로 (4.32 = 4.32%) 반환.
// MarketPanel 에서는 가격 뒤에 "%" 접미어를 붙여 단위를 명확히 한다.
function unitSuffixFor(code: string): string {
  if (code === "^TNX") return "%";
  return "";
}

function fmtNum(v: number, digits: number): string {
  return v.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtSignedDelta(v: number, digits: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function marketStateShort(state: string): string {
  switch (state) {
    case "REGULAR":
      return "장중";
    case "PRE":
      return "프리마켓";
    case "PREPRE":
      return "장 마감";
    case "POST":
      return "애프터마켓";
    case "POSTPOST":
      return "장 마감";
    case "CLOSED":
      return "장 마감";
    default:
      return "";
  }
}
