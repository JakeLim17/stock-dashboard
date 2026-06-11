"use client";

import type { NewsRiskAssessment } from "@/lib/types";
import { Badge } from "./ui/Badge";
import { AlertTriangle } from "lucide-react";

// 외부 이벤트 리스크 배지.
// low면 null 반환 — 자리 차지 없음.
// medium/high면 색상 배지 + 대표 driver 라벨.
//
// StockCard / AnalysisBox 분석 영역에서 verdict 옆에 함께 노출한다.
// 별도 패널을 두지 않는 이유: 뉴스 패널은 이미 카드 어딘가에 있어 시각적 노이즈를
// 늘리지 않는 게 우선. 배지로 한 줄에 끝내고 클릭하면 툴팁으로 상세.
export function RiskBadge({
  assessment,
  size = "sm",
}: {
  assessment: NewsRiskAssessment | undefined | null;
  size?: "sm" | "md";
}) {
  if (!assessment || assessment.level === "low") return null;

  const variant = assessment.level === "high" ? "sell" : "watch";
  const top = assessment.drivers[0]?.label;
  const title =
    assessment.drivers
      .slice(0, 3)
      .map((d) => `· ${d.label} (${d.category})`)
      .join("\n") || `외부 리스크 점수 ${assessment.score}`;

  // 진동(shake-warn) 적용 기준:
  //  - high(빨강 sell 톤)는 무조건
  //  - medium(노랑 watch)은 driver 라벨/헤드라인에 구체 위험 키워드가 포함된 경우만
  //    (과징금·소송·제재·공시위반·리콜·횡령·배임·조사·감리·파산·회생·상장폐지·회계부정)
  //  - 일반 medium(루머·실적우려 등 모호한 케이스)은 안 떨리게 절제.
  const DANGER_KEYWORDS =
    /(과징금|소송|제재|공시위반|리콜|횡령|배임|조사|감리|파산|회생|상장폐지|회계부정)/;
  const mediumHasDangerKeyword =
    assessment.level === "medium" &&
    assessment.drivers.some(
      (d) => DANGER_KEYWORDS.test(d.label) || DANGER_KEYWORDS.test(d.headline)
    );
  const shouldShake =
    assessment.level === "high" || mediumHasDangerKeyword;
  const className = shouldShake ? "shake-warn" : undefined;

  return (
    <Badge variant={variant} size={size} title={title} className={className}>
      <AlertTriangle className="h-3 w-3" />
      {assessment.level === "high" ? "외부 리스크 ↑" : "외부 리스크"}
      {top && <span className="opacity-80">· {top}</span>}
    </Badge>
  );
}
