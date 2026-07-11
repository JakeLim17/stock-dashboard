// 로그인 게이트 공통 — middleware · login API · realtime 스트림이 동일 규칙을 쓴다.
//
// 기본: DASHBOARD_PASS 가 있어야 대시보드 진입 가능.
// 개발 편의 우회: AUTH_DISABLED=1 을 **명시**해야만 무비번 통과.
// (예전: PASS 미설정만으로 자동 우회 → 프로덕션 실수 시 공개 노출 위험)

export function getDashboardPass(): string | undefined {
  const pass = process.env.DASHBOARD_PASS?.trim();
  return pass ? pass : undefined;
}

/** 명시적 무인증 허용. 로컬 전용 — Vercel 에는 넣지 말 것. */
export function isAuthBypassEnabled(): boolean {
  const v = (process.env.AUTH_DISABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
