import { DashboardShell } from "@/components/DashboardShell";

// 페이지 자체는 server fetch 를 하지 않는다 — 즉시 응답 → DashboardShell 이
// client mount 후 /api/snapshot 을 fetch 하고, 그 전까지 DashboardSkeleton 을 표시.
//
// 이전(2 단계 Suspense + server fetch) 구조는 buildSnapshot 한쪽이 hang 되면
// 외부 LoadingScreen 이 수십초간 머무는 사고가 있어 단순화함.
// LoadingScreen 자체는 app/loading.tsx 가 자동 트리거하는 RSC 전환 fallback 으로
// 그대로 살아 있다 (로그인 → 첫 페이지 진입 시 매우 짧게 보임).
//
// force-static: 홈 HTML 은 CDN. force-dynamic 이면 새로고침마다 Serverless 1회
// (Hobby Active CPU·Invocations 낭비). 데이터는 /api/* 만 동적.
export const dynamic = "force-static";

export default function HomePage() {
  return <DashboardShell />;
}
