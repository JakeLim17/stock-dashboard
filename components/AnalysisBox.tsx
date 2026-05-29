import type { SignalStatus, StockSnapshot } from "@/lib/types";
import { Card, CardBody } from "./ui/Card";
import { Badge } from "./ui/Badge";

const SIGNAL_LABEL: Record<SignalStatus, string> = {
  BUY: "신규 매수",
  ADD: "분할 매수",
  HOLD: "보유",
  WATCH: "관망",
  SELL: "비중 축소",
};

const SIGNAL_VARIANT: Record<
  SignalStatus,
  "buy" | "add" | "hold" | "watch" | "sell"
> = {
  BUY: "buy",
  ADD: "add",
  HOLD: "hold",
  WATCH: "watch",
  SELL: "sell",
};

// 종목 카드 그리드 위에 가로로 길게 띄우는 컴팩트 분석 바.
// 좌(종목+단·장기 시그널·헤드라인) · 중(점수 막대) · 우(단기 근거 리스트) 3분할.
// 모바일에서는 자연스럽게 세로 stack.
export function AnalysisBox({ snap }: { snap: StockSnapshot }) {
  const a = snap.analysis;
  const shortSig = a.shortTerm.signal;
  const longSig = a.longTerm.signal;

  return (
    <Card className="border-2 border-accent/30 shadow-md">
      <CardBody className="py-3 md:py-4">
        <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-5">
          {/* 좌: 종목명 + 단/장기 시그널 + 헤드라인 */}
          <div className="lg:flex-1 lg:min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                현재 판단
              </span>
              <span className="text-sm font-semibold">{snap.meta.name}</span>
              <Badge variant={SIGNAL_VARIANT[shortSig]} size="md">
                단기 · {SIGNAL_LABEL[shortSig]}
              </Badge>
            </div>
            <div className="text-base md:text-lg font-bold tracking-tight leading-snug">
              {a.shortTerm.headline}
            </div>
            {/* 장기 — 한 단계 작은 폰트, 회색 톤. 항상 보이도록 둠 */}
            <div className="flex items-start gap-2 flex-wrap text-xs text-muted-foreground">
              <Badge variant={SIGNAL_VARIANT[longSig]} size="sm">
                장기 · {SIGNAL_LABEL[longSig]}
              </Badge>
              <span className="leading-snug flex-1 min-w-0 pt-0.5">
                {a.longTerm.headline}
              </span>
            </div>
          </div>

          {/* 중: 점수 막대 — 단기 과열/매수우위 + 장기 종합 점수 */}
          <div className="grid grid-cols-2 gap-3 lg:w-56 lg:shrink-0">
            <ScoreBar label="과열도" value={a.heatScore} dangerHigh />
            <ScoreBar label="매수우위" value={a.buyScore} />
            <ScoreBar
              label="장기 종합"
              value={a.longTerm.score}
              className="col-span-2"
            />
          </div>

          {/* 우: 단기 근거 (최대 3개) */}
          <ul className="text-xs text-muted-foreground space-y-0.5 lg:w-72 lg:shrink-0 lg:border-l lg:border-border lg:pl-4">
            {a.shortTerm.reasons.slice(0, 3).map((r) => (
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
  className,
}: {
  label: string;
  value: number;
  dangerHigh?: boolean;
  className?: string;
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
    <div className={className}>
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
