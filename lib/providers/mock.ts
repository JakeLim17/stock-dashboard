import "server-only";
import type { FlowData } from "../types";

// KIS 비활성 상태일 때 외인/기관 수급을 그럴듯하게 보여주기 위한 결정론적 mock.
// 같은 종목+같은 분(分)이면 같은 값을 반환 → 화면 튐 없음.
export function mockFlow(code: string): FlowData {
  const seedBase = hashCode(code) + Math.floor(Date.now() / (1000 * 60 * 10)); // 10분마다 변화
  const r1 = pseudo(seedBase * 17 + 3);
  const r2 = pseudo(seedBase * 29 + 7);
  const r3 = pseudo(seedBase * 41 + 11);
  const r4 = pseudo(seedBase * 53 + 13);

  // 단위: 원. 대략 -500억 ~ +500억 범위
  const scale = 5e10;
  const foreignNet = Math.round((r1 - 0.5) * scale);
  const institutionNet = Math.round((r2 - 0.5) * scale);
  const foreignNet5d = Math.round((r3 - 0.5) * scale * 3);
  const institutionNet5d = Math.round((r4 - 0.5) * scale * 3);
  // 실제 시장과 비슷하게 개인은 외인+기관의 반대 흐름으로 근사.
  return {
    foreignNet,
    institutionNet,
    individualNet: -(foreignNet + institutionNet),
    foreignNet5d,
    institutionNet5d,
    individualNet5d: -(foreignNet5d + institutionNet5d),
    source: "mock",
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// LCG
function pseudo(seed: number): number {
  let x = seed >>> 0;
  x = (1664525 * x + 1013904223) >>> 0;
  return x / 0xffffffff;
}
