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
