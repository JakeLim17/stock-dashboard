"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

// HTML form 의 native submit 동작은 그대로 유지하고,
// 버튼 visual 만 client 컴포넌트로 분리한다 (iOS 호환성 유지).
// onClick 에서 상태만 바꾸고, event.preventDefault() 는 하지 않는다.
// navigation 후 컴포넌트 unmount 로 상태 자동 정리.
export function LoginSubmitButton() {
  const [submitting, setSubmitting] = useState(false);

  return (
    <button
      type="submit"
      onClick={() => setSubmitting(true)}
      disabled={submitting}
      aria-busy={submitting}
      className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-foreground text-background font-medium hover:opacity-90 transition-opacity active:opacity-80 touch-manipulation disabled:opacity-70 disabled:cursor-progress"
    >
      {submitting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          로그인 중...
        </>
      ) : (
        <>
          <KeyRound className="h-4 w-4" />
          들어가기
        </>
      )}
    </button>
  );
}
