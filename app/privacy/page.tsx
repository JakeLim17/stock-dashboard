import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보 처리방침 — Ticker",
  description: "Ticker 서비스의 개인정보 처리방침",
  robots: { index: false, follow: false },
};

const EFFECTIVE_DATE = "2026년 6월 12일";

// 현재 서비스는 회원가입 없이 단일 비밀번호 + 30일 쿠키 방식이라 식별 정보 수집이 사실상 없다.
// 다만 향후 사용자 분석·결제·고객관리 단계에서 카피만 보강할 수 있게 표준 8개 섹션 구조 유지.
export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 md:px-6 py-10 space-y-8 text-foreground">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← 대시보드로 돌아가기
        </Link>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          개인정보 처리방침
        </h1>
        <p className="text-sm text-muted-foreground">
          시행일: {EFFECTIVE_DATE}
        </p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          1. 수집하는 개인정보 항목
        </h2>
        <p>
          본 서비스는 회원가입 없이 단일 비밀번호 인증 방식으로 운영되며,
          이용자의 이름·이메일·전화번호 등 직접적 개인 식별 정보를 수집하지
          않습니다. 현재 수집되는 정보는 다음과 같습니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            인증 쿠키 (서비스 접근 자격을 30일 동안 유지하기 위한 암호화된 토큰)
          </li>
          <li>
            서비스 이용 시 발생하는 익명 트래픽 통계 (Vercel Analytics —
            페이지 단위 방문 수, 디바이스 종류, 국가 단위 위치). 별도의
            IP·쿠키·이용자 식별자를 저장하지 않습니다.
          </li>
          <li>
            로컬 환경(브라우저 localStorage)에만 저장되는 관심종목, 다크모드
            설정, 면책 동의 여부 — 서버로 전송되지 않습니다.
          </li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          2. 수집 및 이용 목적
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>인증 쿠키: 로그인 상태 유지 및 비인가 접근 차단</li>
          <li>익명 트래픽 통계: 서비스 품질 개선 및 장애 모니터링</li>
          <li>로컬 설정: 이용자 편의 기능 제공 (관심종목, 테마)</li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          3. 보관 및 파기
        </h2>
        <p>
          인증 쿠키는 발급일로부터 30일이 경과하면 자동 만료됩니다. 익명 트래픽
          통계는 Vercel Analytics 정책에 따라 집계 상태로만 보관되며,
          원본 식별 정보는 즉시 폐기됩니다. 이용자가 브라우저 데이터 또는
          로그아웃을 통해 쿠키를 직접 삭제할 수 있습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          4. 제3자 제공
        </h2>
        <p>
          회사는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 관계
          법령에 따라 적법한 요청이 있는 경우에는 그 범위 내에서 제공할 수
          있습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          5. 처리 위탁
        </h2>
        <p>
          서비스 운영을 위해 다음의 위탁사를 사용합니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>호스팅: Vercel Inc. (정적 자산 배포 및 서버리스 함수 실행)</li>
          <li>익명 통계: Vercel Analytics</li>
        </ul>
        <p>
          위탁 업무 외의 목적으로 개인정보가 사용되지 않도록 계약을 통해
          관리합니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          6. 쿠키 정책
        </h2>
        <p>
          본 서비스는 로그인 상태 유지를 위해 단일 인증 쿠키를 사용합니다.
          해당 쿠키는 <code>HttpOnly</code>, <code>Secure</code>,{" "}
          <code>SameSite=Strict</code> 속성으로 설정되어 브라우저 JavaScript
          에서 접근할 수 없으며, 같은 사이트 요청에서만 전송됩니다. 외부
          링크에서 처음 접속하시는 경우 보안 정책상 로그인 페이지로
          이동할 수 있습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          7. 이용자의 권리
        </h2>
        <p>
          이용자는 언제든지 로그아웃 또는 브라우저 데이터 삭제를 통해 본
          서비스가 저장한 정보를 제거할 수 있습니다. 관계 법령에 따른
          열람·정정·삭제 요청은 아래 문의처를 통해 접수해 주세요.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          8. 문의 및 변경 고지
        </h2>
        <p>
          본 방침에 관한 문의는 운영자에게 직접 전달해 주세요. 처리방침이
          변경될 경우 시행일과 변경 사유를 명시하여 서비스 내에서 사전에
          공지합니다.
        </p>
      </section>

      <footer className="pt-6 border-t border-border text-xs text-muted-foreground space-y-1.5">
        <p>
          본 방침은 정식 법무 검토 전 표준 문구로 작성된 초안이며, 서비스
          기능 추가에 따라 개정될 수 있습니다.
        </p>
        <p>
          <Link
            href="/terms"
            className="text-accent hover:opacity-80 transition-opacity"
          >
            이용약관 보기
          </Link>
        </p>
      </footer>
    </main>
  );
}
