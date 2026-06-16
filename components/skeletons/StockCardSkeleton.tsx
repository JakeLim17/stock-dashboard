"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Skeleton } from "./Skeleton";

// 카드별 분석 단계 메시지 — 한 카드 안에서 1.4초 간격으로 회전.
// 카드별로 시작 stage 를 어긋나게 잡아 "각 종목이 동시에 분석되고 있다"는 느낌을 준다.
//
//   ex) 카드 0 → "주가 시세 받는 중..." 부터 시작
//       카드 1 → "수급 분석 중..." 부터 시작
//       카드 2 → "예측 계산 중..." 부터 시작
const CARD_STAGES = [
  "주가 시세 받는 중...",
  "수급 분석 중...",
  "예측 계산 중...",
  "컨센서스 정리 중...",
  "기술적 지표 분석 중...",
] as const;

const STAGE_INTERVAL_MS = 1400;

// 개별 종목 카드 스켈레톤 — 헤더 + 가격 + 시그널 배지 라인 + 작은 메트릭 3개.
// 상단에 작은 spinner + 회전하는 단계 메시지를 함께 노출해 "분석 중이라는 사실"이
// 정적 pulse 만으론 부족할 때를 보완한다.
function SingleCardSkeleton({ index }: { index: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), STAGE_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);
  const stageIdx = (index + tick) % CARD_STAGES.length;
  const message = CARD_STAGES[stageIdx];

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
      {/* 상단 — 작은 spinner + 회전 메시지. fade-in 으로 메시지 전환 시 부드럽게. */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 text-accent animate-spin" aria-hidden />
        <span
          key={stageIdx}
          className="animate-[card-stage-fade_0.3s_ease-out] tabular"
        >
          {message}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
        </div>
        <Skeleton className="h-6 w-14 rounded-full" />
      </div>
      <div className="flex items-end gap-2">
        <Skeleton className="h-7 w-28 rounded" />
        <Skeleton className="h-4 w-16 rounded" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Skeleton className="h-5 w-12 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-10 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
        <Skeleton className="h-8 rounded" />
        <Skeleton className="h-8 rounded" />
        <Skeleton className="h-8 rounded" />
      </div>

      <style>{`
        @keyframes card-stage-fade {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[card-stage-fade_0\\.3s_ease-out\\] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

// StockCard grid — watchlist 개수만큼 카드 자리를 미리 잡아둔다.
// 기본 6개 (모바일/태블릿/데스크탑 1·2·3-col 어디서나 자연스러움).
export function StockCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SingleCardSkeleton key={i} index={i} />
      ))}
    </div>
  );
}
