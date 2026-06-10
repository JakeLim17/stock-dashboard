import "server-only";

// 한국 종목 시간외 단일가 OHLC.
// 데이터 소스: Naver polling API (`/api/realtime/domestic/stock/{code6}`) 의
// `overMarketPriceInfo` 필드. AFTER_MARKET(앱장, 16:00~20:00) / BEFORE_MARKET(프리장, 08:00~)
// 각각의 OHLC + 종료 시각을 한 캔들로 가공한다.
//
// KIS 분봉 API(`inquire-time-itemchartprice`)는 정규장만 주기 때문에, 사용자가 차트에서
// "지금 시간외 단일가가 얼마인지" 보려면 별도 fetch가 필요. PriceChart는 정규장 캔들 뒤에
// 이 캔들을 흐린 색으로 덧붙여 시간외 거래를 시각화한다.

export type ExtendedSession = "before" | "after";

export interface ExtendedHoursCandle {
  date: number; // epoch ms — 캔들 시작 시각 (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: ExtendedSession;
}

interface NaverOverInfo {
  tradingSessionType?: string;
  overMarketStatus?: string;
  overPrice?: string | number;
  openPrice?: string | number;
  highPrice?: string | number;
  lowPrice?: string | number;
  localTradedAt?: string;
}

interface NaverPollingResp {
  datas?: Array<{
    overMarketPriceInfo?: NaverOverInfo;
  }>;
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 시간외 시작 시각 결정.
//   - localTradedAt 이 있으면 그것 - sessionLengthMs (앱장 4시간, 프리장 30분 정도) 로 시작 시각 계산
//   - 없으면 fallback 으로 오늘의 16:00 / 08:30 KST.
function resolveStartMs(
  session: ExtendedSession,
  tradedAt?: string
): number {
  if (tradedAt) {
    const d = new Date(tradedAt);
    if (!Number.isNaN(d.getTime())) {
      const lenMs = session === "after" ? 4 * 60 * 60 * 1000 : 30 * 60 * 1000;
      return d.getTime() - lenMs;
    }
  }
  // KST 기준 오늘 16:00 / 08:30 으로 폴백 (UTC+9 → -9h)
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const day = kstNow.getUTCDate();
  const h = session === "after" ? 16 : 8;
  const min = session === "after" ? 0 : 30;
  return Date.UTC(y, m, day, h, min) - kstOffsetMs;
}

function buildCandle(info: NaverOverInfo): ExtendedHoursCandle | null {
  const open = parseNumber(info.openPrice);
  const high = parseNumber(info.highPrice);
  const low = parseNumber(info.lowPrice);
  const close = parseNumber(info.overPrice);
  if (open == null || high == null || low == null || close == null) return null;
  // overPrice 가 0 인 경우(거래 전) 는 의미 없는 캔들이라 스킵
  if (close === 0 && open === 0 && high === 0 && low === 0) return null;
  const session: ExtendedSession =
    info.tradingSessionType === "BEFORE_MARKET" ? "before" : "after";
  const date = resolveStartMs(session, info.localTradedAt);
  return {
    date,
    open,
    high,
    low,
    close,
    volume: 0,
    session,
  };
}

// `005930.KS` / `005930.KQ` → `005930` 으로 변환.
function toNaverCode(code: string): string | null {
  const m = /^(\d{6})(?:\.K[SQ])?$/.exec(code);
  return m ? m[1] : null;
}

export async function fetchNaverExtendedCandles(
  code: string
): Promise<ExtendedHoursCandle[]> {
  const num = toNaverCode(code);
  if (!num) return [];
  try {
    const res = await fetch(
      `https://polling.finance.naver.com/api/realtime/domestic/stock/${num}`,
      {
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0" },
        // 짧은 timeout — 시간외 데이터는 보조 기능이라 5초 안에 응답 못 받으면 그냥 비움
        signal: AbortSignal.timeout(5_000),
      }
    );
    if (!res.ok) return [];
    const j = (await res.json()) as NaverPollingResp;
    const info = j.datas?.[0]?.overMarketPriceInfo;
    if (!info) return [];
    const candle = buildCandle(info);
    return candle ? [candle] : [];
  } catch {
    return [];
  }
}
