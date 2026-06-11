"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// KIS WebSocket H0STCNT0(체결가) 실시간 가격 구독 훅.
//
// 흐름:
//   클라이언트 ─SSE EventSource→ /api/realtime/stream?symbols=...
//                                   └─ 서버가 KIS WS 연결·구독·메시지 변환
//
// 반환:
//   { prices: { "005930": { price: 74000, ts: 173... }, ... }, status }
//
// 동작 조건:
//   - process.env.NEXT_PUBLIC_REALTIME_ENABLED === "true" 일 때만 EventSource 연결.
//   - false / 미설정이면 즉시 status="unsupported" 반환 → 호출자는 기존 polling 사용.
//   - 회귀 방지: feature flag OFF 면 어떤 네트워크 호출도 발생하지 않는다.

export type RealtimeStatus =
  | "unsupported" // feature flag OFF
  | "connecting"
  | "open"
  | "closed"
  | "error";

export interface RealtimePriceEntry {
  price: number;
  ts: number; // epoch ms
}

export interface UseRealtimeResult {
  prices: Record<string, RealtimePriceEntry>;
  status: RealtimeStatus;
}

// 200ms 단위로 batch flush — React render 폭주 방지.
// KIS H0STCNT0 는 거래량 많은 종목에서 초당 수십 건도 가능.
const THROTTLE_MS = 200;

// 재접속 backoff — 1s, 2s, 4s, 8s, 16s, 30s(상한)
function backoffMs(retry: number): number {
  return Math.min(30_000, 1_000 * Math.pow(2, Math.min(retry, 5)));
}

export function useRealtime(symbols: string[]): UseRealtimeResult {
  const enabled = process.env.NEXT_PUBLIC_REALTIME_ENABLED === "true";

  // 구독 코드 ↦ 안정 문자열 (정렬 + 6자리 한국 코드만 필터).
  // 6자리가 아니면 KIS H0STCNT0 미지원이므로 서버에서도 거른다 — 클라이언트에서 미리 제거해 SSE 빈 호출 방지.
  const symbolKey = useMemo(() => {
    const six = symbols
      .map((s) => s.trim().match(/^(\d{6})/)?.[1])
      .filter((s): s is string => !!s);
    const unique = Array.from(new Set(six)).sort();
    return unique.join(",");
  }, [symbols]);

  const [prices, setPrices] = useState<Record<string, RealtimePriceEntry>>({});
  const [status, setStatus] = useState<RealtimeStatus>(
    enabled ? "connecting" : "unsupported"
  );

  // 200ms throttle 버퍼 — 같은 코드의 최신 가격만 유지(덮어쓰기).
  const bufferRef = useRef<Record<string, RealtimePriceEntry>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("unsupported");
      return;
    }
    if (symbolKey.length === 0) {
      setStatus("closed");
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;

    const flushBuffer = () => {
      flushTimerRef.current = null;
      if (Object.keys(bufferRef.current).length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = {};
      setPrices((prev) => ({ ...prev, ...batch }));
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(flushBuffer, THROTTLE_MS);
    };

    const closeCurrent = () => {
      if (es) {
        try {
          es.close();
        } catch {
          // ignore
        }
        es = null;
      }
    };

    const open = () => {
      if (cancelled) return;
      setStatus("connecting");

      const url = `/api/realtime/stream?symbols=${encodeURIComponent(symbolKey)}`;
      es = new EventSource(url);

      // EventSource 의 onopen 은 HTTP 200 + 첫 데이터 수신 직전.
      es.addEventListener("open", () => {
        if (cancelled) return;
        retry = 0;
        setStatus("open");
      });

      // 서버가 보낸 "event: price\ndata: {...}" 메시지 처리.
      es.addEventListener("price", (ev) => {
        if (cancelled) return;
        try {
          const j = JSON.parse((ev as MessageEvent).data) as {
            code?: string;
            price?: number;
            ts?: number;
          };
          if (typeof j.code !== "string" || !Number.isFinite(j.price)) return;
          bufferRef.current[j.code] = {
            price: j.price as number,
            ts: typeof j.ts === "number" ? j.ts : Date.now(),
          };
          scheduleFlush();
        } catch {
          // 파싱 실패 — 무시
        }
      });

      // 서버가 soft-timeout 으로 우아하게 닫음 → 즉시 새 연결.
      es.addEventListener("reconnect", () => {
        if (cancelled) return;
        closeCurrent();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(open, 200);
      });

      // EventSource 의 default error — 네트워크 끊김 등. 자동 재시도 backoff.
      es.addEventListener("error", () => {
        if (cancelled) return;
        closeCurrent();
        setStatus("error");
        retry += 1;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(open, backoffMs(retry));
      });
    };

    open();

    return () => {
      cancelled = true;
      closeCurrent();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      // bufferRef 초기화 — 다음 구독 cycle 에서 stale 가격 섞임 방지.
      bufferRef.current = {};
      setStatus("closed");
    };
  }, [enabled, symbolKey]);

  return { prices, status };
}
