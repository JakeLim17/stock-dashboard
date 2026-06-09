"use client";

import { useState } from "react";
import { ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { LoadingScreen } from "@/components/LoadingScreen";

// HTML form 의 native submit 동작은 그대로 유지하고,
// 버튼 visual 만 client 컴포넌트로 분리한다 (iOS 호환성 유지).
// onClick 에서 상태만 바꾸고, event.preventDefault() 는 하지 않는다.
// navigation 후 컴포넌트 unmount 로 상태 자동 정리.
// CRITICAL: `disabled` 를 같은 사이클에 걸면 HTML 스펙상 form submit 이 차단됨.
// → aria-busy 만 사용하고 disabled 는 걸지 않는다. 두 번째 클릭은 어차피
//   navigation 으로 페이지가 바뀌어 거의 발생하지 않으며, 발생해도 같은 POST 라 무해.
//
// 추가: 클릭 즉시 풀스크린 LoadingScreen 오버레이를 띄워 단계 메시지·카운트다운·progress bar 가
// POST + redirect 진행 동안에도 보이게 한다. 새 페이지(/) 진입 후 page.tsx 의 Suspense fallback
// 도 LoadingScreen 이라 자연스럽게 이어진다 (디자인 동일 → 사용자에게 연속처럼 보임,
// 카운트는 새 mount 로 재시작되지만 단계 메시지는 즉시 흘러간다).
export function LoginSubmitButton() {
  const [submitting, setSubmitting] = useState(false);

  return (
    <>
      <button
        type="submit"
        onClick={() => setSubmitting(true)}
        aria-busy={submitting}
        className="group relative w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg overflow-hidden font-medium text-white transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] touch-manipulation shadow-[0_0_24px_-8px_rgba(77,141,255,0.55)] hover:shadow-[0_0_32px_-6px_rgba(77,141,255,0.85)]"
      >
        {/* 그라데이션 layer 1 — 기본 */}
        <span
          aria-hidden
          className="absolute inset-0 transition-opacity duration-300 group-hover:opacity-0"
          style={{
            background:
              "linear-gradient(135deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 55%, white) 100%)",
          }}
        />
        {/* 그라데이션 layer 2 — hover 시 살짝 밝아짐 */}
        <span
          aria-hidden
          className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--accent) 70%, white) 0%, var(--accent) 100%)",
          }}
        />
        {/* 상단 미세 하이라이트 */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-white/30"
        />

        <span className="relative z-10 inline-flex items-center gap-2">
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>로그인 중...</span>
            </>
          ) : (
            <>
              <KeyRound className="h-4 w-4" />
              <span>들어가기</span>
              <ArrowRight className="h-4 w-4 -ml-0.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </>
          )}
        </span>
      </button>

      {submitting ? (
        <div
          className="fixed inset-0 z-50 bg-background animate-[fadeInOverlay_0.18s_ease-out]"
          role="status"
          aria-live="polite"
        >
          <LoadingScreen />
          <style>{`
            @keyframes fadeInOverlay {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
          `}</style>
        </div>
      ) : null}
    </>
  );
}
