"use client";

import type { SignalMark } from "@/lib/types";

// 종목 카드 헤더에 들어가는 시그널 마크 배지 row.
// 신고가/거래량폭발/외인픽 같은 한눈에 보이는 신호를 이모지+짧은 라벨 형태로 노출한다.
//
// size:
//   "sm" : StockCard 헤더 옆 (한 줄, 약간 여유)
//   "xs" : RecommendationsPanel·작은 카드 안 (촘촘)
//
// 데이터 부족 시 평가 단계에서 자동 스킵되므로 빈 배열이면 컴포넌트는 null 반환.
export function SignalMarkBadges({
  marks,
  size = "sm",
  className,
}: {
  marks?: SignalMark[] | null;
  size?: "xs" | "sm";
  className?: string;
}) {
  if (!marks || marks.length === 0) return null;

  return (
    <div className={`flex items-center gap-1 flex-wrap ${className ?? ""}`}>
      {marks.map((m) => (
        <SignalMarkBadge key={m.key} mark={m} size={size} />
      ))}
    </div>
  );
}

// 톤별 색상 — 다른 배지(시장상태/대장주/시장경보)와 구분되도록 살짝 다른 채도.
//   good    : up(빨강 — 한국식 상승)
//   bad     : down(파랑/초록 — 한국식 하락)
//   warn    : warn(amber)
//   neutral : muted
const TONE_CLASSES: Record<SignalMark["tone"], string> = {
  good: "bg-up/12 text-up border-up/30",
  bad: "bg-down/12 text-down border-down/30",
  warn: "bg-warn/15 text-warn border-warn/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

const SIZE_CLASSES: Record<"xs" | "sm", string> = {
  xs: "px-1.5 py-0 text-[10px] gap-0.5 leading-snug",
  sm: "px-2 py-0.5 text-[11px] gap-1 leading-snug",
};

// 가장 강한 위험 마크만 shake로 시선 끌기 — 너무 많은 떨림은 피로 유발.
// 기준: tone="bad" 인 priority 1 마크(외인 던지기·52주 신저가·개미무덤)와
// 동급 우선순위의 ant_shake(개미털기, warn). priority 2 이하는 잠잠.
const SHAKE_MARK_KEYS = new Set([
  "foreign_dump",
  "new_52w_low",
  "ant_grave",
  "ant_shake",
]);

function SignalMarkBadge({
  mark,
  size,
}: {
  mark: SignalMark;
  size: "xs" | "sm";
}) {
  const title = mark.detail ? `${mark.label} — ${mark.detail}` : mark.label;
  const shake = SHAKE_MARK_KEYS.has(mark.key) ? " shake-warn" : "";
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border font-medium tabular ${SIZE_CLASSES[size]} ${TONE_CLASSES[mark.tone]}${shake}`}
    >
      <span aria-hidden>{mark.emoji}</span>
      <span>{mark.label}</span>
    </span>
  );
}
