"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// App Router 는 native navigation start 이벤트가 없어,
// 우선 단순 버전으로: pathname 변화 = navigation 완료 직후
// 0% → 100% 한 번 채우고 짧게 fade out.
// 전환 자체가 느려 보이는 페인을 시각적으로 누그러뜨리는 용도.
// keyframe 정의 없이 inline transition 만 사용 — globals.css 무수정.
export function TopProgressBar() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    // 새 경로 진입 시: 짧게 보였다가 사라지는 한 사이클을 돌린다.
    setVisible(true);
    setWidth(0);
    // 다음 프레임에 width 를 100 으로 — transition 이 작동하도록.
    const raf = requestAnimationFrame(() => {
      setWidth(100);
    });
    // 400ms 후 fade out 시작, 700ms 후 완전 제거.
    const fadeTimer = setTimeout(() => setVisible(false), 400);
    const clearTimer = setTimeout(() => {
      setWidth(0);
    }, 700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fadeTimer);
      clearTimeout(clearTimer);
    };
  }, [pathname]);

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[100] h-0.5 pointer-events-none"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 300ms ease-out" }}
    >
      <div
        className="h-full bg-accent"
        style={{
          width: `${width}%`,
          transition: "width 400ms ease-out",
        }}
      />
    </div>
  );
}
