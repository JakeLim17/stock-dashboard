"use client";

import { formatKrwAmount, type DisplayCurrency } from "@/lib/utils";

// USD 종목 가격 옆/아래에 환율 적용 원화를 보조 표시하는 한 줄 라벨.
//
//   - currency === "KRW" (한국 종목) → 아무것도 안 그린다 (회귀 금지)
//   - currency === "USD" + 환율 있음 → "≈ ₩575,090" 같은 회색 작은 글씨
//   - 환율 없음/가격 비정상 → 아무것도 안 그린다 (graceful)
//
// 부모가 메인 가격 옆/아래에 자유롭게 배치할 수 있게 inline-block + 작은 폰트로 유지.
// 클릭/aria 영향 없는 순수 표시 컴포넌트.
export function PriceWithKrw({
  price,
  currency,
  krwRate,
  className = "",
  prefix = "≈ ",
}: {
  price: number | null | undefined;
  currency: DisplayCurrency;
  krwRate: number | null;
  /** 추가 클래스 (정렬·여백 등). 색은 기본 muted-foreground. */
  className?: string;
  /** 앞에 붙는 기호. 기본 "≈ " (근사 표시). */
  prefix?: string;
}) {
  if (currency !== "USD") return null;
  const krw = formatKrwAmount(price, krwRate);
  if (!krw) return null;
  return (
    <span
      className={`tabular text-muted-foreground ${className}`}
      aria-label={`원화 환산 ${krw}`}
      title={krwRate ? `환율 ${krwRate.toLocaleString("ko-KR")}원 적용 (보조)` : undefined}
    >
      {prefix}
      {krw}
    </span>
  );
}
