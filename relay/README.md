# stock-dashboard relay 서버

Vercel 함수가 한국 외 리전(sin1/hnd1 등)에서 KIS WebSocket
(`wss://ops.koreainvestment.com:21000`) 에 연결하면 handshake 직후 **1006 으로 즉시 끊긴다**.
KIS 가 한국 외 IP 를 차단하는 것으로 추정. 이를 우회하려고 **한국 IP 호스트**에 이 서버를
띄워서 SSE proxy 구조로 만든다.

```
[Browser EventSource]
   │
   ▼
[Vercel /api/realtime/stream]   ← cookie 인증
   │  fetch streaming (x-relay-secret 헤더)
   ▼
[이 서버 /sse?symbols=...&topics=...]
   │  WebSocket
   ▼
[KIS wss://ops.koreainvestment.com:21000]
```

클라이언트가 받는 SSE 이벤트 스키마(`price` / `trade` / `asp` / `open` / `closed` / `warn` / `error` / `reconnect`)는
기존 Vercel 라우트와 **100% 동일**하므로 프런트 코드는 변경 불필요.

---

## 1. 환경변수

`.env.example` 참고. 반드시 채워야 하는 항목:

| 변수 | 설명 |
|------|------|
| `KIS_APP_KEY`, `KIS_APP_SECRET` | 한국투자증권 Open API 키 — Vercel 과 동일 값 사용 |
| `KIS_BASE_URL` | 실전 `https://openapi.koreainvestment.com:9443`, 모의 `https://openapivts.koreainvestment.com:29443` |
| `RELAY_SHARED_SECRET` | Vercel ↔ relay 간 공유 비밀. `openssl rand -hex 32` |
| `PORT` | 기본 `8787` |

> ⚠ `KIS_USE_MOCK=1` 이면 자동으로 모의(VTS) 엔드포인트 사용.

---

## 2. 배포 시나리오

### 2-1. Oracle Cloud Seoul (Always Free) — 권장

가장 안정적이고 무료(영구). Ampere A1 인스턴스(1 OCPU/6GB) 또는 AMD VM.Standard.E2.1.Micro
(1 OCPU/1GB) 둘 다 충분.

```bash
# 1) Compute → Create Instance, Region = Seoul, Image = Ubuntu 22.04
# 2) Networking → 8787 인바운드 허용 (Security List + Subnet)

# 3) VM 접속 후
sudo apt update && sudo apt install -y nodejs npm git
git clone <stock-dashboard repo> ~/sd
cd ~/sd/relay
npm install --omit=dev

cp .env.example .env.local
nano .env.local   # KIS_APP_KEY/SECRET/RELAY_SHARED_SECRET 채우기

# 4) PM2 로 데몬화
sudo npm i -g pm2
pm2 start server.js --name sd-relay --update-env
pm2 save
pm2 startup    # 출력 명령 그대로 sudo 실행

# 5) Ubuntu 방화벽
sudo ufw allow 8787/tcp

# 6) 동작 확인
curl http://localhost:8787/healthz
```

도메인·HTTPS 처리는 §3 참고.

### 2-2. Docker (어디에 올리든 동일)

```bash
cd relay
cp .env.example .env.local   # 값 채우기

docker build -t stock-dashboard-relay .
docker run -d --name sd-relay \
  --restart unless-stopped \
  -p 8787:8787 \
  --env-file .env.local \
  stock-dashboard-relay

# 로그 확인
docker logs -f sd-relay
```

### 2-3. 집서버 / Raspberry Pi / Synology NAS

집 인터넷이 한국 통신사면 IP 가 한국이므로 KIS WS 가 정상 연결됨.
가장 쉬운 길은 **Docker** (§2-2). 라즈베리파이는 ARM 이미지가 자동 빌드된다 (`node:20-alpine` 멀티아키).

Synology DSM:
1. Container Manager(or Docker) → 프로젝트 신규
2. `docker-compose.yml` 또는 위 docker run 명령
3. 포트 매핑 `8787:8787`
4. 환경변수 GUI 에 입력 또는 .env 파일 마운트

systemd 로 띄우고 싶으면:

```ini
# /etc/systemd/system/sd-relay.service
[Unit]
Description=stock-dashboard relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/sd/relay
EnvironmentFile=/home/pi/sd/relay/.env.local
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sd-relay
journalctl -fu sd-relay
```

### 2-4. (참고) 무료 한국 호스트 후보

- **Oracle Cloud Seoul Always Free** — 영구 무료, 추천
- **AWS ap-northeast-2 (Seoul) t4g.micro** — Free Tier 12개월
- **NCP / Kakao Cloud** — 무료 크레딧 한시적
- **집서버 / NAS** — 전기료만, IP 가 KT/SK/LG 면 OK

