import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "이용약관 — Ticker",
  description: "Ticker(룰 기반 판단 보조) 서비스의 이용약관",
  robots: { index: false, follow: false },
};

const EFFECTIVE_DATE = "2026년 6월 12일";

// 본 약관은 본격 법무 검토 전 단계의 정보 제공용 표준 문구다.
// 핵심 메시지: 1) 참고용 데이터, 2) 투자권유 아님, 3) 본인 책임.
// 향후 법무 검토 시 조항·번호·관할은 그대로 두고 카피만 보강할 수 있게 단순한 구조로 유지.
export default function TermsPage() {
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
          이용약관
        </h1>
        <p className="text-sm text-muted-foreground">
          시행일: {EFFECTIVE_DATE}
        </p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제1조 (목적 및 서비스 정의)
        </h2>
        <p>
          본 약관은 운영자(이하 “회사”)가 제공하는 룰 기반 판단 보조 도구
          “Ticker”(이하 “서비스”)의 이용 조건과 책임 범위를 정함을 목적으로 합니다.
          서비스는 공개된 시세·지수·뉴스 등을 정해진 규칙에 따라 가공한
          <strong className="text-foreground"> 정보 제공용 도구</strong>이며,
          금융상품의 매매를 알선하거나 투자자문업·투자권유를 수행하지 않습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제2조 (이용자 자격 및 책임)
        </h2>
        <p>
          이용자는 회사가 정한 절차에 따라 서비스에 접속하여 본 약관에 동의하고
          이를 준수할 책임이 있습니다. 서비스 화면에 표시되는 모든 신호·예측·점수는
          알고리즘 출력일 뿐 매매 추천이 아니며,{" "}
          <strong className="text-foreground">
            투자 결정과 그 결과 책임은 전적으로 이용자 본인에게
          </strong>{" "}
          있습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제3조 (이용 제한 및 금지 행위)
        </h2>
        <p>
          이용자는 다음 각 호의 행위를 하여서는 안 됩니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>서비스 데이터를 무단으로 자동 수집·재배포·상업적 재판매하는 행위</li>
          <li>비밀번호 또는 접근 토큰을 타인에게 공유·양도하는 행위</li>
          <li>서비스 운영을 방해하거나 비정상적 트래픽을 유발하는 행위</li>
          <li>리버스 엔지니어링·취약점 탐색·DDoS 등 시스템 보안을 침해하는 행위</li>
          <li>관계 법령 또는 본 약관에서 금지하는 그 밖의 행위</li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제4조 (면책 및 책임 한계)
        </h2>
        <p>
          서비스는 정보 제공만을 목적으로 하므로,
          <strong className="text-foreground">
            {" "}이용자의 투자 손익에 대해 회사는 어떠한 책임도 부담하지 않습니다.
          </strong>{" "}
          서비스에서 사용되는 외부 데이터의 지연·오류·누락,
          알고리즘 출력의 부정확성, 통신 장애, 서버 점검 등으로 인한 손실은
          이용자에게 책임이 귀속됩니다. 다만, 회사의 고의 또는 중대한 과실로 인한
          손해는 관련 법령이 허용하는 범위 내에서 책임을 부담합니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제5조 (외부 데이터 출처 및 정확성)
        </h2>
        <p>
          서비스가 사용하는 시세·지수·재무·뉴스 데이터는 KIS(한국투자증권),
          네이버 금융, Yahoo Finance, Google News 등 제3자 공개 채널에서 수집됩니다.
          회사는 외부 데이터의 정확성·완전성·실시간성을 보증하지 않으며,
          데이터 제공자의 정책 변경, API 중단, 지연 등이 발생할 수 있음을 이용자는
          이해하고 동의합니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제6조 (서비스의 변경·중단)
        </h2>
        <p>
          회사는 운영상·기술상 필요에 따라 서비스의 전부 또는 일부를 사전 공지
          없이 변경·중단할 수 있습니다. 변경 또는 중단으로 인한 영향은
          합리적으로 최소화하도록 노력하며, 본 약관에 따른 면책의 범위에서
          이용자에게 별도의 보상 의무를 부담하지 않습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제7조 (지식재산권)
        </h2>
        <p>
          서비스의 디자인, 알고리즘, 코드, 텍스트, 이미지 등 일체의 저작물에
          대한 권리는 회사 또는 정당한 권리자에게 귀속됩니다. 이용자는 회사의
          사전 서면 동의 없이 이를 복제·전송·출판·배포·전시·방송하거나
          제3자에게 이용하게 할 수 없습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제8조 (약관의 효력 및 변경)
        </h2>
        <p>
          본 약관은 서비스 화면에 게시한 날부터 효력이 발생합니다. 회사는
          관련 법령을 위반하지 않는 범위에서 약관을 개정할 수 있으며, 개정 시
          시행일과 변경 사유를 명시하여 서비스 내에서 사전에 공지합니다.
          개정 약관에 동의하지 않는 이용자는 서비스 이용을 중단할 수 있습니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제9조 (준거법 및 관할법원)
        </h2>
        <p>
          본 약관은 대한민국 법률에 따라 해석되며, 서비스 이용과 관련하여
          분쟁이 발생할 경우 민사소송법이 정하는 절차에 따른 법원을
          관할로 합니다.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          제10조 (문의)
        </h2>
        <p>
          본 약관 또는 서비스에 관한 문의는 운영자에게 직접 전달해 주세요.
          별도 고객센터 채널은 추후 안내됩니다.
        </p>
      </section>

      <footer className="pt-6 border-t border-border text-xs text-muted-foreground space-y-1.5">
        <p>
          본 약관은 정식 법무 검토 전 표준 문구로 작성된 초안입니다. 향후 사업
          확장에 따라 개정될 수 있습니다.
        </p>
        <p>
          <Link
            href="/privacy"
            className="text-accent hover:opacity-80 transition-opacity"
          >
            개인정보 처리방침 보기
          </Link>
        </p>
      </footer>
    </main>
  );
}
