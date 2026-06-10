import type { OverseasNightIndicator, SymbolMeta } from "./types";

// 메인 관심 종목 (기본 카드 3개)
export const PRIMARY_SYMBOLS: SymbolMeta[] = [
  { code: "005930.KS", name: "삼성전자", kind: "kr-stock", primary: true, sector: "반도체" },
  { code: "000660.KS", name: "SK하이닉스", kind: "kr-stock", primary: true, sector: "반도체" },
  { code: "009150.KS", name: "삼성전기", kind: "kr-stock", primary: true, sector: "반도체" },
];

// 화면 최대 표시 가능한 관심종목 수
export const MAX_WATCH = 6;

// 관심종목 후보군 (검색해서 추가, 추천 스크리닝 대상)
// 한국 시총 상위 + 인기 종목 위주. KOSPI=.KS, KOSDAQ=.KQ
// sector 는 추천 패널의 섹터 탭과 시장 컨텍스트 보너스 계산에 사용된다.
// PRIMARY_SYMBOLS (삼전·하닉·삼성전기)는 반도체로 분류.
export const WATCHLIST_CANDIDATES: SymbolMeta[] = [
  // 반도체 (PRIMARY 포함)
  { code: "005930.KS", name: "삼성전자", kind: "kr-stock", primary: true, sector: "반도체", isSectorLeader: true, sectorLeaderLabel: "반도체 대장" },
  { code: "000660.KS", name: "SK하이닉스", kind: "kr-stock", primary: true, sector: "반도체" },
  { code: "009150.KS", name: "삼성전기", kind: "kr-stock", primary: true, sector: "반도체", isSectorLeader: true, sectorLeaderLabel: "MLCC 대장" },
  { code: "042700.KS", name: "한미반도체", kind: "kr-stock", sector: "반도체" },
  // IT가전
  { code: "066570.KS", name: "LG전자", kind: "kr-stock", sector: "IT가전", isSectorLeader: true, sectorLeaderLabel: "가전 대장" },
  // 자동차
  { code: "005380.KS", name: "현대차", kind: "kr-stock", sector: "자동차", isSectorLeader: true, sectorLeaderLabel: "완성차 대장" },
  { code: "000270.KS", name: "기아", kind: "kr-stock", sector: "자동차" },
  { code: "012330.KS", name: "현대모비스", kind: "kr-stock", sector: "자동차" },
  // 2차전지
  { code: "373220.KS", name: "LG에너지솔루션", kind: "kr-stock", sector: "배터리", isSectorLeader: true, sectorLeaderLabel: "배터리 대장" },
  { code: "006400.KS", name: "삼성SDI", kind: "kr-stock", sector: "배터리" },
  { code: "247540.KQ", name: "에코프로비엠", kind: "kr-stock", sector: "배터리" },
  { code: "086520.KQ", name: "에코프로", kind: "kr-stock", sector: "배터리" },
  // 정유·화학 (SK이노는 정유+배터리 복합. 화학으로 단순화)
  { code: "096770.KS", name: "SK이노베이션", kind: "kr-stock", sector: "화학" },
  { code: "051910.KS", name: "LG화학", kind: "kr-stock", sector: "화학" },
  { code: "011170.KS", name: "롯데케미칼", kind: "kr-stock", sector: "화학" },
  // 철강·비철금속
  { code: "005490.KS", name: "POSCO홀딩스", kind: "kr-stock", sector: "철강소재" },
  { code: "010130.KS", name: "고려아연", kind: "kr-stock", sector: "철강소재" },
  // 금융 / 보험 / 인터넷은행
  { code: "105560.KS", name: "KB금융", kind: "kr-stock", sector: "금융" },
  { code: "055550.KS", name: "신한지주", kind: "kr-stock", sector: "금융" },
  { code: "086790.KS", name: "하나금융지주", kind: "kr-stock", sector: "금융" },
  { code: "032830.KS", name: "삼성생명", kind: "kr-stock", sector: "금융" },
  { code: "323410.KS", name: "카카오뱅크", kind: "kr-stock", sector: "금융" },
  // 바이오 / 제약
  { code: "207940.KS", name: "삼성바이오로직스", kind: "kr-stock", sector: "바이오" },
  { code: "068270.KS", name: "셀트리온", kind: "kr-stock", sector: "바이오" },
  { code: "196170.KQ", name: "알테오젠", kind: "kr-stock", sector: "바이오" },
  // 인터넷
  { code: "035420.KS", name: "네이버", kind: "kr-stock", sector: "인터넷", isSectorLeader: true, sectorLeaderLabel: "인터넷 대장" },
  { code: "035720.KS", name: "카카오", kind: "kr-stock", sector: "인터넷" },
  // 게임
  { code: "036570.KS", name: "엔씨소프트", kind: "kr-stock", sector: "게임" },
  { code: "251270.KS", name: "넷마블", kind: "kr-stock", sector: "게임" },
  { code: "293490.KQ", name: "카카오게임즈", kind: "kr-stock", sector: "게임" },
  { code: "259960.KS", name: "크래프톤", kind: "kr-stock", sector: "게임" },
  // 엔터
  { code: "352820.KS", name: "하이브", kind: "kr-stock", sector: "엔터" },
  { code: "041510.KQ", name: "에스엠", kind: "kr-stock", sector: "엔터" },
  // 방산 / 항공우주
  { code: "012450.KS", name: "한화에어로스페이스", kind: "kr-stock", sector: "방산", isSectorLeader: true, sectorLeaderLabel: "방산 대장" },
  { code: "047810.KS", name: "한국항공우주", kind: "kr-stock", sector: "방산", isSectorLeader: true, sectorLeaderLabel: "항우 대장" },
  { code: "064350.KS", name: "현대로템", kind: "kr-stock", sector: "방산" },
  // 조선 / 해운 (HMM은 해운이지만 동일 그룹)
  { code: "329180.KS", name: "HD현대중공업", kind: "kr-stock", sector: "조선" },
  { code: "010140.KS", name: "삼성중공업", kind: "kr-stock", sector: "조선" },
  { code: "042660.KS", name: "한화오션", kind: "kr-stock", sector: "조선" },
  { code: "011200.KS", name: "HMM", kind: "kr-stock", sector: "조선" },
  // 원전 / 전력기기 / 유틸리티
  { code: "034020.KS", name: "두산에너빌리티", kind: "kr-stock", sector: "원전전력", isSectorLeader: true, sectorLeaderLabel: "원전 대장" },
  { code: "267260.KS", name: "HD현대일렉트릭", kind: "kr-stock", sector: "원전전력" },
  { code: "015760.KS", name: "한국전력", kind: "kr-stock", sector: "원전전력" },
  // 통신
  { code: "017670.KS", name: "SK텔레콤", kind: "kr-stock", sector: "통신" },
  // 유통 / 종합상사
  { code: "028260.KS", name: "삼성물산", kind: "kr-stock", sector: "유통종합" },
  // 항공
  { code: "003490.KS", name: "대한항공", kind: "kr-stock", sector: "항공", isSectorLeader: true, sectorLeaderLabel: "항공 대장" },

  // ─── 2026-06 카탈로그 확장 (한국 28종 + 미국 9종) ───────────────────────
  // 로봇
  { code: "454910.KS", name: "두산로보틱스", kind: "kr-stock", sector: "로봇", isSectorLeader: true, sectorLeaderLabel: "로봇 대장" },
  { code: "277810.KQ", name: "레인보우로보틱스", kind: "kr-stock", sector: "로봇" },
  // 반도체 장비
  { code: "403870.KQ", name: "HPSP", kind: "kr-stock", sector: "반도체장비" },
  { code: "240810.KQ", name: "원익IPS", kind: "kr-stock", sector: "반도체장비" },
  { code: "039030.KQ", name: "이오테크닉스", kind: "kr-stock", sector: "반도체장비" },
  // 반도체 소재
  { code: "014680.KS", name: "한솔케미칼", kind: "kr-stock", sector: "반도체소재" },
  { code: "357780.KQ", name: "솔브레인", kind: "kr-stock", sector: "반도체소재" },
  { code: "005290.KQ", name: "동진쎄미켐", kind: "kr-stock", sector: "반도체소재" },
  // 신재생 (풍력·태양광)
  { code: "112610.KS", name: "씨에스윈드", kind: "kr-stock", sector: "신재생", isSectorLeader: true, sectorLeaderLabel: "풍력타워 대장" },
  { code: "009830.KS", name: "한화솔루션", kind: "kr-stock", sector: "신재생" },
  // 수소·연료전지
  { code: "336260.KS", name: "두산퓨얼셀", kind: "kr-stock", sector: "수소" },
  // 의료미용·보톡스
  { code: "145020.KQ", name: "휴젤", kind: "kr-stock", sector: "의료미용", isSectorLeader: true, sectorLeaderLabel: "보톡스 대장" },
  { code: "214150.KQ", name: "클래시스", kind: "kr-stock", sector: "의료미용" },
  { code: "086900.KQ", name: "메디톡스", kind: "kr-stock", sector: "의료미용" },
  // 화장품
  { code: "051900.KS", name: "LG생활건강", kind: "kr-stock", sector: "화장품", isSectorLeader: true, sectorLeaderLabel: "화장품 대장" },
  { code: "090430.KS", name: "아모레퍼시픽", kind: "kr-stock", sector: "화장품" },
  // K-푸드·식음료
  { code: "003230.KS", name: "삼양식품", kind: "kr-stock", sector: "식음료", isSectorLeader: true, sectorLeaderLabel: "K-푸드 대장" },
  { code: "097950.KS", name: "CJ제일제당", kind: "kr-stock", sector: "식음료" },
  { code: "004370.KS", name: "농심", kind: "kr-stock", sector: "식음료" },
  { code: "271560.KS", name: "오리온", kind: "kr-stock", sector: "식음료" },
  // 콘텐츠·미디어
  { code: "253450.KQ", name: "스튜디오드래곤", kind: "kr-stock", sector: "콘텐츠", isSectorLeader: true, sectorLeaderLabel: "콘텐츠 대장" },
  { code: "035760.KQ", name: "CJ ENM", kind: "kr-stock", sector: "콘텐츠" },
  // 여행·레저·카지노
  { code: "008770.KS", name: "호텔신라", kind: "kr-stock", sector: "여행레저", isSectorLeader: true, sectorLeaderLabel: "여행 대장" },
  { code: "035250.KS", name: "강원랜드", kind: "kr-stock", sector: "여행레저" },
  // 유통·리테일
  { code: "139480.KS", name: "이마트", kind: "kr-stock", sector: "유통", isSectorLeader: true, sectorLeaderLabel: "유통 대장" },
  { code: "004170.KS", name: "신세계", kind: "kr-stock", sector: "유통" },
  // 건설
  { code: "000720.KS", name: "현대건설", kind: "kr-stock", sector: "건설", isSectorLeader: true, sectorLeaderLabel: "건설 대장" },
  { code: "006360.KS", name: "GS건설", kind: "kr-stock", sector: "건설" },
  // 디스플레이
  { code: "034220.KS", name: "LG디스플레이", kind: "kr-stock", sector: "디스플레이", isSectorLeader: true, sectorLeaderLabel: "디스플레이 대장" },
  { code: "213420.KQ", name: "덕산네오룩스", kind: "kr-stock", sector: "디스플레이" },
  // 전선·송배전
  { code: "006260.KS", name: "LS", kind: "kr-stock", sector: "전선", isSectorLeader: true, sectorLeaderLabel: "전선 대장" },
  // AI 소프트웨어
  { code: "012510.KS", name: "더존비즈온", kind: "kr-stock", sector: "AI소프트웨어", isSectorLeader: true, sectorLeaderLabel: "AI SW 대장" },
  // 물류·택배
  { code: "000120.KS", name: "CJ대한통운", kind: "kr-stock", sector: "물류", isSectorLeader: true, sectorLeaderLabel: "물류 대장" },

  // ─── 미국 빅테크 (kind: "us-stock") ─────────────────────────────────────
  // 한국식 flow(외인/기관) 데이터는 fetchFlowOrMock에서 자동 mock 처리됨.
  // 야후 quote/chart/quoteSummary로 시세·컨센서스 모두 가능.
  { code: "AAPL", name: "애플", kind: "us-stock", sector: "글로벌IT", isSectorLeader: true, sectorLeaderLabel: "스마트폰 대장", currency: "USD" },
  { code: "MSFT", name: "마이크로소프트", kind: "us-stock", sector: "글로벌IT", isSectorLeader: true, sectorLeaderLabel: "클라우드 대장", currency: "USD" },
  { code: "GOOGL", name: "알파벳", kind: "us-stock", sector: "글로벌IT", isSectorLeader: true, sectorLeaderLabel: "검색 대장", currency: "USD" },
  { code: "META", name: "메타", kind: "us-stock", sector: "글로벌IT", currency: "USD" },
  { code: "AMZN", name: "아마존", kind: "us-stock", sector: "글로벌IT", isSectorLeader: true, sectorLeaderLabel: "이커머스 대장", currency: "USD" },
  { code: "TSLA", name: "테슬라", kind: "us-stock", sector: "글로벌EV", isSectorLeader: true, sectorLeaderLabel: "EV 대장", currency: "USD" },
  { code: "AMD", name: "AMD", kind: "us-stock", sector: "글로벌반도체", currency: "USD" },
  { code: "TSM", name: "TSMC", kind: "us-stock", sector: "글로벌반도체", isSectorLeader: true, sectorLeaderLabel: "파운드리 대장", currency: "USD" },
  { code: "PLTR", name: "팔란티어", kind: "us-stock", sector: "글로벌AI", currency: "USD" },

  // ─── 2026-06 미국 카탈로그 확장 (~23종) ────────────────────────────────────
  // 사용성 우선 — 섹터별 대표주만. sectorLeader는 분야 내 명백한 1위에만.
  //
  // 반도체/AI 인프라 — 기존 글로벌반도체 섹터에 묶음. AVGO를 AI 네트워킹 대장으로.
  { code: "AVGO", name: "브로드컴", kind: "us-stock", sector: "글로벌반도체", isSectorLeader: true, sectorLeaderLabel: "AI 네트워킹 대장", currency: "USD" },
  { code: "QCOM", name: "퀄컴", kind: "us-stock", sector: "글로벌반도체", currency: "USD" },
  { code: "MU", name: "마이크론", kind: "us-stock", sector: "글로벌반도체", isSectorLeader: true, sectorLeaderLabel: "美 메모리 대장", currency: "USD" },
  { code: "ARM", name: "ARM", kind: "us-stock", sector: "글로벌반도체", isSectorLeader: true, sectorLeaderLabel: "모바일 IP 대장", currency: "USD" },
  { code: "MRVL", name: "마벨", kind: "us-stock", sector: "글로벌반도체", currency: "USD" },
  // AI 소프트웨어 / 엔터프라이즈 SW
  { code: "ORCL", name: "오라클", kind: "us-stock", sector: "글로벌소프트웨어", isSectorLeader: true, sectorLeaderLabel: "AI 인프라 SW 대장", currency: "USD" },
  { code: "CRM", name: "세일즈포스", kind: "us-stock", sector: "글로벌소프트웨어", isSectorLeader: true, sectorLeaderLabel: "SaaS 대장", currency: "USD" },
  { code: "NOW", name: "서비스나우", kind: "us-stock", sector: "글로벌소프트웨어", currency: "USD" },
  { code: "ADBE", name: "어도비", kind: "us-stock", sector: "글로벌소프트웨어", currency: "USD" },
  // 헬스케어 메가캡 — LLY(비만치료제 GLP-1 대장), UNH(보험 대장)
  { code: "LLY", name: "일라이릴리", kind: "us-stock", sector: "글로벌헬스케어", isSectorLeader: true, sectorLeaderLabel: "GLP-1 대장", currency: "USD" },
  { code: "UNH", name: "유나이티드헬스", kind: "us-stock", sector: "글로벌헬스케어", isSectorLeader: true, sectorLeaderLabel: "美 보험 대장", currency: "USD" },
  // 핀테크·페이먼트
  { code: "V", name: "비자", kind: "us-stock", sector: "글로벌핀테크", isSectorLeader: true, sectorLeaderLabel: "결제 네트워크 대장", currency: "USD" },
  { code: "MA", name: "마스터카드", kind: "us-stock", sector: "글로벌핀테크", currency: "USD" },
  // 소비/리테일
  { code: "COST", name: "코스트코", kind: "us-stock", sector: "글로벌소비재", isSectorLeader: true, sectorLeaderLabel: "회원제 유통 대장", currency: "USD" },
  { code: "WMT", name: "월마트", kind: "us-stock", sector: "글로벌소비재", isSectorLeader: true, sectorLeaderLabel: "美 대형 유통 대장", currency: "USD" },
  { code: "HD", name: "홈디포", kind: "us-stock", sector: "글로벌소비재", currency: "USD" },
  // 중국 ADR — 미국 ADR로 거래되는 중국 빅테크
  { code: "BABA", name: "알리바바", kind: "us-stock", sector: "중국ADR", isSectorLeader: true, sectorLeaderLabel: "중국 빅테크 대장", currency: "USD" },
  { code: "PDD", name: "PDD홀딩스(테무)", kind: "us-stock", sector: "중국ADR", currency: "USD" },
  // 에너지 — 정유 메가캡
  { code: "XOM", name: "엑손모빌", kind: "us-stock", sector: "글로벌에너지", isSectorLeader: true, sectorLeaderLabel: "글로벌 정유 대장", currency: "USD" },
  { code: "CVX", name: "셰브론", kind: "us-stock", sector: "글로벌에너지", currency: "USD" },
  // 핫 테마 — AI 서버(SMCI), BTC 노출(MSTR), 코인 거래소(COIN)
  { code: "SMCI", name: "슈퍼마이크로", kind: "us-stock", sector: "글로벌반도체", currency: "USD" },
  { code: "MSTR", name: "마이크로스트래티지(BTC)", kind: "us-stock", sector: "글로벌암호화폐", isSectorLeader: true, sectorLeaderLabel: "BTC 노출 대장", currency: "USD" },
  { code: "COIN", name: "코인베이스", kind: "us-stock", sector: "글로벌암호화폐", isSectorLeader: true, sectorLeaderLabel: "美 코인거래소 대장", currency: "USD" },
];

