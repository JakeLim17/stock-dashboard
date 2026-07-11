import { Suspense } from "react";
import { getDashboardPass, isAuthBypassEnabled } from "@/lib/authGate";
import { LoginForm } from "./LoginForm";
import { AuroraBg } from "./AuroraBg";
import { BrandHeader } from "./BrandHeader";

interface PageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

// 모바일 호환성 100% 를 위해 일반 form POST 방식 사용.
// JS 가 필요 없고, /api/login 이 직접 Set-Cookie + 303 redirect 로 응답한다.
// 비번이 틀리면 /login?error=... 로 다시 redirect 되며 메시지를 표시한다.
export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const next = sp.next ?? "/";
  const passConfigured = Boolean(getDashboardPass());
  const bypass = isAuthBypassEnabled();
  const error =
    sp.error ??
    (!passConfigured && !bypass
      ? "비밀번호가 설정되지 않았습니다 (DASHBOARD_PASS)"
      : null);

  const action = `/api/login?next=${encodeURIComponent(next)}`;

  return (
    <Suspense fallback={null}>
      <div className="relative min-h-screen flex items-center justify-center px-4 py-10 bg-background text-foreground overflow-hidden">
        <AuroraBg />
        <LoginForm
          action={action}
          next={next}
          error={error}
          passConfigured={passConfigured}
          bypass={bypass}
          brand={<BrandHeader />}
        />
      </div>
    </Suspense>
  );
}
