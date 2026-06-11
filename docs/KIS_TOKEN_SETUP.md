# KIS 토큰 cross-instance 캐시 셋업

> KIS(한국투자증권) Open API 토큰을 Vercel serverless 인스턴스 간 공유해서
> **카톡 알림 폭주(=토큰 1일 1회 정책 위반)**를 막는 가이드.

## 왜 필요한가

- Vercel serverless 는 lambda 인스턴스가 cold start 마다 새로 뜨고, `node_modules/.cache`
  같은 디스크 경로는 read-only 다.
- 결과: 이전 코드의 디스크 토큰 캐시(`node_modules/.cache/kis-token.json`)가 **무용지물**.
- lambda 가 새로 뜰 때마다 토큰을 신규 발급 → KIS 가 "토큰 발급 알림" 카톡을 보냄.
- KIS 정책상 **토큰 신규 발급은 1일 1회만 권장**. 폭주 시 키 정지 위험.

## 해결 — 우선순위 3단 폴백

코드(`lib/providers/kis.ts`)는 아래 순서로 토큰을 읽고 쓴다.

1. **Vercel KV (= Upstash Redis)** — cross-instance 공유. 모든 인스턴스가 같은 토큰 1개를 본다.
2. **`/tmp/kis-token.json`** — 같은 인스턴스 내 warm reuse (인스턴스 격리됨).
3. **메모리 캐시** — 같은 lambda 인스턴스 안에서만 유효.

**1번이 활성화되면 24시간에 토큰 1번만 발급되어 카톡 알림이 1일 1회로 안정화**된다.

## 옵션 A — Vercel KV (강력 권장)

### 1) Vercel 대시보드에서 KV/Upstash 데이터베이스 생성

1. 브라우저로 이동:
   - https://vercel.com/jakes-projects-173d47d3/stock-dashboard/stores
2. 우측 상단 **`Create Database`** 클릭
3. 목록에서 **`Upstash`** (또는 `KV` 이름이 보이면 그쪽) 선택
4. 이름은 자유 (예: `kis-token-store`), 리전은 가까운 곳 (예: `Seoul ap-northeast-2`)
5. **`Create`** 클릭
6. 생성 완료 화면에서 **`Connect Project`** 클릭 → `stock-dashboard` 선택 → `Production`, `Preview`, `Development` 환경 모두 체크 → `Connect`

### 2) 환경 변수 자동 주입 확인

위 단계가 끝나면 Vercel 프로젝트에 다음 env 가 자동으로 들어간다.

- `KV_REST_API_URL` 또는 `UPSTASH_REDIS_REST_URL`
- `KV_REST_API_TOKEN` 또는 `UPSTASH_REDIS_REST_TOKEN`

(둘 다 동일한 Upstash REST 엔드포인트. 코드는 둘 중 하나만 있어도 동작.)

### 3) Redeploy 1회

- Vercel 대시보드 → `Deployments` → 가장 최근 빌드 옆 **`···` → `Redeploy`**.
- 새 인스턴스가 KV 를 보면서 뜨고, 첫 KIS 호출 시 토큰을 발급해 KV 에 저장.
- 이후 다른 인스턴스도 cold start 시 KV 의 같은 토큰을 읽어 재발급 안 함.

### 4) 검증

Vercel `Functions Logs` 에서 다음 한 줄이 **하루에 1번만** 보이면 성공:

```
[kis] requesting new token (reason=no-cache (cold start), fingerprint=ABCD1234:32, kvConfigured=true)
```

`kvConfigured=true` 가 핵심. `false` 면 env 변수가 안 들어간 것 — 1)~3) 다시 확인.

---

## 옵션 B — `/tmp` 만 사용 (KV 도입 못 할 때 임시)

`KV_REST_API_*` env 가 없으면 자동으로 `/tmp/kis-token.json` 만 사용.

- 장점: 추가 비용/셋업 없음. 같은 lambda 인스턴스가 warm 상태로 유지되는 동안은 재사용.
- 단점: **인스턴스 격리** — 다른 lambda 가 뜨면 거기서는 토큰을 다시 발급해야 한다.
  Vercel 트래픽이 분산되면 cold start 가 잦아 카톡 알림이 여전히 여러 번 올 수 있다.

→ 가능하면 옵션 A 로 가는 것이 안전.