// 시장 지표 패널
// KOSPI/KOSDAQ는 KIS가 활성이면 우선 조회되고 Yahoo 폴백. 라우팅은 providers/index.ts.
export const MARKET_INDICATORS: SymbolMeta[] = [
  { code: "^KS11", name: "코스피", kind: "index" },
  { code: "^KQ11", name: "코스닥", kind: "index" },
  { code: "NQ=F", name: "나스닥 선물", kind: "future" },
  { code: "^SOX", name: "필라델피아 반도체", kind: "index" },
  { code: "NVDA", name: "엔비디아", kind: "us-stock", isSectorLeader: true, sectorLeaderLabel: "AI 반도체 대장" },
  { code: "KRW=X", name: "달러/원", kind: "fx" },
  { code: "^VIX", name: "VIX 변동성", kind: "index" },
];

// ─── 테마 그룹 ────────────────────────────────────────────────────────────
// 섹터(sector)는 분야 1차 분류, 테마(theme)는 시장 narrative 단위 묶음.
// 예: "AI 반도체" 테마에는 반도체 + NVDA(미국)을 묶고, "배터리" 테마에는
// 화학 섹터인 LG화학도 같이 묶는 식.
//
// codes는 WATCHLIST_CANDIDATES 또는 MARKET_INDICATORS에 실제 존재하는 것만 적는다.
// resolveThemes() 가 누락된 코드는 자동으로 제외하고 반환한다.
export type ThemeTag =
  | "ai_semi"
  | "battery"
  | "defense"
  | "auto"
  | "internet_game"
  | "shipping_aviation"
  | "nuclear_power"
  | "biotech"
  | "shipbuilding"
  | "finance"
  // ── 2026-06 카탈로그 확장 ──────────────────────────────
  | "robot"
  | "semi_equipment"
  | "renewable"
  | "medical_aesthetic"
  | "beauty"
  | "k_food"
  | "content_media"
  | "travel_leisure"
  | "retail"
  | "construction"
  | "display"
  | "ai_software"
  | "us_bigtech"
  // ── 2026-06 미국 카탈로그 확장 — 섹터별 그룹 ───────────────
  | "us_semiconductor"
  | "us_software"
  | "us_healthcare"
  | "us_fintech"
  | "us_consumer"
  | "us_china_adr"
  | "us_energy"
  | "us_crypto";

