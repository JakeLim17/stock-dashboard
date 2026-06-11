# ─────────────────────────────────────────────────────────────────
# stock-dashboard relay 컨테이너
#
# 빌드:   docker build -t stock-dashboard-relay .
# 실행:   docker run -d --name relay \
#           --restart unless-stopped \
#           -p 8787:8787 \
#           --env-file .env.local \
#           stock-dashboard-relay
# ─────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# 의존성만 먼저 복사 → 캐시 활용
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# 앱 본체
COPY server.js ./

# 한국 표준시(KST) — KIS 영업시간 로그 일치
ENV TZ=Asia/Seoul

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

# 단순 healthcheck — /healthz JSON 응답 확인
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz | grep -q '"ok":true' || exit 1

# tini 없이도 SIGTERM 핸들러로 graceful shutdown
CMD ["node", "server.js"]
