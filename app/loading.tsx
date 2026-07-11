import { LoadingScreen } from "@/components/LoadingScreen";

// Next.js App Router의 자동 페이지 전환 fallback.
// 로그인 → / 진입 시 page.tsx(즉시 DashboardShell) 전환 동안 짧게 보인다.
// (과거 server buildSnapshot 대기는 제거됨. 실제 데이터 대기는 DashboardSkeleton.)
export default function Loading() {
  return <LoadingScreen stuckAfterSec={45} />;
}
