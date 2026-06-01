import "server-only";
import { fetchMarketAlert } from "./naver";
import type { MarketAlert } from "../types";

// 한국거래소 시장경보(투자주의/경고/위험·관리종목·거래정지)는 일별 갱신.
// 시세 폴링(5~15초)마다 종목 페이지를 긁으면 차단 위험·비용이 폭증해
// consensusCache 와 동일하게 종목당 6시간 메모리 TTL 캐시를 둔다.
//
// 캐시 형태: 한 번 조회 결과(MarketAlert | null) 자체를 저장.
//   - 시장경보가 없는 정상 종목도 null 결과를 캐싱해 6시간 동안 재호출 방지.
//   - 실패(network 등)는 캐싱하지 않아 다음 호출 때 재시도 가능.
//
// Vercel 함수 인스턴스마다 메모리가 분리되지만 cold start 시 다시 채워지면 충분.

const TTL_MS = 6 * 60 * 60 * 1000; // 6h

interface CacheEntry {
  data: MarketAlert | null;
  expiresAt: number;
}

declare global {
  // 핫 리로드/모듈 재평가 시 캐시 유실 방지
  var __marketAlertCache: Map<string, CacheEntry> | undefined;
}

function cache(): Map<string, CacheEntry> {
  if (!global.__marketAlertCache) {
    global.__marketAlertCache = new Map();
  }
  return global.__marketAlertCache;
}

/**
 * 한국 종목의 시장경보를 6시간 캐시로 조회.
 * 6자리 KRX 코드 또는 Yahoo 코드("007390.KS") 모두 허용.
 * 한국 종목이 아니거나 시장경보가 없으면 null 반환.
 */
export async function getMarketAlertCached(
  code: string
): Promise<MarketAlert | null> {
  const now = Date.now();
  const c = cache();
  const hit = c.get(code);
  if (hit && hit.expiresAt > now) return hit.data;

  try {
    const alert = await fetchMarketAlert(code);
    c.set(code, { data: alert, expiresAt: now + TTL_MS });
    return alert;
  } catch {
    // 실패는 캐싱하지 않음 — 다음 호출 때 재시도
    return null;
  }
}

// 테스트/관리자용 — 현재 캐시 무효화
export function invalidateMarketAlertCache(code?: string) {
  if (code) cache().delete(code);
  else cache().clear();
}