---

## 토큰 발급 cooldown (`KIS_TOKEN_COOLDOWN_MS`)

KIS 가 `EGW00133 (1분당 1회)` 차단을 내리면, 본 코드가 추가 발급 시도를 막는 cooldown 을 건다.

- **기본: 300_000 ms (5분)** — 카톡 폭주 방지 목적으로 보수적.
- 환경에 맞게 조정 가능: `KIS_TOKEN_COOLDOWN_MS=60000` 처럼 ms 로 지정.
- cooldown 중에는 KIS 호출이 즉시 throw → 호출자는 자동으로 Naver/Yahoo 폴백.

---

## 트러블슈팅

### 1) KV 연결했는데 여전히 카톡이 자주 옴

- Vercel `Functions Logs` 에서 `[kis] requesting new token` 줄을 찾아 빈도 확인.
- `kvConfigured=false` 면 env 가 안 들어온 것. Vercel 프로젝트의 **Settings → Environment Variables** 에서 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 존재 확인.
- env 추가 후엔 반드시 **Redeploy** 한 번 해야 새 인스턴스가 env 를 읽는다.

### 2) `EGW00133` 가 계속 뜸

- 키가 다른 환경(로컬 + 프로덕션)에서 동시에 토큰 발급 시도 중일 수 있음.
- 로컬 개발 시에도 같은 키를 쓰면 카운트 됨 → **로컬은 별도 모의투자 키 사용 권장**.
- `KIS_TOKEN_COOLDOWN_MS` 를 더 길게(예: `600000` = 10분) 두면 폴링 무력화 시간이 늘지만 카톡은 줄어듦.

### 3) KV 비용

- Upstash 무료 티어로 충분 (토큰 1개만 저장, 하루 READ ~수천 회 미만).
- 별도 결제 카드 등록 안 해도 사용 가능.

---

## 참고

- 코드 위치: `lib/providers/kis.ts` — `loadTokenFromStore` / `saveTokenToStore` / `kvGet` / `kvSet`
- env 정의: `.env.example`
- 폴백 순서는 위 코드 주석에 명시되어 있다.

---

# KIS WebSocket 실시간 (Phase 1·3 — 가격 / 거래량·거래대금 / 호가)

> 토스 증권 수준의 실시간성을 위해 KIS WebSocket 채널을 다중 구독해 SSE 로 클라이언트까지
> 흘려보낸다. **기본 OFF**. feature flag(`NEXT_PUBLIC_REALTIME_ENABLED=true`) 일 때만 작동.

## 토스 수준 매핑

| 항목 | 출처 | 구현 단계 | 상태 |
|------|------|----------|------|
| 현재가 (체결가 tick) | KIS WS `H0STCNT0` | Phase 1 | ✅ |
| 누적 거래량/거래대금 | KIS WS `H0STCNT0` (같은 메시지의 13·14 필드) | Phase 3 | ✅ |
| 10단계 호가/잔량 | KIS WS `H0STASP0` | Phase 3 | ✅ |
| 체결강도 | REST `inquire-asking-price` (호가 stitched) | — | REST 폴링 유지 |
| 최근 체결 리스트 | REST `inquire-time-itemconclusion` | — | REST 폴링 유지 |

## 흐름 1줄

브라우저 ─SSE EventSource→ `/api/realtime/stream?symbols=...&topics=price,trade,asp`
─KIS WS (H0STCNT0 + H0STASP0)→ KIS
(서버가 PIPE 메시지를 `event: price|trade|asp\ndata: {...}` 로 분기해 push.)

## 활성화

1. Vercel 환경변수 추가:
   - `NEXT_PUBLIC_REALTIME_ENABLED=true` (Production/Preview 양쪽 권장)
   - `KIS_WS_URL=wss://ops.koreainvestment.com:21000/tryitout` (실전 기본값. 모의는 :31000)
2. **Redeploy** 한 번 — `NEXT_PUBLIC_*` 는 클라이언트 빌드에 박혀야 active.
3. 브라우저에서:
   - 카드 → 한국 종목 현재가·거래량·거래대금이 SSE tick 마다 즉시 갱신
   - 디테일 패널 "호가" 탭 → 10단계 호가/잔량이 tick 단위로 즉시 갱신 (라벨 `KIS-WS · 방금 갱신`)