export interface ThemeDefinition {
  id: ThemeTag;
  label: string;
  emoji: string;
  // 짧은 설명 — 헤더 hover/툴팁용
  description?: string;
  codes: string[];
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "ai_semi",
    label: "AI 반도체",
    emoji: "🧠",
    description: "AI 학습·추론용 메모리·로직 반도체",
    codes: ["005930.KS", "000660.KS", "042700.KS", "NVDA"],
  },
  {
    id: "battery",
    label: "배터리",
    emoji: "🔋",
    description: "2차전지 셀·소재",
    codes: [
      "373220.KS",
      "006400.KS",
      "247540.KQ",
      "086520.KQ",
      "051910.KS",
    ],
  },
  {
    id: "defense",
    label: "방산",
    emoji: "🛡️",
    description: "방산·항공우주·지정학 수혜",
    codes: ["012450.KS", "047810.KS", "064350.KS"],
  },
  {
    id: "auto",
    label: "완성차",
    emoji: "🚗",
    description: "현대·기아·부품",
    codes: ["005380.KS", "000270.KS", "012330.KS"],
  },
  {
    id: "internet_game",
    label: "인터넷·게임",
    emoji: "💻",
    description: "플랫폼·콘텐츠 — 나스닥 연동 강함",
    codes: [
      "035420.KS",
      "035720.KS",
      "036570.KS",
      "251270.KS",
      "259960.KS",
      "293490.KQ",
    ],
  },
  {
    id: "shipping_aviation",
    label: "항공·해운",
    emoji: "✈️",
    description: "운임·환율 민감",
    codes: ["003490.KS", "011200.KS"],
  },
  {
    id: "nuclear_power",
    label: "원전·전력",
    emoji: "⚛️",
    description: "원전·송배전·전력기기",
    codes: ["034020.KS", "267260.KS", "015760.KS"],
  },
  {
    id: "biotech",
    label: "바이오",
    emoji: "💊",
    description: "바이오·제약·CDMO",
    codes: ["207940.KS", "068270.KS", "196170.KQ"],
  },
  {
    id: "shipbuilding",
    label: "조선",
    emoji: "⚓",
    description: "선가 사이클 + 친환경 선박",
    codes: ["329180.KS", "010140.KS", "042660.KS"],
  },
  {
    id: "finance",
    label: "금융",
    emoji: "🏦",
    description: "은행·보험·인터넷은행",
    codes: [
      "105560.KS",
      "055550.KS",
      "086790.KS",
      "032830.KS",
      "323410.KS",
    ],
  },
  // ─── 2026-06 카탈로그 확장 테마 ───────────────────────────────────────
  {
    id: "robot",
    label: "로봇",
    emoji: "🤖",
    description: "협동로봇·휴머노이드",
    codes: ["454910.KS", "277810.KQ"],
  },
  {
    id: "semi_equipment",
    label: "반도체 장비·소재",
    emoji: "🔧",
    description: "장비·소재·HBM 후공정",
    codes: [
      "042700.KS",
      "403870.KQ",
      "240810.KQ",
      "039030.KQ",
      "014680.KS",
      "357780.KQ",
      "005290.KQ",
    ],
  },
  {
    id: "renewable",
    label: "신재생·수소",
    emoji: "🌱",
    description: "풍력·태양광·연료전지",
    codes: ["112610.KS", "009830.KS", "336260.KS"],
  },
  {
    id: "medical_aesthetic",
    label: "의료미용",
    emoji: "💉",
    description: "보톡스·미용 의료기기",
    codes: ["145020.KQ", "214150.KQ", "086900.KQ"],
  },
  {
    id: "beauty",
    label: "K-뷰티",
    emoji: "💄",
    description: "화장품·생활용품",
    codes: ["051900.KS", "090430.KS"],
  },
  {
    id: "k_food",
    label: "K-푸드",
    emoji: "🍜",
    description: "글로벌 K-푸드 수출",
    codes: ["003230.KS", "097950.KS", "004370.KS", "271560.KS"],
  },
  {
    id: "content_media",
    label: "콘텐츠·미디어",
    emoji: "🎬",
    description: "드라마·예능·K-팝",
    codes: ["253450.KQ", "035760.KQ", "352820.KS"],
  },
  {
    id: "travel_leisure",
    label: "여행·레저",
    emoji: "🏖️",
    description: "면세·호텔·카지노",
    codes: ["008770.KS", "035250.KS"],
  },
  {
    id: "retail",
    label: "유통",
    emoji: "🛒",
    description: "백화점·대형마트",
    codes: ["139480.KS", "004170.KS"],
  },
  {
    id: "construction",
    label: "건설",
    emoji: "🏗️",
    description: "주택·플랜트·해외수주",
    codes: ["000720.KS", "006360.KS"],
  },
  {
    id: "display",
    label: "디스플레이",
    emoji: "📺",
    description: "OLED·소재",
    codes: ["034220.KS", "213420.KQ"],
  },
  {
    id: "ai_software",
    label: "AI 소프트웨어",
    emoji: "🧮",
    description: "ERP·SaaS·AI 솔루션",
    codes: ["012510.KS"],
  },
  {
    id: "us_bigtech",
    label: "미국 빅테크",
    emoji: "🇺🇸",
    description: "글로벌 시총 상위·AI 인프라",
    codes: [
      "AAPL",
      "MSFT",
      "GOOGL",
      "META",
      "AMZN",
      "TSLA",
      "AMD",
      "TSM",
      "PLTR",
      "NVDA",
    ],
  },
  // ─── 2026-06 미국 카탈로그 확장 테마 ───────────────────────────────────
  {
    id: "us_semiconductor",
    label: "美 반도체·AI 인프라",
    emoji: "🇺🇸",
    description: "NVDA·AMD·AVGO 등 AI 학습·네트워킹 핵심",
    codes: [
      "NVDA",
      "AMD",
      "TSM",
      "AVGO",
      "QCOM",
      "MU",
      "ARM",
      "MRVL",
      "SMCI",
    ],
  },
  {
    id: "us_software",
    label: "美 AI 소프트웨어",
    emoji: "🧮",
    description: "엔터프라이즈 SaaS · AI 인프라 SW",
    codes: ["ORCL", "CRM", "NOW", "ADBE", "PLTR"],
  },
  {
    id: "us_healthcare",
    label: "美 헬스케어",
    emoji: "💊",
    description: "GLP-1 비만치료제 · 의료보험 메가캡",
    codes: ["LLY", "UNH"],
  },
  {
    id: "us_fintech",
    label: "美 핀테크·결제",
    emoji: "💳",
    description: "Visa·Mastercard 글로벌 결제 네트워크",
    codes: ["V", "MA"],
  },
  {
    id: "us_consumer",
    label: "美 소비·리테일",
    emoji: "🛍️",
    description: "Costco·Walmart·홈디포",
    codes: ["COST", "WMT", "HD"],
  },
  {
    id: "us_china_adr",
    label: "중국 ADR",
    emoji: "🇨🇳",
    description: "미국 ADR로 거래되는 중국 빅테크",
    codes: ["BABA", "PDD"],
  },
  {
    id: "us_energy",
    label: "美 에너지",
    emoji: "🛢️",
    description: "엑손·셰브론 정유 메가캡",
    codes: ["XOM", "CVX"],
  },
  {
    id: "us_crypto",
    label: "美 암호화폐 노출",
    emoji: "₿",
    description: "BTC 대량 보유·美 코인거래소",
    codes: ["MSTR", "COIN"],
  },
];

