import type { EventItem, FlowData, Quote, SignalMark, Valuation } from "../types";
import type { HistoricalPoint } from "../providers/yahoo";

// 시그널 마크 평가 — 종목 카드 헤더에 한눈에 보이는 작은 배지를 만들기 위한 룰.
// verdict / 점수와는 독립적이며, 데이터가 부족하면 해당 마크는 스킵한다.
//
// 동시 노출 최대치는 호출 측에서 priority 정렬 + slice 로 컷한다.
//
// 입력:
//   quote          : 오늘 시세 (현재가, 거래량, 시가 등)
//   history        : 일봉 시계열 (오래된 → 최신 순). 보통 90일치를 받는다.
//   flow           : 외인/기관/개인 수급 (당일 + 5일 누적)
//   valuation      : (옵션) 컨센서스 밸류에이션. 52주 신고가 도전 평가에 사용.
//   upcomingEvents : (옵션) 다가올 가격 이벤트(실적/배당). 어닝 D-N 마크에 사용.
export interface SignalMarkInput {
  quote: Quote;
  history: HistoricalPoint[];
  flow?: FlowData | null;
  valuation?: Valuation | null;
  upcomingEvents?: EventItem[];
}

export function evaluateSignalMarks(input: SignalMarkInput): SignalMark[] {
  const { quote, history, flow, valuation, upcomingEvents } = input;
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

    // ─── 거래량 폭발 / 거래절벽 ────────────────────────────────────────────
    // 오늘 거래량 / 직전 20거래일 평균 — ≥ 2.0 → 폭발, ≤ 0.5 → 절벽.
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
          } else if (ratio <= 0.5) {
            marks.push({
              key: "volume_drought",
              emoji: "🏜",
              label: "거래절벽",
              tone: "neutral",
              detail: `20일 평균 대비 ${(ratio * 100).toFixed(0)}% — 관심 이탈 / 방향성 부재`,
              priority: 5,
            });
          }
        }
      }
    }

    // ─── 신고가 도전 ────────────────────────────────────────────────────────
    // 52주 신고가 직전 (3% 이내)이지만 아직 갱신은 안 된 상태 — 돌파 임박 모멘텀.
    // valuation.week52High 가 우선, 없으면 90일 history 최고가로 폴백.
    const w52High = valuation?.week52High ?? null;
    const ref52 =
      w52High != null && w52High > 0 ? w52High : Math.max(...history.map((h) => h.high));
    if (
      ref52 > 0 &&
      quote.price >= ref52 * 0.97 &&
      quote.price < ref52 * 0.999
    ) {
      const gapPct = ((ref52 - quote.price) / ref52) * 100;
      marks.push({
        key: "near_52w_high",
        emoji: "🎯",
        label: "신고가 도전",
        tone: "good",
        detail: `52주 신고가 ${formatNumber(ref52)} 대비 -${gapPct.toFixed(1)}% — 돌파 임박`,
        priority: 2,
      });
    }

    // ─── 갭상승 / 갭하락 ───────────────────────────────────────────────────
    // 오늘 시가가 전일 종가 대비 ±2% 이상 — 갭 발생.
    // quote.open(Yahoo regularMarketOpen) 가 있을 때만. 한국 종목은 시가가 시간외에
    // 영향을 안 받아 비교적 깨끗.
    if (
      quote.open != null &&
      quote.open > 0 &&
      quote.prevClose > 0
    ) {
      const gap = quote.open / quote.prevClose - 1;
      if (gap >= 0.02) {
        marks.push({
          key: "gap_up",
          emoji: "⏫",
          label: `갭상승 +${(gap * 100).toFixed(1)}%`,
          tone: "good",
          detail: `시가 ${formatNumber(quote.open)} — 전일 종가 대비 +${(gap * 100).toFixed(1)}%`,
          priority: 3,
        });
      } else if (gap <= -0.02) {
        marks.push({
          key: "gap_down",
          emoji: "⏬",
          label: `갭하락 ${(gap * 100).toFixed(1)}%`,
          tone: "bad",
          detail: `시가 ${formatNumber(quote.open)} — 전일 종가 대비 ${(gap * 100).toFixed(1)}%`,
          priority: 3,
        });
      }
    }

    // ─── 장대양봉 / 장대음봉 ────────────────────────────────────────────────
    // 당일 등락률이 ±5% 이상이면 한 봉의 변동이 큰 "장대" 봉.
    // 갭과는 다르게 종일 누적 변동을 본다.
    const pct = quote.changeRate;
    if (pct >= 0.05) {
      marks.push({
        key: "long_bull_candle",
        emoji: "🟥",
        label: "장대양봉",
        tone: "good",
        detail: `당일 +${(pct * 100).toFixed(1)}% — 강한 상승 봉`,
        priority: 2,
      });
    } else if (pct <= -0.05) {
      marks.push({
        key: "long_bear_candle",
        emoji: "🟦",
        label: "장대음봉",
        tone: "bad",
        detail: `당일 ${(pct * 100).toFixed(1)}% — 강한 하락 봉`,
        priority: 2,
      });
    }

    // ─── 반등 시도 ──────────────────────────────────────────────────────────
    // 최근 5거래일 close 기준 -10% 이상 빠진 종목이 당일 +3% 이상 반등.
    // sameDay 보정: history 마지막 봉이 오늘이면 5봉 전 → 오늘 봉 close, 아니면 5봉 전 → quote.price.
    if (history.length >= 6 && quote.price > 0) {
      const anchor = sameDay
        ? closes[closes.length - 6]
        : closes[closes.length - 5];
      if (anchor > 0) {
        const drop = quote.price / anchor - 1;
        if (drop <= -0.1 && pct >= 0.03) {
          marks.push({
            key: "rebound_try",
            emoji: "↩",
            label: "반등 시도",
            tone: "neutral",
            detail: `최근 5거래일 ${(drop * 100).toFixed(1)}% 하락 → 당일 +${(pct * 100).toFixed(1)}% 반등`,
            priority: 3,
          });
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

  // ─── 외인 던지기 ────────────────────────────────────────────────────────
  // foreignNet5d ≤ -3,000억 (3e11) — 5일 누적으로 굵직한 외인 순매도.
  // 외인픽과 상호배타(부호 반대라 동시 성립 불가).
  if (flow && flow.foreignNet5d != null && flow.foreignNet5d <= -3e11) {
    const eok = Math.round(flow.foreignNet5d / 1e8);
    marks.push({
      key: "foreign_dump",
      emoji: "🏃",
      label: "외인 던지기",
      tone: "bad",
      detail: `외국인 5일 누적 ${eok.toLocaleString("ko-KR")}억 — 지속 대규모 매도`,
      priority: 1,
    });
  }

  // ─── 세력 매집 (근사) ────────────────────────────────────────────────────
  // 진짜 룰은 "외인+기관 동반 순매수 5일 연속" 인데 일별 raw 데이터가 없어,
  // 5일 누적이 둘 다 의미 있는 양수(≥ +30억) 인 케이스로 근사 평가한다.
  // 외인픽과 동시에 뜰 수 있고, 그건 의도 — "외인 + 기관" 동반이 핵심 신호.
  if (
    flow &&
    flow.foreignNet5d != null &&
    flow.institutionNet5d != null &&
    flow.foreignNet5d >= 3_000_000_000 &&
    flow.institutionNet5d >= 3_000_000_000
  ) {
    const fEok = Math.round(flow.foreignNet5d / 1e8);
    const iEok = Math.round(flow.institutionNet5d / 1e8);
    marks.push({
      key: "stealth_accumulate",
      emoji: "🕵",
      label: "세력 매집",
      tone: "good",
      detail: `외인 5일 +${fEok}억 · 기관 5일 +${iEok}억 — 동반 누적 매수(근사)`,
      priority: 2,
    });
  }

  // ─── 개미무덤 / 개미털기 ─────────────────────────────────────────────────
  // 오늘 개인만 사고 외인·기관 둘 다 던지는 전형적 약세 시그널.
  // foreignNet, institutionNet, individualNet 셋이 모두 채워졌을 때만 평가.
  //   당일 가격이 내렸으면 → "개미털기" (실제로 개미가 물려 들어간 강한 약세)
  //   당일 가격은 버텼으면 → "개미무덤" (외인·기관 매도에도 개인 매수로 가격 방어, 추후 약세 우려)
  // 둘은 상호배타로 동시에 노출하지 않는다.
  if (
    flow &&
    flow.individualNet != null &&
    flow.foreignNet != null &&
    flow.institutionNet != null &&
    flow.individualNet > 0 &&
    flow.foreignNet < 0 &&
    flow.institutionNet < 0
  ) {
    if (quote.changeRate < 0) {
      marks.push({
        key: "ant_shake",
        emoji: "🥲",
        label: "개미털기",
        tone: "warn",
        detail: `외인·기관 매도, 개인만 매수, 당일 ${(quote.changeRate * 100).toFixed(1)}% — 개미가 물린 약세`,
        priority: 1,
      });
    } else {
      marks.push({
        key: "ant_grave",
        emoji: "🪦",
        label: "개미무덤",
        tone: "bad",
        detail: "오늘 외인·기관 동반 매도, 개인만 매수 — 단기 약세 우려",
        priority: 1,
      });
    }
  }

  // ─── 어닝 D-N ───────────────────────────────────────────────────────────
  // 다가올 가격 이벤트(실적·배당) 중 earnings 가 7일 이내면 D-N 배지.
  // upcomingEvents 가 빈 배열/undefined 면 자동 스킵 (recommendations 등 events 없는 호출에서).
  if (upcomingEvents && upcomingEvents.length > 0) {
    const now = Date.now();
    const cutoff = now + 7 * 86_400_000;
    const earningsSoon = upcomingEvents
      .filter((e) => e.kind === "earnings")
      .filter((e) => e.date >= now - 86_400_000 && e.date <= cutoff)
      .sort((a, b) => a.date - b.date)[0];
    if (earningsSoon) {
      const dn = Math.max(0, Math.round((earningsSoon.date - now) / 86_400_000));
      marks.push({
        key: "earnings_dn",
        emoji: "📊",
        label: `어닝 D-${dn}`,
        tone: "neutral",
        detail: earningsSoon.label,
        priority: 1,
      });
    }
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
