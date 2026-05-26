import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
  title: "실시간 주식 대시보드",
  description: "삼성전자 · SK하이닉스 · 삼성전기 + 반도체 시장 신호",
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
      <body className="min-h-full">
        <Script id="theme-init" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
