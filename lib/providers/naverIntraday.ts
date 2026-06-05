import "server-only";
import { isKrStock } from "./naver";

// 네이버 1분봉 OHLCV 어댑터.
//
// endpoint: https://api.stock.naver.com/chart/domestic/item/{6digit}/minute?range=1d
//
// 응답 예시(원본):
//   { localDateTime: "20260605090000", currentPrice: 332000.0,
//     openPrice: 333500.0, highPrice: 334000.0, lowPrice: 331500.0,
//     accumulatedTradingVolume: 1545657 }
//
// 한 호출당 정규장 진행분 만큼의 1분봉 배열이 온다. 마감 후엔 같은 데이터를 그대로 반환.
//
// 정책
//   - 한국 종목(.KS / .KQ)에만 호출. 미국·지수·환율은 즉시 null.
//   - 캐시 TTL 60초 (장 마감 후엔 다시 안 부르게 호출자가 가드)
//   - 실패 시 null — 에러는 절대 throw하지 않고 어댑터 안에서 흡수.

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

export interface IntradayBar {
  // localDateTime "YYYYMMDDHHMMSS" → epoch ms
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface NaverMinuteRow {
  localDateTime?: string;
  currentPrice?: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  accumulatedTradingVolume?: number;
}

const TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  bars: IntradayBar[] | null;
}

const cache = new Map<string, CacheEntry>();

function toNaverCode(code: string): string | null {
  const m = code.match(/^(\d{6})\.K[SQ]$/);
  return m ? m[1] : null;
}

// "YYYYMMDDHHMMSS" → epoch ms (KST 기준 시각이지만 네이버는 시각 라벨만 주고 TZ 없이 줘서
// UI에선 시각 라벨로만 사용해도 충분. 정확한 KST→UTC 변환은 +9시간 보정이 필요하지만
// 현재 지표 계산엔 상대 순서만 쓰므로 근사로 처리한다).
function parseLocalDateTime(s: string | undefined): number {
  if (!s || s.length < 14) return 0;
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const h = Number(s.slice(8, 10));
  const mi = Number(s.slice(10, 12));
  const se = Number(s.slice(12, 14));
  // KST (UTC+9). Date.UTC로 만들어 ms epoch 산출.
  return Date.UTC(y, mo - 1, d, h - 9, mi, se);
}

// 1분봉 데이터 조회. 캐시 hit이면 즉시 반환.
//   - 한국 종목 한정. 그 외 코드는 null.
//   - currentPrice가 분봉의 close에 해당. 주의: open/high/low는 해당 분봉 내 값.
//   - 사용자가 분봉으로 분석할 만한 봉 수 미만(<5)이면 null로 떨어뜨려 호출 측 분기 단순화.
export async function fetchIntradayBars(
  code: string
): Promise<IntradayBar[] | null> {
  if (!isKrStock(code)) return null;
  const naverCode = toNaverCode(code);
  if (!naverCode) return null;

  const now = Date.now();
  const cached = cache.get(code);
  if (cached && cached.expiresAt > now) return cached.bars;

  try {
    const url = `https://api.stock.naver.com/chart/domestic/item/${naverCode}/minute?range=1d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://m.stock.naver.com/",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      cache.set(code, { expiresAt: now + TTL_MS, bars: null });
      return null;
    }
    const raw = (await res.json()) as NaverMinuteRow[] | unknown;
    if (!Array.isArray(raw)) {
      cache.set(code, { expiresAt: now + TTL_MS, bars: null });
      return null;
    }

    const bars: IntradayBar[] = [];
    for (const r of raw) {
      const time = parseLocalDateTime(r.localDateTime);
      const open = Number(r.openPrice);
      const high = Number(r.highPrice);
      const low = Number(r.lowPrice);
      const close = Number(r.currentPrice);
      const volume = Number(r.accumulatedTradingVolume);
      if (
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      )
        continue;
      if (open <= 0 || close <= 0 || high <= 0 || low <= 0) continue;
      bars.push({
        time,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      });
    }

    bars.sort((a, b) => a.time - b.time);

    if (bars.length < 5) {
      cache.set(code, { expiresAt: now + TTL_MS, bars: null });
      return null;
    }
    cache.set(code, { expiresAt: now + TTL_MS, bars });
    return bars;
  } catch {
    cache.set(code, { expiresAt: now + TTL_MS, bars: null });
    return null;
  }
}

// 한국 정규장 운영 시간(09:00 ~ 15:30 KST, 평일) 안인지 판정.
// 분봉을 호출할지 말지 가드용으로 사용해 마감 시간엔 네트워크 낭비 방지.
// 토·일은 항상 false. 공휴일까지 정확히 거르진 않는다 (TTL 60s 캐시로 충분히 저렴).
export function isKrMarketOpen(now: Date = new Date()): boolean {
  // KST = UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  // 09:00 ~ 15:30 (정규장)
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}
