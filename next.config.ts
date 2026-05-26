import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // better-sqlite3는 native binding이라 서버 외부 패키지로 둬야 번들 깨짐 방지
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    // 상위 디렉토리에 다른 lockfile이 있어도 이 프로젝트 루트를 명시
    root: path.join(__dirname),
  },
};

export default nextConfig;
