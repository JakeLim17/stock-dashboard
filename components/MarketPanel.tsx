import type { MarketIndicator } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { PriceTicker } from "./PriceTicker";
import { Sparkline } from "./Sparkline";
import { changeColor, fmtPercent, priceFreshness } from "@/lib/utils";
import { TrendingDown, TrendingUp, AlertTriangle, Minus } from "lucide-react";

export function MarketPanel({ indicators }: { indicators: MarketIndicator[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>시장 신호</CardTitle>
      </CardHeader>
      <CardBody>
        <ul className="divide-y divide-border">
          {indicators.map((i) => {
            const fresh = priceFreshness(i.priceTime);
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
  // 환율·지수·메가캡 다 2자리면 충분. 별도 분기가 늘면 SymbolMeta로 옮긴다.
  if (code === "KRW=X") return 2;
  return 2;
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
