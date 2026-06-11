import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { TopProgressBar } from "@/components/TopProgressBar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// OG/Twitter 메타는 외부 링크 공유(검색·메신저·SNS) 시 카드 미리보기 품질을 결정한다.
// og:image 는 향후 1200x630 전용 이미지로 교체할 자리. 현재는 favicon 으로 임시 대체해
// 카드 자체가 깨지지 않는 정도만 유지한다.
const SITE_TITLE = "Ticker — 룰 기반 판단 보조";
const SITE_DESC =
  "실시간 주식 시세 + 룰 기반 매매 판단 보조 대시보드. 정보 제공용이며 투자권유가 아닙니다.";

// OG/Twitter 이미지의 절대 URL 해석 base. 환경변수 NEXT_PUBLIC_SITE_URL 이 있으면 그 값,
// 없으면 Vercel 자동 주입 환경을 시도하고 그것도 없으면 안전한 placeholder.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
  "https://ticker.local";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESC,
  applicationName: "Ticker",
  keywords: [
    "주식 대시보드",
    "실시간 시세",
    "룰 기반 판단",
    "코스피",
    "코스닥",
    "한국 주식",
  ],
  authors: [{ name: "Ticker" }],
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "Ticker",
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [
      {
        url: "/favicon.ico",
        width: 256,
        height: 256,
        alt: "Ticker",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESC,
    images: ["/favicon.ico"],
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

// FOUC 방지: hydration 전에 .dark 클래스 적용
const themeScript = `
  (function(){
    try {
      var t = localStorage.getItem('theme');
      if (!t) t = 'dark';
      if (t === 'dark') document.documentElement.classList.add('dark');
    } catch(_) { document.documentElement.classList.add('dark'); }
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <TopProgressBar />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
