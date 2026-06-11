import type { SignalStatus } from "@/lib/types";
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
}: {
  short: SignalStatus;
  long: SignalStatus;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
      title={title}
    >
      <Badge
        variant={SIGNAL_VARIANT[short]}
        size="sm"
        className={short === "SELL" ? "shake-warn" : undefined}
      >
        단기 {short}
      </Badge>
      <Badge
        variant={SIGNAL_VARIANT[long]}
        size="sm"
        className={long === "SELL" ? "shake-warn" : undefined}
      >
        장기 {long}
      </Badge>
    </span>
  );
}
