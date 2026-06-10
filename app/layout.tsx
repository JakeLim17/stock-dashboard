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

export const metadata: Metadata = {
  title: "Ticker — 룰 기반 판단 보조",
  description: "실시간 주식 시세 + 룰 기반 매매 판단 보조 대시보드",
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