---

## 3. 도메인 & HTTPS — Cloudflare Tunnel 추천(무료, 가장 쉬움)

서버에 공인 IP·고정 도메인이 없어도 Cloudflare 가 무료로 HTTPS 도메인을 발급해 준다.
포트 포워딩·인증서 갱신 신경 안 써도 된다.

1. Cloudflare 대시보드 → 무료 도메인 등록 또는 기존 도메인 추가
2. **Zero Trust → Networks → Tunnels → Create a tunnel** → Cloudflared
3. 호스트(VM/Pi)에서 안내 명령 그대로 실행
   ```bash
   cloudflared service install <token>
   ```
4. Tunnel 의 Public Hostname 추가:
   - Subdomain: `relay`
   - Domain: `your-domain.com`
   - Service: `http://localhost:8787`
5. 완료 → `https://relay.your-domain.com/healthz` 가 바로 동작

Vercel env 에는 이 https 도메인을 넣는다.

### 대안: nginx + Let's Encrypt (Oracle Cloud 등 공인 IP 있는 경우)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/relay
# server { listen 80; server_name relay.your-domain.com;
#   location / { proxy_pass http://127.0.0.1:8787;
#     proxy_http_version 1.1;
#     proxy_set_header Connection ""; proxy_buffering off;
#     proxy_read_timeout 3600s; } }
sudo ln -s /etc/nginx/sites-available/relay /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d relay.your-domain.com
```

`proxy_buffering off` 가 핵심. SSE 가 버퍼링되면 클라이언트가 메시지를 지연해서 받는다.

---

## 4. Vercel 환경변수 추가

[Vercel 대시보드 → Project → Settings → Environment Variables]

| 키 | 값 |
|----|-----|
| `KIS_WS_RELAY_URL` | `https://relay.your-domain.com` (https 권장) |
| `KIS_WS_RELAY_SECRET` | relay 의 `RELAY_SHARED_SECRET` 과 같은 값 |

저장 후 **Redeploy (Build Cache 해제)**.

---

## 5. 동작 확인

### 5-1. relay 단독 테스트 (호스트에서)

```bash
# 헬스체크
curl https://relay.your-domain.com/healthz

# SSE 스트림 (예: 삼성전자)
curl -N -H "x-relay-secret: <secret>" \
  "https://relay.your-domain.com/sse?symbols=005930&topics=price,trade"
# → event: open ... event: price ...
```

### 5-2. Vercel → relay 경로

브라우저 DevTools → Network → `/api/realtime/stream`
- Response 가 `text/event-stream`
- Status 200, 응답이 계속 흘러내림
- `event: price` / `event: trade` 가 평일 장중에 지속적으로 도착

---

## 6. 트러블슈팅

| 증상 | 원인·대응 |
|------|-----------|
| relay 가 `event: closed code=1006` 만 반복 | 호스트 IP 가 한국이 아님. `curl -s ifconfig.me` 로 확인. KT/SK/LG/CloudOracle Seoul 이어야 함 |
| Vercel 함수가 502/504 | relay URL 오타, TLS 인증서 불량(자체 서명 X), Cloudflare Tunnel 미동작 |
| `event: warn rt_cd != 0` | KIS 구독 한도 초과(41 건) 또는 잘못된 종목코드 |
| `approval_key 발급 실패` | KIS_APP_KEY/SECRET 오타, 일일 발급 한도(카톡 알림 옴!), KIS_BASE_URL 오타 |
| 종일 데이터 안 옴 | KIS 영업시간(평일 09:00–15:30 KST) 확인. ETF/우선주는 별도 TR 필요 |

---

## 7. 보안 체크리스트

- [ ] `RELAY_SHARED_SECRET` 32자+ 랜덤
- [ ] `.env.local` 절대 git 커밋 X (`.gitignore` 등록됨)
- [ ] 8787 포트는 Cloudflare Tunnel 만 통하면 외부 공개 안 해도 됨
- [ ] nginx 직접 노출 시 `Access-Control-Allow-Origin` 운영 도메인으로 제한 권장 (현재는 `*`)
- [ ] approval_key 가 로그·SSE 본문에 노출되지 않는지 확인 (현 코드 OK)

---

## 8. 단순화 트레이드오프 (v1)

- **클라이언트당 KIS WS 1개**. 동시 사용자 100명 이상이면 fan-out 멀티플렉서 필요.
- approval_key 캐시는 메모리 + `~/.stock-dashboard-relay-approval.json` (KV 없음).
  단일 인스턴스라 충분.
- 자동 재구독 X — Vercel proxy 가 ws-close 받으면 클라이언트가 재연결.

확장이 필요해지면 본 README §1 의 단순화를 풀고 별도 PR 로 진행한다.
