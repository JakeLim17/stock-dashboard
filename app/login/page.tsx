import { Suspense } from "react";
import { AlertCircle, KeyRound, ShieldCheck } from "lucide-react";
import { LoginSubmitButton } from "./LoginForm";
import { AuroraBg } from "./AuroraBg";
import { BrandHeader } from "./BrandHeader";

interface PageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

// 모바일 호환성 100% 를 위해 일반 form POST 방식 사용.
// JS 가 필요 없고, /api/login 이 직접 Set-Cookie + 303 redirect 로 응답한다.
// 비번이 틀리면 /login?error=... 로 다시 redirect 되며 메시지를 표시한다.
//
// 디자인은 다크 트레이딩 터미널 + 미니멀 프리미엄 톤.
// 배경(AuroraBg) · 헤더(BrandHeader)는 별도 컴포넌트로 분리했지만,
// form 자체와 input/hidden/submit 버튼 contract 는 절대 그대로 유지한다.
export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const next = sp.next ?? "/";
  const error = sp.error ?? null;

  const action = `/api/login?next=${encodeURIComponent(next)}`;

  return (
    <Suspense fallback={null}>
      <div className="relative min-h-screen flex items-center justify-center px-4 py-10 bg-background text-foreground overflow-hidden">
        <AuroraBg />

        <form
          method="POST"
          action={action}
          className="login-fade-up relative z-10 w-full max-w-sm space-y-6 rounded-2xl border border-border/60 bg-card/80 backdrop-blur-md p-7 sm:p-8 shadow-[0_0_60px_-15px_rgba(77,141,255,0.35)]"
        >
          <BrandHeader />

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
                required
                placeholder="••••••••"
                className="w-full h-11 pl-9 pr-3 rounded-lg border border-border/70 bg-background/60 text-base placeholder:text-muted-foreground/50 transition-[box-shadow,border-color,background-color] duration-200 focus:outline-none focus:border-accent/60 focus:bg-background/90 focus:ring-2 focus:ring-accent/30 focus:shadow-[0_0_22px_-6px_var(--accent)]"
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
              />
            </div>
          </label>

          {/* next 경로를 hidden input 으로도 동봉 (query 와 동일 효과, 안전망) */}
          <input type="hidden" name="next" value={next} />

          <LoginSubmitButton />

          {/* 하단 캡션 — 신뢰감 한 줄 */}
          <div className="flex items-center justify-center gap-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
            <ShieldCheck className="h-3 w-3" />
            <span>256-bit encrypted</span>
            <span className="opacity-50">·</span>
            <span>30일 자동 로그인</span>
          </div>
        </form>
      </div>
    </Suspense>
  );
}
