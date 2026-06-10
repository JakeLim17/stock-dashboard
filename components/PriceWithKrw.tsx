"use client";

import { formatKrwAmount, type DisplayCurrency } from "@/lib/utils";

// USD 종목 가격 옆/아래에 환율 적용 원화를 잘 보이게 표시하는 라벨.
//
//   - currency === "KRW" (한국 종목) → 아무것도 안 그린다 (회귀 금지)
//   - currency === "USD" + 환율 있음 → "≈ ₩587,800" 본문 톤(약간 진한 muted) + medium weight
//   - 환율 없음/가격 비정상 → 아무것도 안 그린다 (graceful)
//
// 사용자 피드백("KRW 환산이 안 보인다") 반영:
//   - 기본 글자색을 muted → foreground/80 으로 강화
//   - 기본 굵기 font-medium (이전 normal)
//   - prefix(≈) 와 ₩XXX,XXX 사이 spacing 살짝
// 부모는 className으로 정렬·크기·여백을 자유롭게 덮어쓸 수 있다.
export function PriceWithKrw({
  price,
  currency,
  krwRate,
  className = "",
  prefix = "≈ ",
  size = "sm",
}: {
  price: number | null | undefined;
  currency: DisplayCurrency;
  krwRate: number | null;
  /** 추가 클래스 (정렬·여백 등). 색·굵기는 기본값 위에서 덮어쓰기 가능. */
  className?: string;
  /** 앞에 붙는 기호. 기본 "≈ " (근사 표시). 안 보이게 하려면 빈 문자열. */
  prefix?: string;
  /**
   * 글자 크기 프리셋.
   *   sm (기본) : text-sm — 카드/디테일 본문 옆 보조 라인
   *   md        : text-base — 메인 가격 옆에서 시선 끌고 싶을 때
   *   xs        : text-xs — 좁은 자리(시나리오 표·미니 칩)
   */
  size?: "xs" | "sm" | "md";
}) {
  if (currency !== "USD") return null;
  const krw = formatKrwAmount(price, krwRate);
  if (!krw) return null;
  const sizeCls = size === "md" ? "text-base" : size === "xs" ? "text-xs" : "text-sm";
  return (
    <span
      className={`tabular font-medium text-foreground/80 whitespace-nowrap ${sizeCls} ${className}`}
      aria-label={`원화 환산 ${krw}`}
      title={krwRate ? `환율 ${krwRate.toLocaleString("ko-KR")}원 적용 (보조)` : undefined}
    >
      {prefix}
      {krw}
    </span>
  );
}
