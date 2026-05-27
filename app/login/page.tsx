import { Suspense } from "react";
import { Activity, KeyRound } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

// 모바일 호환성 100% 를 위해 일반 form POST 방식 사용.
// JS 가 필요 없고, /api/login 이 직접 Set-Cookie + 303 redirect 로 응답한다.
// 비번이 틀리면 /login?error=... 로 다시 redirect 되며 메시지를 표시한다.
export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const next = sp.next ?? "/";
  const error = sp.error ?? null;

  const action = `/api/login?next=${encodeURIComponent(next)}`;

  return (
    <Suspense fallback={null}>
      <div className="min-h-screen flex items-center justify-center px-4 bg-background text-foreground">
        <form
          method="POST"
          action={action}
          className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-accent" />
            <h1 className="text-lg font-semibold">실시간 주식 대시보드</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            비밀번호를 한 번 입력하면 30일 동안 묻지 않아요.
          </p>

          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              비밀번호
            </span>
            <div className="relative">
              <KeyRound className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="password"
                name="password"
                required
                placeholder="••••••••"
                className="w-full h-10 pl-9 pr-3 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent/40 text-base"
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

          {error && (
            <p className="text-sm text-down bg-down/10 border border-down/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-foreground text-background font-medium hover:opacity-90 transition-opacity active:opacity-80 touch-manipulation"
          >
            <KeyRound className="h-4 w-4" />
            들어가기
          </button>
        </form>
      </div>
    </Suspense>
  );
}
