import type { StockSnapshot } from "@/lib/types";
import { Card, CardBody } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { SignalDetailBadges } from "./SignalDetailBadges";
import { RiskBadge } from "./RiskBadge";

// 종목 카드 그리드 위에 가로로 길게 띄우는 컴팩트 분석 바.
// 좌(종목명 + verdict 메인 배지·헤드라인) · 중(점수 막대) · 우(근거 + 장기 헤드라인) 3분할.
// 모바일에서는 자연스럽게 세로 stack.
export function AnalysisBox({ snap }: { snap: StockSnapshot }) {
  const a = snap.analysis;
  const verdict = a.verdict;

  return (
    <Card className="border-2 border-accent/30 shadow-md">
      <CardBody className="py-3 md:py-4">
        <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-5">
          {/* 좌: 종목명 + verdict 메인 배지 + 통합 헤드라인 */}
          <div className="lg:flex-1 lg:min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                현재 판단
              </span>
              <span className="text-sm font-semibold">{snap.meta.name}</span>
              {/* verdict 메인 배지 — 시각적으로 가장 강한 요소 */}
              <Badge variant={verdict.tone} size="lg">
                {verdict.label}
              </Badge>
            </div>
            <div className="text-base md:text-lg font-bold tracking-tight leading-snug">
              {verdict.headline}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <SignalDetailBadges
                short={a.shortTerm.signal}
                long={a.longTerm.signal}
                title={verdict.detail}
              />
              <RiskBadge assessment={a.externalRisk} size="md" />
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

          {/* 우: 단기 근거 (최대 3개) + 장기 헤드라인 한 줄 */}
          <div className="lg:w-72 lg:shrink-0 lg:border-l lg:border-border lg:pl-4 space-y-2">
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {a.shortTerm.reasons.slice(0, 3).map((r) => (
                <li key={r} className="leading-snug">
                  · {r}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground leading-snug pt-1.5 border-t border-border/60">
              <span className="text-foreground/80 font-medium">장기</span>{" "}
              {a.longTerm.headline}
            </p>
          </div>
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
