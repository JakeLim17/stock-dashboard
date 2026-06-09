// 로그인 화면 배경 — 다크 트레이딩 터미널 + 미니멀 프리미엄 톤.
// 1) 미세 1px dot grid (opacity 약 5~8%)
// 2) 좌상단 / 우하단 accent 컬러 aurora blob (blur + 저투명도)
// 모두 pointer-events-none 으로 배치해 폼 인터랙션을 절대 막지 않는다.
//
// 다크/라이트 모두 무난해 보이도록 색은 currentColor 가 아닌
// accent 변수 + 화이트 미세 톤을 직접 박는다 (테마는 layout.tsx 가 default dark).
export function AuroraBg() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* 1px dot grid — 살짝 보일 정도로만 */}
      <div
        className="absolute inset-0 opacity-[0.07] dark:opacity-[0.09]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "26px 26px",
          color: "var(--foreground)",
        }}
      />

      {/* 좌상단 aurora blob — accent 톤 */}
      <div
        className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full blur-3xl opacity-[0.18] dark:opacity-[0.22]"
        style={{
          background:
            "radial-gradient(circle at center, var(--accent) 0%, transparent 70%)",
        }}
      />

      {/* 우하단 aurora blob — 살짝 다른 톤 (foreground 섞임) */}
      <div
        className="absolute -bottom-40 -right-24 h-[480px] w-[480px] rounded-full blur-3xl opacity-[0.14] dark:opacity-[0.18]"
        style={{
          background:
            "radial-gradient(circle at center, var(--accent) 0%, transparent 65%)",
        }}
      />

      {/* 상단 미세 비네트 — 카드 배경에 깊이 부여 */}
      <div
        className="absolute inset-x-0 top-0 h-40 opacity-60"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.25), transparent)",
        }}
      />
    </div>
  );
}
