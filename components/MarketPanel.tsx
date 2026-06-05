import type { MarketIndicator } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { changeColor, fmtNumber, fmtPercent, priceFreshness } from "@/lib/utils";
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
            // 신선도 — 야후 정규장 마감 후엔 종가 시각에 박혀 stale 라벨로 사용자에 명시.
            // 지수(^IXIC/^SOX/^VIX)는 시간외 거래 자체가 없어 정규장 마감 후 stale 불가피.
            const fresh = priceFreshness(i.priceTime);
            const stateUpper = (i.marketState ?? "").toUpperCase();
            const isClosed =
              stateUpper === "POSTPOST" ||
              stateUpper === "PREPRE" ||
              stateUpper === "CLOSED";
            return (
              <li key={i.code} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <StatusDot status={i.status} />
                  <div>
                    <div className="text-sm font-medium">{i.name}</div>
                    {i.hint && <div className="text-xs text-warn">{i.hint}</div>}
                    {fresh && (
                      <div
                        className={`text-[10px] tabular ${fresh.stale ? "text-warn" : "text-muted-foreground"}`}
                      >
                        {isClosed ? "정규장 종가 · " : ""}
                        {fresh.label}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tabular text-sm font-semibold">
                    {fmtNumber(i.value, i.code === "KRW=X" ? 2 : 2)}
                  </div>
                  <div className={`tabular text-xs inline-flex items-center gap-1 ${changeColor(i.changeRate)}`}>
                    {iconFor(i)} {fmtPercent(i.changeRate)}
                  </div>
                </div>
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
