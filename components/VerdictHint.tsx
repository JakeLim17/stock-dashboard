"use client";

// verdict 배지(매수/매도/관망/축소 등) 옆에 붙는 작은 ⓘ 힌트.
// hover/tap 시 title 로 "룰 기반 참고 신호 (투자권유 아님)" 노출.
//
// 단일 문구·단일 마크로 컴포넌트화한 이유:
//   verdict 배지가 PredictionHero / StockCard / StockDetailPanel / RecommendationsPanel
//   4곳에 흩어져 있어, 카피·접근성 속성을 한 곳에서 관리하기 위함.
//
// UX 결정 (자본시장법 §49 / SEC IA Act §202 단정 표현 리스크 보강용):
//   - verdict 단어 자체("매수 추천" 등)는 가독성·익숙함을 위해 유지.
//   - 단정성은 ⓘ + footer 면책으로 보강 (정보형 도구임을 명시).
export function VerdictHint({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="룰 기반 참고 신호입니다. 투자권유가 아닙니다."
      title="룰 기반 참고 신호 (투자권유 아님)"
      className={`inline-flex items-center justify-center text-[10px] leading-none text-muted-foreground/80 cursor-help select-none ${
        className ?? ""
      }`}
    >
      ⓘ
    </span>
  );
}
