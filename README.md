# 실시간 주식 대시보드

개인용 실시간 투자 관제 대시보드.
한국 반도체 3대장 (**삼성전자 / SK하이닉스 / 삼성전기**) 을 메인으로,
**나스닥 선물 · SOX · 엔비디아 · 달러원 · VIX** 시장 지표와 뉴스를 한 화면에서 본다.

> 투자 판단 **보조**용 — 자동매매 X. 모든 결과는 사용자 책임.

## 핵심 특징

- **로컬 우선**: SQLite (`better-sqlite3`) 로 모든 데이터 저장. 외부 DB 없음
- **풍부한 데이터, 심플한 화면**: 카드/패널 단위로 정보 분리
- **룰 기반 신호**: `BUY / ADD / HOLD / WATCH / SELL` 5단계 + 과열도·매수우위 점수
- **펀더멘털 보강**: Yahoo `quoteSummary` + 네이버 `integration` 으로 컨센서스 목표주가·애널리스트 분포·PER/PBR/52주·리서치 노트까지 룰과 UI에 정식 반영 (단기 기술 신호만이 아닌 장기 컨센서스도 함께 본다)
- **Provider 패턴**: Yahoo / Naver / KIS / 뉴스 RSS 각각 모듈화 — 나중에 교체 쉬움
- **컨센서스 캐시**: 6시간 메모리 TTL (`lib/providers/consensusCache.ts`). 5~15초 시세 갱신마다 컨센서스를 재호출하지 않아 차단 위험·비용 최소화
- **다크/라이트 토글**, 자동 새로고침(소스/장상태 연동: Yahoo 장중 10초·비장중 120초, KIS 장중 2초·비장중 30초), 빈상태/에러 처리

## 빠른 시작

```bash
npm install
cp .env.example .env.local   # KIS 안 쓰면 그대로 비워둬도 됨
npm run dev
# → http://localhost:9700
```

빌드 / 프로덕션:

```bash
npm run build
npm run start
```

## 환경변수

| 키 | 필수 | 설명 |
|---|---|---|
| `DASHBOARD_PASS` | 권장 | 비밀번호. 설정 시 `/login`에서 1회 입력 후 30일 자동 통과 |
| `KIS_ENABLED` | 선택 | `0`/`false`로 두면 KIS 호출 비활성화. 기본값은 활성 |
| `KIS_INDEX_ENABLED` | 선택 | `1`이면 한국 지수도 KIS로 조회. 기본은 빠른 Yahoo |
| `KIS_HISTORY_ENABLED` | 선택 | `1`이면 일봉 히스토리도 KIS로 조회. 기본은 빠른 Yahoo |
| `KIS_EXTRAS_ENABLED` | 선택 | `1`이면 프로그램매매/공매도 보조 데이터 조회 |
| `KIS_FLOW_ENABLED` | 선택 | `1`이면 외인/기관 수급도 KIS 우선 조회. 기본은 빠른 네이버/mock |
| `KIS_APP_KEY` | 선택 | 한국투자증권 KIS Developers App Key |
| `KIS_APP_SECRET` | 선택 | 동 시크릿 |
| `KIS_BASE_URL` | 선택 | KIS API base URL (실전 / 모의) |

**Vercel 공개 배포에선 `DASHBOARD_PASS` 설정 권장** — 봇 크롤로 인한 함수 호출 폭주를 막아줍니다. 한 번 로그인하면 같은 브라우저에서 30일 동안 비번을 다시 묻지 않습니다.
**KIS 토큰은 발급 시 알림톡/SMS가 올 수 있습니다.** 앱은 토큰을 `data/kis-token.json`에 저장해 만료 전까지 재사용합니다.
문자 폭주 등 장애 대응이 필요할 때만 `KIS_ENABLED=0`으로 끄면, 외인/기관 수급은 네이버 또는 mock data로 표시됩니다.

## 디렉토리 구조

```
stock-dashboard/
├── app/
│   ├── page.tsx              # 서버 컴포넌트, 초기 스냅샷 SSR
│   ├── layout.tsx            # 테마 FOUC 방지 스크립트
│   ├── globals.css           # Tailwind v4 + 토큰
│   └── api/
│       ├── snapshot/         # GET  /api/snapshot  - 전체 스냅샷
│       ├── news/             # GET  /api/news?refresh=1
│       ├── history/          # GET  /api/history?code=...&range=1w|1m|3m
│       └── refresh/          # POST /api/refresh    - 수동 새로고침
├── components/
│   ├── ui/{Card,Badge}.tsx   # 가벼운 자체 UI 키트
│   ├── DashboardClient.tsx   # 전체 조립 + 60s polling
│   ├── SummaryBar.tsx        # 상단 요약 바
│   ├── StockCard.tsx         # 관심종목 카드
│   ├── MarketPanel.tsx       # 시장 신호 패널
│   ├── NewsPanel.tsx         # 호재/악재 필터 + 리스트
│   ├── AnalysisBox.tsx       # 가장 큰 분석 결과 박스
│   ├── PriceChart.tsx        # lightweight-charts
│   └── ThemeToggle.tsx       # 다크/라이트 토글
├── lib/
│   ├── types.ts              # 도메인 타입 (SSOT)
│   ├── symbols.ts            # 종목 메타
│   ├── utils.ts              # 포맷/색상/cn
│   ├── db.ts                 # SQLite 초기화 + 저장/조회
│   ├── snapshot.ts           # 한 번에 전체 스냅샷 만들기
│   ├── providers/
│   │   ├── yahoo.ts          # 시세, historical, SMA/RSI
│   │   ├── kis.ts            # 외인/기관 (stub)
│   │   ├── news.ts           # Google News RSS (한국어+영어)
│   │   ├── mock.ts           # KIS 없을 때 fallback
│   │   └── index.ts          # 통합 export
│   └── analyzer/
│       └── rules.ts          # 룰 기반 점수화 → 신호 결정
└── data/
    └── stock.db              # 자동 생성 (gitignore)
```

