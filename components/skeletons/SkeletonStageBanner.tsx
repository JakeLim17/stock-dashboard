"use client";

import { useEffect, useState } from "react";
import { Activity, Loader2 } from "lucide-react";

// DashboardSkeleton 상단에 띄우는 "지금 무엇을 하고 있는지" 라이브 배너.
// 첫 진입(또는 새로고침) 후 /api/snapshot 응답이 도착하기 전까지의 5~13초 동안
// "화면이 멈춘 듯이 보이는" 인지를 없앤다.
//
//   - 단계 메시지를 1.6초 간격으로 순환 (시세 → 수급 → 컨센서스 → 뉴스 → 예측 → 마무리)
//   - 우측에 경과 초 카운터 (0초부터 시작, 시각적 진행감)
//   - 하단에 indeterminate shimmer 진행 막대 (실제 진행률은 모르지만 "움직이고 있다" 시각화)
//
// 컴포넌트는 client 전용 — useEffect 타이머를 사용한다.
// 데이터가 도착하면 부모(DashboardShell)가 통째로 DashboardClient 로 교체하므로
// 별도 종료 로직 없이 그대로 unmount 된다.

const STAGES = [
  "시장 지표 받는 중...",
  "관심 종목 시세 수집 중...",
  "수급(외인·기관) 분석 중...",
  "컨센서스 정리 중...",
  "뉴스 수집 중...",
  "예측·차트 계산 중...",
  "마무리 중...",
] as const;

const STAGE_INTERVAL_MS = 1600;

export function SkeletonStageBanner() {
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const stageTimer = setInterval(() => {
      setStage((s) => Math.min(s + 1, STAGES.length - 1));
    }, STAGE_INTERVAL_MS);
    const secTimer = setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
    return () => {
      clearInterval(stageTimer);
      clearInterval(secTimer);
    };
  }, []);

  const message = STAGES[stage];
  const progress = Math.min(((stage + 1) / STAGES.length) * 100, 92);

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-accent/30 bg-accent/5 px-4 md:px-5 py-3 md:py-3.5 shadow-sm"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <Loader2 className="h-4 w-4 text-accent animate-spin" />
          <Activity className="h-3.5 w-3.5 text-accent opacity-70" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p
            key={stage}
            className="text-sm font-medium leading-tight animate-[stage-fade_0.35s_ease-out]"
          >
            {message}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            첫 진입은 데이터 수집으로 보통 5~10초 걸려요. 이후엔 자동 갱신됩니다.
          </p>
        </div>
        <span className="tabular text-[11px] text-muted-foreground inline-flex items-center px-2 py-0.5 rounded-full border border-border bg-card shrink-0">
          <span className="font-semibold text-foreground mr-1">{elapsed}</span>초 경과
        </span>
      </div>

      {/* indeterminate shimmer + 단계 비례 채움 — 두 효과를 겹쳐서 "움직이며 채워지는" 느낌 */}
      <div className="mt-3 relative h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-accent/70 transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute inset-y-0 w-1/3 bg-accent/40"
          style={{
            animation: "stage-shimmer 1.6s linear infinite",
          }}
        />
      </div>

      <style>{`
        @keyframes stage-fade {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes stage-shimmer {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(420%); }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="status"] .animate-spin { animation: none !important; }
          [role="status"] [style*="stage-shimmer"] { animation: none !important; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
