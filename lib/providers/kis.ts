import "server-only";
import type { FlowData } from "../types";
import { toKisCode } from "../symbols";

// KIS Developers (한국투자증권 OpenAPI) provider
// MVP에서는 env 미설정이면 비활성. 추후 KIS 계정 발급 후 채워넣을 자리만 만들어둠.
//
// 필요한 env:
//   KIS_APP_KEY     - 한투 발급 앱 키
//   KIS_APP_SECRET  - 한투 발급 시크릿
//   KIS_BASE_URL    - 실전: https://openapi.koreainvestment.com:9443
//                     모의: https://openapivts.koreainvestment.com:29443

function isEnabled() {
  return !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
}

export function kisEnabled(): boolean {
  return isEnabled();
}

// 외국인 / 기관 순매수. KIS 미설정이면 null 채워서 반환.
// 실제 호출은 추후 구현. 자리만 잡아둔다.
export async function fetchFlow(code: string): Promise<FlowData> {
  if (!isEnabled()) {
    return {
      foreignNet: null,
      institutionNet: null,
      foreignNet5d: null,
      institutionNet5d: null,
      source: undefined,
    };
  }

  const sixDigit = toKisCode(code);
  if (!sixDigit) {
    return { foreignNet: null, institutionNet: null };
  }

  // TODO: KIS OAuth 토큰 발급 + 외인/기관 순매수 시세 조회
  // 엔드포인트 예: /uapi/domestic-stock/v1/quotations/inquire-investor
  // 응답 파싱 후 아래 형식으로 매핑하고 source: "kis"를 채울 것.
  return {
    foreignNet: null,
    institutionNet: null,
    foreignNet5d: null,
    institutionNet5d: null,
  };
}