## 데이터 흐름

```
[ /api/snapshot ]
       │
       ▼
buildSnapshot()
 ├─ fetchQuotesBatch(MARKET_INDICATORS)   ── 시장 지표 5개
 ├─ Promise.all(PRIMARY_SYMBOLS.map → {
 │    fetchQuote / fetchHistorical / fetchFlowOrMock
 │    computeTech (SMA, RSI, 과열도)
 │    analyze(rules)  → BUY / ADD / HOLD / WATCH / SELL
 │ })
 ├─ fetchAllNews()  → Google News RSS, sentiment 분류
 └─ saveQuote / saveFlow / saveTech / saveAnalysis / saveNews
       │
       ▼
DashboardClient (60s polling)
 ├─ SummaryBar      ── 시간 · 분위기 · 반도체 과열 · 환율 · 뉴스 수
 ├─ AnalysisBox     ── "지금 추격매수 위험" 같은 한 줄 결론
 ├─ PriceChart      ── 1주/1개월/3개월 토글
 ├─ MarketPanel     ── 지표 5종 상승/하락/주의
 ├─ StockCard ×3    ── 가격·등락·수급·기술적·시그널
 └─ NewsPanel       ── 호재/악재 필터
```

## 룰 기반 분석 (요약)

`lib/analyzer/rules.ts` — 베이스 50점에서 룰 적중마다 `heat`(과열·위험) / `buy`(매수우위) 가감산.

대표 룰:
- 오늘 +4% 이상 급등 → heat +25, buy -10
- RSI 75+ → heat +20
- 외인 +500억 순매수 → buy +20
- 미국 반도체(SOX+NVDA) 과열 → heat +10, buy -10
- 환율 급등 → heat +10
- VIX 25+ → heat +15

펀더멘털 룰 (Yahoo + 네이버 컨센서스):
- 컨센서스 평균 대비 +20% 이상 상승여력 → buy +25, heat -10
- 컨센서스 평균 대비 -25% 이상 고평가 → buy -25, heat +10
- 추정 PER < 8 → buy +15 (내년 실적 대비 매우 저렴)
- Strong Buy 25%+, Sell 0 → buy +15
- 매도 의견 20%+ → buy -15

**결정 매트릭스** (정규장):
- `heat≥80 && buy≤35` → **SELL**
- `buy≥68 && heat≤55` → **BUY**
- `buy≥90 && heat≤80` → **ADD** _(강한 매수 근거가 단기 과열을 덮음)_
- `buy≥56 && heat≤62` → **ADD**
- `heat≥65 && buy<60` → **WATCH**
- `buy≤35 && heat≤45` → **WATCH**
- 나머지 → **HOLD**

## 확장 가이드

- **새 종목 추가**: `lib/symbols.ts` 의 `PRIMARY_SYMBOLS` / `MARKET_INDICATORS` 에 한 줄
- **새 데이터 소스**: `lib/providers/<name>.ts` 추가 후 `index.ts` 에 export. UI는 그대로
- **AI 분석 모듈**: `lib/analyzer/` 아래에 `ai.ts` 추가 → `rules.ts` 결과와 합쳐 더 정교한 시그널
- **알림(브라우저/슬랙)**: `DashboardClient` 의 polling 결과를 비교해 변동 시 알림

## Vercel 배포

```bash
# 1) Vercel 대시보드에서 "New Project" → GitHub repo "stock-dashboard" import
# 2) Framework Preset: Next.js (자동 감지)
# 3) Build / Output / Install 기본값 그대로
# 4) Environment Variables (선택)
#    - DASHBOARD_PASS
#    - KIS_ENABLED=0 은 장애 대응용 비활성화 스위치
#    - KIS_APP_KEY / KIS_APP_SECRET / KIS_BASE_URL
# 5) Deploy
```

**Vercel 환경에선 SQLite가 자동으로 `:memory:` 로 전환**됩니다.
- 화면 동작은 동일 (매 요청마다 Yahoo / RSS에서 새로 받아옴)
- DB는 lambda 인스턴스 동안만 유효 (과거 기록 누적은 안 됨)
- 영구 보관이 필요해지면 Vercel KV / Supabase / Turso 등으로 갈아끼우면 됨 (`lib/db.ts` 한 곳만)

## 트러블슈팅

- **better-sqlite3 빌드 실패** → `npm rebuild better-sqlite3`. macOS는 Xcode CLT 필요
- **Yahoo가 일부 종목 null 반환** → 잠시 후 재시도. `errors` 영역에 표시됨
- **뉴스가 비어 있음** → RSS 일시 차단. 네트워크/User-Agent 점검
- **Vercel에서 함수 timeout** → `vercel.json` 의 `maxDuration` 조정 (기본 30초)
