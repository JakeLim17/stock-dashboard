import { LoadingScreen } from "@/components/LoadingScreen";

// Next.js App Router의 자동 페이지 전환 fallback.
// 로그인 직후 / 진입 시 page.tsx의 RSC(buildSnapshot)가 끝나기 전까지
// 즉시 풀스크린으로 표시되며, 데이터가 도착하면 자동으로 page.tsx 컨텐츠로 교체된다.
//
// "YouTube 홈 썸네일이 채워지는 느낌" — 빈 화면 대신 단계 메시지가 순환하면서
// "지금 무엇을 하고 있는지" 시각적으로 안내한다.
export default function Loading() {
  return <LoadingScreen />;
}