// 테마 정의 + 코드 카탈로그(WATCHLIST + MARKET_INDICATORS)를 매칭해
// 실제 존재하는 종목만 남긴 형태로 반환. 매칭 안 된 테마(전체 codes 0개)는 제외.
export interface ResolvedTheme extends ThemeDefinition {
  members: SymbolMeta[];
}

export function resolveThemes(): ResolvedTheme[] {
  const catalog = new Map<string, SymbolMeta>();
  for (const m of WATCHLIST_CANDIDATES) catalog.set(m.code, m);
  for (const m of MARKET_INDICATORS) {
    if (!catalog.has(m.code)) catalog.set(m.code, m);
  }
  const out: ResolvedTheme[] = [];
  for (const t of THEMES) {
    const members = t.codes
      .map((c) => catalog.get(c))
      .filter((v): v is SymbolMeta => !!v);
    if (members.length > 0) out.push({ ...t, members });
  }
  return out;
}

type OverseasNightProxy = Pick<
  OverseasNightIndicator,
  "baseCode" | "proxyCode" | "name" | "exchange" | "sharesPerReceipt"
>;

// 해외장에서 거래되는 국내 개별주 대체 지표.
// 삼성전기처럼 확인 가능한 GDR/DR 티커가 없는 종목은 매핑하지 않는다.
export const OVERSEAS_NIGHT_PROXIES: OverseasNightProxy[] = [
  {
    baseCode: "005930.KS",
    proxyCode: "SMSN.IL",
    name: "삼성전자 GDR",
    exchange: "London IOB",
    sharesPerReceipt: 25,
  },
  {
    baseCode: "000660.KS",
    proxyCode: "HY9H.F",
    name: "SK하이닉스 GDR",
    exchange: "Frankfurt",
    sharesPerReceipt: 1,
  },
];

export function getOverseasNightProxy(
  code: string
): OverseasNightProxy | null {
  return OVERSEAS_NIGHT_PROXIES.find((p) => p.baseCode === code) ?? null;
}

// 한국 종목 코드를 6자리 숫자로 변환 (KIS API 호환). 예: 005930.KS -> 005930
export function toKisCode(code: string): string | null {
  const m = code.match(/^(\d{6})\.K[SQ]$/);
  return m ? m[1] : null;
}

// 화면용 키 (URL safe)
export function toSlug(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "_");
}

export function resolveWatchSymbols(codes: string[]): SymbolMeta[] {
  const map = new Map(WATCHLIST_CANDIDATES.map((s) => [s.code, s]));
  const uniq = Array.from(new Set(codes))
    .map((c) => map.get(c))
    .filter((v): v is SymbolMeta => !!v)
    .slice(0, MAX_WATCH);
  return uniq.length > 0 ? uniq : PRIMARY_SYMBOLS;
}
