"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, KeyRound, Loader2 } from "lucide-react";

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  // controlled state도 유지하지만 신뢰값은 ref.current.value 로 읽는다.
  // iOS Safari / 데스크탑 비번 매니저가 자동완성한 경우 onChange 가 안 발생하는 일이 있어
  // pw state 가 빈 채로 남고 버튼이 disabled 가 되는 함정이 있다.
  const inputRef = useRef<HTMLInputElement>(null);
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const value = inputRef.current?.value ?? pw;
    if (!value) {
      setError("비밀번호를 입력해 주세요");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: value }),
        // 같은 origin 이라 default 로도 쿠키가 붙지만 명시
        credentials: "same-origin",
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `로그인 실패 (${r.status})`);
      }
      const next = sp.get("next") || "/";
      // 미들웨어가 쿠키를 다음 요청에서 인식하도록 hard navigation
      window.location.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background text-foreground">
      <form
        onSubmit={onSubmit}
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
              ref={inputRef}
              type="password"
              name="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onInput={(e) => setPw((e.target as HTMLInputElement).value)}
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

        {error && (
          <p className="text-sm text-down bg-down/10 border border-down/30 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-foreground text-background font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity active:opacity-80"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          들어가기
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
