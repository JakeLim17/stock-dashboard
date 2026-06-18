// 로딩 단계 문구 SSOT — LoadingScreen · SkeletonStageBanner 공유.
// 타이밍·간격은 각 컴포넌트에서 그대로 유지 (여기는 문자열만).

export const LOADING_STAGES_FULL = [
  "시장 지표 받는 중...",
  "관심 종목 시세 수집 중...",
  "수급(외인·기관) 분석 중...",
  "컨센서스 정리 중...",
  "뉴스 수집 중...",
  "예측·차트 계산 중...",
  "마무리 중...",
] as const;

export const LOADING_STAGES_LITE = [
  "시장 지표 받는 중...",
  "관심 종목 시세 수집 중...",
  "카드 표시 준비 중...",
] as const;

export const LOADING_FOOTER_FULL =
  "첫 진입은 데이터 수집으로 수초 ~ 수분 걸릴 수 있어요. 이후엔 자동 갱신됩니다.";

export const LOADING_FOOTER_LITE =
  "시세·카드를 먼저 보여 드리고, 예측·추천·뉴스는 뒤에서 채웁니다.";

export const LOADING_WAIT_HINT =
  "데이터를 모두 받을 때까지 잠시만 기다려주세요.";
