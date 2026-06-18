import type { SignalStatus } from "@/lib/types";
import {
  signalContextHint,
  signalHorizonLabel,
  SIGNAL_LABEL,
} from "@/lib/signal-labels";
import { Badge } from "./ui/Badge";

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

// verdict 부연(단기/장기 시그널) — 회색 텍스트 대신 컬러 배지 두 개로 노출.
// 시각적으로 verdict 메인 배지보다는 작게 (sm), 회색 detail 문장보다는 명확히 강조.
// `title`은 기존 detail 문자열을 툴팁으로 살려 백워드 호환·접근성 보조.
export function SignalDetailBadges({
  short,
  long,
  title,
  className,
  showHint = true,
}: {
  short: SignalStatus;
  long: SignalStatus;
  title?: string;
  className?: string;
  /** 단기 BUY vs ADD 구분 힌트 — 기본 켜짐 */
  showHint?: boolean;
}) {
  const hint = showHint ? signalContextHint(short, long) : null;
  const tooltip = [title, hint].filter(Boolean).join(" · ");

  return (
    <span className={`inline-flex flex-col gap-1 ${className ?? ""}`}>
      <span
        className="inline-flex items-center gap-1.5 flex-wrap"
        title={tooltip || undefined}
      >
        <Badge
          variant={SIGNAL_VARIANT[short]}
          size="sm"
          className={short === "SELL" ? "shake-warn" : undefined}
          title={`${signalHorizonLabel("short", short)} — 내부코드 ${short}`}
        >
          {signalHorizonLabel("short", short)}
        </Badge>
        <Badge
          variant={SIGNAL_VARIANT[long]}
          size="sm"
          className={long === "SELL" ? "shake-warn" : undefined}
          title={`${signalHorizonLabel("long", long)} — 내부코드 ${long}`}
        >
          {signalHorizonLabel("long", long)}
        </Badge>
      </span>
      {hint && (
        <span className="text-[10px] text-muted-foreground leading-snug max-w-[280px]">
          {hint}
        </span>
      )}
    </span>
  );
}

/** 상세 접힘 영역 등 — 시그널 배지만 (힌트 없음). */
export { SIGNAL_LABEL };
