"use client";

// verdict 배지 옆 1줄 이유 — "반도체 과열 78/100" vs "외인 5일 누적 +320억"
export function VerdictReasonLine({
  line,
  className,
}: {
  line?: string | null;
  className?: string;
}) {
  if (!line) return null;
  return (
    <span
      className={`text-[10px] leading-snug text-muted-foreground max-w-[220px] line-clamp-2 block ${
        className ?? ""
      }`}
      title={line}
    >
      {line}
    </span>
  );
}
