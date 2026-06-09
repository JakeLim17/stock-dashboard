import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

// 모든 영역 스켈레톤의 공통 빌딩 블록.
// Tailwind animate-pulse + muted 색을 사용해 카드 위에서도 자연스럽게 깜빡인다.
// 너비/높이는 호출자가 className으로 지정. 별도 client component가 아니므로
// RSC 트리에서 자유롭게 사용할 수 있다.
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-muted/70 dark:bg-muted/60",
        className
      )}
      aria-hidden
      {...props}
    />
  );
}