## 비활성화 (기본)

- `NEXT_PUBLIC_REALTIME_ENABLED` 가 `true` 가 아니면 `EventSource` 자체를 안 만든다.
- 모든 카드/패널은 기존 5초·1.5초 REST polling 으로 동작 — **회귀 0**.

## approval_key 발급 정책

- KIS WebSocket 은 REST 토큰과 **별도의 approval_key** 필요 (`POST /oauth2/Approval`).
- approval_key 는 발급 후 24시간 유효 — `lib/providers/kisApproval.ts` 가 토큰과 동일하게 KV → /tmp → 메모리 3단 폴백 캐시.
- 발급 빈도 추적: Vercel `Functions Logs` 에 `[kis-ws] requesting new approval_key (...)` 한 줄.
  - 정상이면 하루 1회만 보여야 함. 자주 뜨면 KV 미연결 가능성 — 위 옵션 A 셋업 재확인.

## Vercel 런타임 / 타임아웃

- `/api/realtime/stream/route.ts` 는 **Node.js runtime**. Edge 는 outbound WebSocket 미지원.
- `maxDuration = 60` 으로 Hobby 플랜 호환. Pro 면 코드에서 `60 → 250` 으로 올려 한 connection 을 더 오래 유지 가능.
- 서버는 timeout 직전(`maxDuration - 10s`)에 `event: reconnect` 을 보내고 우아하게 종료.
  클라이언트(`hooks/useRealtime.ts`)가 200ms 안에 즉시 새 연결 → 사용자 체감 downtime 거의 0.

## 제약 / 트러블슈팅

- **한국 6자리 코드 종목만 구독.** 미국/지수는 KIS 국내주식 WS 미지원 — 기존 polling 유지.
- **동시 구독 최대 41건** (KIS 측 한도, `tr_id × tr_key` 조합 기준).
  - 현재: 가시 카드 6개 × H0STCNT0(1) + 선택 종목 1개 × H0STASP0(1) = **약 7건**. 여유 충분.
  - 라우트가 한도 초과 시 자동으로 종목 수를 절삭.
- 정규장(09:00–15:30 KST) 외에는 tick 이 거의 0 — 시간외/마감 시 자동으로 기존 snapshot 사용.
- 60초 신선도 가드: 마지막 tick 이 60초 이상 지나면 override 무시 → polling 값으로 fallback.
- SSE 가 오류로 닫히면 1s→2s→4s…30s backoff 로 자동 재접속.
- React render 폭주 방지: 토픽별로 200ms 단위 batch flush (`THROTTLE_MS`).

## H0STASP0 호가 stitching 정책

- KIS H0STASP0 메시지에는 **체결강도(ccldStrength)** 가 없다.
- AskingPricePanel 은 WS asp 데이터(10단계 호가/잔량) + REST `inquire-asking-price` 의 ccldStrength 를
  stitch 해서 표시. 둘 중 하나라도 살아 있으면 패널 정상 노출.
- WS 끊김 → REST polling 그대로 → 깜빡임 fix(직전 데이터 유지 + 3회 연속 실패 후 empty) 작동.

## 코드 위치

- `lib/providers/kisApproval.ts` — approval_key 발급/캐시 (REST 토큰과 별도)
- `app/api/realtime/stream/route.ts` — Node.js SSE 엔드포인트
  - `topics` 파라미터 파싱 (price/trade/asp)
  - H0STCNT0 한 구독 → price + trade 양쪽 SSE 이벤트로 분기 (KIS 한도 절약)
  - H0STASP0 별도 구독 → asp 이벤트
- `hooks/useRealtime.ts` — `useRealtime(symbols, topics)` → `{ prices, trades, asps, status }`
- `components/StockCard.tsx` — `priceOverride` + `tradeOverride` prop
- `components/StockFundamentalsBlock.tsx` — `tradeOverride` 받아 거래량/거래대금 Row 실시간 갱신
- `components/AskingPricePanel.tsx` — `aspOverride` prop, ccldStrength 는 REST 값 stitch
- `components/StockDetailPanel.tsx`, `MobileDetailSheet.tsx` — `aspOverride` forwarding
- `components/DashboardClient.tsx` — `useRealtime` 2회 호출 (카드용 price/trade + 선택 종목용 asp)
