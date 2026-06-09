"use client";

import { useEffect, useState } from "react";
import { Activity, Loader2 } from "lucide-react";

// 단계 메시지 — 약 1.4초 간격으로 순환. 마지막 단계는 데이터가 늦어질 때 그대로 유지.
// "지금 무엇을 하고 있는지" 사용자에게 시각적으로 안내해 체감 대기 시간을 줄인다.
const STAGES = [
  "시장 지표 수집 중...",
  "관심 종목 분석 중...",
  "뉴스 · 컨센서스 정리 중...",
  "예측 · 차트 준비 중...",
  "마무리 중...",
] as const;

const STAGE_INTERVAL_MS = 1400;
const COUNTDOWN_INIT_SEC = 5;

// 로그인 직후 메인 페이지로 들어올 때 즉시 보이는 풀스크린 로딩.
// app/loading.tsx 가 RSC 트리에서 이 컴포넌트를 렌더한다.
//
// 데이터가 도착하면 Next.js가 자동으로 page.tsx 컨텐츠로 교체하므로
// 카운트다운/단계 메시지가 끝까지 가지 않아도 자연스럽게 사라진다.
export function LoadingScreen() {
  const [stage, setStage] = useState(0);
  const [seconds, setSeconds] = useState(COUNTDOWN_INIT_SEC);

  useEffect(() => {
    const stageTimer = setInterval(() => {
      setStage((s) => Math.min(s + 1, STAGES.length - 1));
    }, STAGE_INTERVAL_MS);
    const secTimer = setInterval(() => {
      setSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      clearInterval(stageTimer);
      clearInterval(secTimer);
    };
  }, []);

  const message = STAGES[stage];

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background text-foreground">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Activity className="h-4 w-4 text-accent" />
          <span className="text-xs uppercase tracking-wider">
            실시간 주식 대시보드
          </span>
        </div>

        <div className="flex flex-col items-center gap-5 py-6">
          <Loader2 className="h-10 w-10 animate-spin text-accent" />
          {/* 단계 메시지 — fade-in을 위해 key를 stage로 줘서 매 변경마다 리마운트 */}
          <p
            key={stage}
            className="text-base font-medium animate-[fadeIn_0.3s_ease-out]"
          >
            {message}
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <CountdownPill seconds={seconds} />
            <span className="opacity-70">
              데이터를 모두 받을 때까지 잠시만 기다려주세요.
            </span>
          </div>
        </div>

        {/* 진행 막대 — 단계별 채워짐 (시각적 보조) */}
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(((stage + 1) / STAGES.length) * 100, 95)}%`,
            }}
          />
        </div>

        <p className="text-[11px] text-muted-foreground opacity-70">
          첫 진입은 데이터 수집으로 3~5초 걸릴 수 있어요. 이후엔 자동 갱신됩니다.
        </p>
      </div>

      {/* keyframe은 globals.css 에 없어서 inline. tailwind v4에서 동작 안 하면 자연스러운 page 도착이라 무해 */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function CountdownPill({ seconds }: { seconds: number }) {
  if (seconds <= 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-border bg-card tabular">
        곧 도착...
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-border bg-card tabular">
      예상 <span className="font-semibold text-foreground mx-1">{seconds}</span>초
    </span>
  );
}
