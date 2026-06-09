import type { EventItem, EventKind } from "../types";

// 이벤트 기반 변동성 부풀림 계수.
// 실적·FOMC·옵션 만기·배당은 D-day 근처에서 변동성이 평소보다 커진다.
// 표본 표준편차/EWMA σ 만으론 평상시 변동성만 반영되므로, 임박 이벤트가 있으면 σ에 곱해 부풀린다.
//
// 모델: inflation = 1 + maxAlpha · proximity
//   proximity = 1 (D-0) → 윈도우 끝에서 0 으로 선형 감쇠
//   윈도우(before D-N ~ after D+N) 밖이면 부풀림 없음 (factor=1).
// 가장 임팩트 큰 단일 이벤트의 factor 만 적용 (사람 직관: "다음 이벤트 한 개만 신경 씀").

interface EventConfig {
  // D-day 기준 며칠 전부터 윈도우 시작
  before: number;
  // D-day 기준 며칠 뒤까지 윈도우 유지
  after: number;
  // D-0 일 때 추가 부풀림 (factor = 1 + maxAlpha). 예: earnings=1.0 → ×2.0
  maxAlpha: number;
  // UI 라벨용 짧은 한국어 이름
  shortLabel: string;
}

const EVENT_CONFIG: Record<EventKind, EventConfig> = {
  earnings: { before: 3, after: 1, maxAlpha: 1.0, shortLabel: "실적" },
  fomc: { before: 2, after: 1, maxAlpha: 0.5, shortLabel: "FOMC" },
  kospi_expiry: {
    before: 1,
    after: 0,
    maxAlpha: 0.15,
    shortLabel: "옵션만기",
  },
  dividend: { before: 1, after: 1, maxAlpha: 0.05, shortLabel: "배당락" },
  // 휴장은 σ 부풀림 영향 미미 — 단순 정보 노출만 하고 σ는 그대로.
  holiday: { before: 0, after: 0, maxAlpha: 0, shortLabel: "휴장" },
};

function singleEventFactor(event: EventItem, today: number): number {
  const cfg = EVENT_CONFIG[event.kind];
  if (!cfg || cfg.maxAlpha <= 0) return 1;
  const days = (event.date - today) / 86_400_000; // 양수: 미래, 음수: 과거
  if (days > cfg.before || days < -cfg.after) return 1;
  // proximity: D-0 = 1, 윈도우 끝 = 0. 양수 영역(미래)은 before, 음수 영역(과거)은 after.
  const windowSize = days >= 0 ? cfg.before : cfg.after;
  const proximity = windowSize > 0 ? 1 - Math.abs(days) / windowSize : 1;
  return 1 + cfg.maxAlpha * Math.max(0, proximity);
}

export interface EventInflationResult {
  factor: number; // 1 이면 부풀림 없음
  event: EventItem | null;
  daysToEvent: number | null; // 양수: 미래 D-N, 음수: 과거 D+N
  shortLabel: string | null; // "실적", "FOMC" 등 — UI 배지에 사용
}

// 종목 + 매크로 이벤트 중 가장 큰 부풀림을 적용하는 단일 이벤트를 골라 factor 반환.
// 두 이벤트가 동시에 임박해도 가산하지 않음 (모델 단순화 + 과부풀림 방지).
export function computeEventInflation(
  events: EventItem[] | undefined | null,
  today: number = Date.now()
): EventInflationResult {
  const base: EventInflationResult = {
    factor: 1,
    event: null,
    daysToEvent: null,
    shortLabel: null,
  };
  if (!events || events.length === 0) return base;

  let best = base;
  for (const e of events) {
    const f = singleEventFactor(e, today);
    if (f > best.factor) {
      const cfg = EVENT_CONFIG[e.kind];
      best = {
        factor: f,
        event: e,
        daysToEvent: Math.round((e.date - today) / 86_400_000),
        shortLabel: cfg?.shortLabel ?? null,
      };
    }
  }
  return best;
}
