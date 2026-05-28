import type { StockSnapshot } from "@/lib/types";
import { Card, CardBody } from "./ui/Card";
import { Badge } from "./ui/Badge";

// 종목 카드 그리드 위에 가로로 길게 띄우는 컴팩트 분석 바.
// 좌(종목+헤드라인) · 중(점수 막대) · 우(근거 리스트) 3분할.
// 모바일에서는 자연스럽게 세로 stack.
export function AnalysisBox({ snap }: { snap: StockSnapshot }) {
  const a = snap.analysis;
  const sigVariant =
    a.signal === "BUY"
      ? "buy"
      : a.signal === "ADD"
      ? "add"
      : a.signal === "WATCH"
      ? "watch"
      : a.signal === "SELL"
      ? "sell"
      : "hold";

  return (
    <Card className="border-2 border-accent/30 shadow-md">
      <CardBody className="py-3 md:py-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5">
          {/* 좌: 종목명 + 시그널 + 헤드라인 */}
          <div className="lg:flex-1 lg:min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                현재 판단
              </span>
              <span className="text-sm font-semibold">{snap.meta.name}</span>
              <Badge variant={sigVariant} size="md">
                {a.signal}
              </Badge>
            </div>
            {/* 헤드라인 — 잘리지 않게 wrap 허용. lg에서도 1~2줄까지는 자연스럽게 보이게 */}
            <div className="text-base md:text-lg font-bold tracking-tight mt-1 leading-snug">
              {a.headline}
            </div>
          </div>

          {/* 중: 점수 막대 */}
          <div className="grid grid-cols-2 gap-3 lg:w-56 lg:shrink-0">
            <ScoreBar label="과열도" value={a.heatScore} dangerHigh />
            <ScoreBar label="매수우위" value={a.buyScore} />
          </div>

          {/* 우: 근거 (최대 3개) — 폭을 조금 더 주고 두 줄까지는 자연스럽게 wrap */}
          <ul className="text-xs text-muted-foreground space-y-0.5 lg:w-72 lg:shrink-0 lg:border-l lg:border-border lg:pl-4">
            {a.reasons.slice(0, 3).map((r) => (
              <li key={r} className="leading-snug">
                · {r}
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

function ScoreBar({
  label,
  value,
  dangerHigh,
}: {
  label: string;
  value: number;
  dangerHigh?: boolean;
}) {
  const color = dangerHigh
    ? value >= 65
      ? "bg-up"
      : value <= 35
      ? "bg-down"
      : "bg-warn"
    : value >= 65
    ? "bg-up"
    : value <= 35
    ? "bg-down"
    : "bg-muted-foreground";
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
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
