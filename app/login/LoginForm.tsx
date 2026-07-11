"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, ArrowRight, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { LoadingScreen } from "@/components/LoadingScreen";

// Native form POST 유지 (모바일·JS 꺼짐 호환).
//
// CRITICAL: submit 버튼 onClick 에서 동기 setState 하면 React 리렌더가
// 버튼 default action(form submit) 을 취소한다 → LoadingScreen 만 뜨고
// POST 가 안 나가 "로그인 중..." 에 영원히 고착된다.
// (과거 disabled 버그와 같은 계열. aria-busy 만으로도 부족 — setState 타이밍이 핵심.)
//
// → form onSubmit 에서 브라우저가 submit 을 확정한 뒤, setTimeout(0) 으로
//   오버레이만 지연 표시한다. preventDefault 는 쓰지 않는다.

type LoginFormProps = {
  action: string;
  next: string;
  error: string | null;
  passConfigured: boolean;
  bypass: boolean;
  brand: ReactNode;
};

export function LoginForm({
  action,
  next,
  error,
  passConfigured,
  bypass,
  brand,
}: LoginFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const inputEnabled = passConfigured || bypass;

  // bfcache 뒤로가기·고착 시 오버레이 해제
  useEffect(() => {
    const clear = () => setSubmitting(false);
    window.addEventListener("pageshow", clear);
    return () => window.removeEventListener("pageshow", clear);
  }, []);

  useEffect(() => {
    if (!submitting) return;
    // 리다이렉트가 안 되면(네트워크 끊김 등) 오버레이만 남는 사고 방지
    const t = window.setTimeout(() => setSubmitting(false), 12_000);
    return () => window.clearTimeout(t);
  }, [submitting]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    if (!form.checkValidity()) return;
    const pwd = new FormData(form).get("password");
    if (typeof pwd !== "string" || pwd.trim().length === 0) {
      e.preventDefault();
      return;
    }
    // submit default action 이 큐에 들어간 뒤 오버레이 표시
    window.setTimeout(() => setSubmitting(true), 0);
  }

  return (
    <>
      <form
        method="POST"
        action={action}
        onSubmit={handleSubmit}
        className="login-fade-up relative z-10 w-full max-w-sm space-y-6 rounded-2xl border border-border/60 bg-card/80 backdrop-blur-md p-7 sm:p-8 shadow-[0_0_60px_-15px_rgba(77,141,255,0.35)]"
      >
        {brand}

        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground leading-relaxed">
            비밀번호를 한 번 입력하면{" "}
            <span className="text-foreground/90 font-medium">30일 동안</span>{" "}
            묻지 않아요.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 text-sm text-down bg-down/10 border border-down/30 rounded-lg px-3 py-2.5"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        <label className="block space-y-2">
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            비밀번호
          </span>
          <div className="group relative">
            <KeyRound className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 group-focus-within:text-accent transition-colors duration-200" />
            <input
              type="password"
              name="password"
              required={inputEnabled}
              disabled={!inputEnabled}
              placeholder="••••••••"
              className="w-full h-11 pl-9 pr-3 rounded-lg border border-border/70 bg-background/60 text-base placeholder:text-muted-foreground/50 transition-[box-shadow,border-color,background-color] duration-200 focus:outline-none focus:border-accent/60 focus:bg-background/90 focus:ring-2 focus:ring-accent/30 focus:shadow-[0_0_22px_-6px_var(--accent)] disabled:opacity-50"
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
            />
          </div>
        </label>

        <input type="hidden" name="next" value={next} />

        <button
          type="submit"
          aria-busy={submitting}
          className="group relative w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg overflow-hidden font-medium text-white transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] touch-manipulation shadow-[0_0_24px_-8px_rgba(77,141,255,0.55)] hover:shadow-[0_0_32px_-6px_rgba(77,141,255,0.85)]"
        >
          <span
            aria-hidden
            className="absolute inset-0 transition-opacity duration-300 group-hover:opacity-0"
            style={{
              background:
                "linear-gradient(135deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 55%, white) 100%)",
            }}
          />
          <span
            aria-hidden
            className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in oklab, var(--accent) 70%, white) 0%, var(--accent) 100%)",
            }}
          />
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/30" />

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

        <div className="flex items-center justify-center gap-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
          <ShieldCheck className="h-3 w-3" />
          <span>256-bit encrypted</span>
          <span className="opacity-50">·</span>
          <span>30일 자동 로그인</span>
        </div>

        <p className="text-[11px] leading-relaxed text-center text-muted-foreground/70 pt-1">
          외부 링크(검색결과·메신저)에서 처음 접속하셨다면 보안 정책상 한 번
          로그인 후 정상 진입됩니다.
        </p>
      </form>

      {submitting ? (
        <div
          className="fixed inset-0 z-50 bg-background animate-[fadeInOverlay_0.18s_ease-out]"
          role="status"
          aria-live="polite"
        >
          <LoadingScreen stuckAfterSec={45} />
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
