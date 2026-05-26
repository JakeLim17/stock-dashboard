import type { StockSnapshot } from "@/lib/types";
import { Card, CardBody } from "./ui/Card";
import { Badge } from "./ui/Badge";

// 가장 눈에 띄는 분석 박스. 선택된 종목의 분석을 크게 보여줌.
export function AnalysisBox({ snap }: { snap: StockSnapshot }) {
  const a = snap.analysis;
  const sigVariant =
    a.signal === "BUY" ? "buy" :
    a.signal === "ADD" ? "add" :
    a.signal === "WATCH" ? "watch" :
    a.signal === "SELL" ? "sell" : "hold";

  return (
    <Card className="border-2 border-accent/30 shadow-md">
      <CardBody className="py-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            현재 판단 — <span className="text-foreground font-medium">{snap.meta.name}</span>
          </div>
          <Badge variant={sigVariant} size="md">{a.signal}</Badge>
        </div>
        <div className="text-2xl md:text-3xl font-bold tracking-tight">
          {a.headline}
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <ScoreBar label="과열도" value={a.heatScore} dangerHigh />
          <ScoreBar label="매수우위" value={a.buyScore} />
        </div>
        <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
          {a.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function ScoreBar({ label, value, dangerHigh }: { label: string; value: number; dangerHigh?: boolean }) {
  const color =
    dangerHigh
      ? value >= 65 ? "bg-up" : value <= 35 ? "bg-down" : "bg-warn"
      : value >= 65 ? "bg-up" : value <= 35 ? "bg-down" : "bg-muted-foreground";
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
        <span>{label}</span>
        <span className="tabular font-medium text-foreground">{value}</span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
