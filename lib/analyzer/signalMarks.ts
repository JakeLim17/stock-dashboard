import type { FlowData, Quote, SignalMark } from "../types";
import type { HistoricalPoint } from "../providers/yahoo";

// 시그널 마크 평가 — 종목 카드 헤더에 한눈에 보이는 작은 배지를 만들기 위한 룰.
// verdict / 점수와는 독립적이며, 데이터가 부족하면 해당 마크는 스킵한다.
//
// 동시 노출 최대치는 호출 측에서 priority 정렬 + slice 로 컷한다.
//
// 입력:
//   quote   : 오늘 시세 (현재가, 거래량 등)
//   history : 일봉 시계열 (오래된 → 최신 순). 보통 90일치를 받는다.
//   flow    : 외인/기관/개인 수급 (당일 + 5일 누적)
export interface SignalMarkInput {
  quote: Quote;
  history: HistoricalPoint[];
  flow?: FlowData | null;
}

export function evaluateSignalMarks(input: SignalMarkInput): SignalMark[] {
  const { quote, history, flow } = input;
  const marks: SignalMark[] = [];

  // 데이터가 거의 없으면 — 가격 기반 마크는 모두 스킵.
  // 수급(flow) 기반 마크는 history 없어도 평가 가능하므로 아래 별도 분기.
  if (history.length >= 5 && quote.price > 0) {
    // ─── 52주(또는 보유 기간 중) 신고가/신저가 ────────────────────────────
    // history 길이가 짧으면 그 기간 안 최고가/최저가로 자동 폴백.
    // Tolerance ε(0.999)로 "오늘 = 직전 최고/최저"의 부동소수 미세 차이를 흡수.
    const lookback = Math.min(252, history.length);
    const window = history.slice(-lookback);
    const highMax = Math.max(...window.map((h) => h.high));
    const lowMin = Math.min(...window.map((h) => h.low));
    if (highMax > 0 && quote.price >= highMax * 0.999) {
      marks.push({
        key: "new_52w_high",
        emoji: "🚀",
        label: lookback >= 252 ? "52주 신고가" : `${lookback}일 신고가`,
        tone: "good",
        detail: `현재가 ${formatNumber(quote.price)} ≥ 최근 ${lookback}일 최고가 ${formatNumber(highMax)}`,
        priority: 1,
      });
    } else if (lowMin > 0 && quote.price <= lowMin * 1.001) {
      // 신고/신저는 동시에 성립 못 하니 else if. (드문 동률 케이스에선 신고가가 우선)
      marks.push({
        key: "new_52w_low",
        emoji: "⛔",
        label: lookback >= 252 ? "52주 신저가" : `${lookback}일 신저가`,
        tone: "bad",
        detail: `현재가 ${formatNumber(quote.price)} ≤ 최근 ${lookback}일 최저가 ${formatNumber(lowMin)}`,
        priority: 1,
      });
    }

    // ─── N일 연속 상승/하락 ────────────────────────────────────────────────
    // 이미 종료된 일봉만 보는 게 아니라 오늘 시세도 같이 본다.
    // history 마지막 봉이 "오늘 봉"인지 모르는 경우가 있어 최신 봉 close가
    // quote.price와 거의 같으면 같은 날로 간주, 아니면 quote.price를 한 칸 더해 비교.
    const closes = history.map((h) => h.close);
    const lastBarClose = closes[closes.length - 1];
    const sameDay =
      lastBarClose > 0 &&
      Math.abs(quote.price - lastBarClose) / lastBarClose < 0.005;
    const series: number[] = sameDay
      ? closes
      : [...closes, quote.price];
    const upStreak = countConsecutive(series, +1);
    const downStreak = countConsecutive(series, -1);
    if (upStreak >= 3) {
      marks.push({
        key: "up_streak",
        emoji: "🔥",
        label: `${upStreak}일 연속 상승`,
        tone: "good",
        detail: `직전 ${upStreak}거래일 매일 상승 — 추세 강세`,
        priority: upStreak >= 5 ? 2 : 3,
      });
    } else if (downStreak >= 3) {
      marks.push({
        key: "down_streak",
        emoji: "❄",
        label: `${downStreak}일 연속 하락`,
        tone: "bad",
        detail: `직전 ${downStreak}거래일 매일 하락 — 추세 약세`,
        priority: downStreak >= 5 ? 2 : 3,
      });
    }

    // ─── 거래량 폭발 ────────────────────────────────────────────────────────
    // 오늘 거래량 / 직전 20거래일 평균 ≥ 2.0 일 때만.
    // history 마지막 봉이 오늘 봉이면 그 봉 빼고 직전 20일을 본다 (자기 자신과 비교 방지).
    if (quote.volume != null && quote.volume > 0 && history.length >= 21) {
      const past = sameDay
        ? history.slice(-21, -1)
        : history.slice(-20);
      if (past.length >= 10) {
        const avg = past.reduce((a, b) => a + b.volume, 0) / past.length;
        if (avg > 0) {
          const ratio = quote.volume / avg;
          if (ratio >= 2.0) {
            marks.push({
              key: "volume_burst",
              emoji: "⚡",
              label: `거래량 ${ratio.toFixed(1)}배`,
              tone: "warn",
              detail: `20일 평균 대비 ${ratio.toFixed(1)}배 — 큰 손 진입/이탈 의심`,
              priority: ratio >= 3 ? 2 : 4,
            });
          }
        }
      }
    }
  }

  // ─── 외인픽 ──────────────────────────────────────────────────────────────
  // foreignNet5d > 0 + 양수 절댓값이 의미 있는 수준일 때만.
  // 일자별 누적이 없는 환경에선 5일 누적 양수만으로 보수적으로 평가한다.
  // 임계: 5일 누적 ≥ +50억원 (SK하이닉스/삼성전자 같은 대형주 기준 의미 있는 수준).
  if (flow && flow.foreignNet5d != null && flow.foreignNet5d >= 5_000_000_000) {
    const eok = Math.round(flow.foreignNet5d / 1e8);
    marks.push({
      key: "foreign_pick",
      emoji: "🌏",
      label: "외인픽",
      tone: "good",
      detail: `외국인 5일 누적 +${eok.toLocaleString("ko-KR")}억 — 지속 순매수`,
      priority: 3,
    });
  }

  // ─── 개미무덤 ────────────────────────────────────────────────────────────
  // 오늘 개인만 사고 외인·기관 둘 다 던지는 전형적 약세 시그널.
  // foreignNet, institutionNet, individualNet 셋이 모두 채워졌을 때만 평가.
  if (
    flow &&
    flow.individualNet != null &&
    flow.foreignNet != null &&
    flow.institutionNet != null &&
    flow.individualNet > 0 &&
    flow.foreignNet < 0 &&
    flow.institutionNet < 0
  ) {
    marks.push({
      key: "ant_grave",
      emoji: "🪦",
      label: "개미무덤",
      tone: "bad",
      detail: "오늘 외인·기관 동반 매도, 개인만 매수 — 단기 약세 우려",
      priority: 1,
    });
  }

  return marks;
}

// 시계열 끝에서부터 dir(+1: 상승, -1: 하락) 방향으로 연속 일수를 센다.
// series[i] vs series[i-1] 비교 — 첫 봉은 비교 불가라 0부터.
function countConsecutive(series: number[], dir: 1 | -1): number {
  let n = 0;
  for (let i = series.length - 1; i > 0; i--) {
    const diff = series[i] - series[i - 1];
    if (dir > 0 ? diff > 0 : diff < 0) n++;
    else break;
  }
  return n;
}

function formatNumber(v: number): string {
  return v.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

// 노출 우선순위 정렬 + 컷. 헤더 공간이 좁아 기본 4개로 자른다.
export function pickTopSignalMarks(
  marks: SignalMark[],
  max = 4
): SignalMark[] {
  const sorted = [...marks].sort((a, b) => {
    const pa = a.priority ?? 99;
    const pb = b.priority ?? 99;
    return pa - pb;
  });
  return sorted.slice(0, max);
}
