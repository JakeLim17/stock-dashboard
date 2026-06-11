"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// KIS WebSocket 다중 채널 실시간 구독 훅 (Phase 3).
//
// 흐름:
//   클라이언트 ─SSE EventSource→ /api/realtime/stream?symbols=...&topics=...
//                                   └─ 서버가 KIS WS 연결·구독·메시지 변환
//
// 토픽:
//   - "price" : H0STCNT0 의 체결가 (Phase 1)
//   - "trade" : H0STCNT0 의 누적거래량·거래대금 (Phase 3, 같은 구독에서 추출)
//   - "asp"   : H0STASP0 의 10단계 호가/잔량 (Phase 3)
//
// 반환:
//   {
//     prices: Record<code, { price, ts }>,
//     trades: Record<code, { cumVolume, cumTradeValue, ts }>,
//     asps:   Record<code, { asks[10], bids[10], totalAskQty, totalBidQty, expectedPrice, expectedVolume, ts }>,
//     status
//   }
//
// 동작 조건:
//   - process.env.NEXT_PUBLIC_REALTIME_ENABLED === "true" 일 때만 EventSource 연결.
//   - false / 미설정이면 즉시 status="unsupported" 반환 → 호출자는 기존 polling 사용.
//   - symbols 가 0개 또는 topics 0개면 연결 안 함.
//   - 회귀 방지: feature flag OFF 또는 빈 입력이면 네트워크 호출 0.

export type RealtimeStatus =
  | "unsupported" // feature flag OFF
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type RealtimeTopic = "price" | "trade" | "asp";

export interface RealtimePriceEntry {
  price: number;
  ts: number;
}

export interface RealtimeTradeEntry {
  cumVolume: number;
  cumTradeValue: number;
  ts: number;
}

export interface RealtimeAspLevel {
  price: number;
  qty: number;
}

export interface RealtimeAspEntry {
  asks: RealtimeAspLevel[]; // 1..10
  bids: RealtimeAspLevel[]; // 1..10
  totalAskQty: number;
  totalBidQty: number;
  expectedPrice: number | null;
  expectedVolume: number | null;
  ts: number;
}

export interface UseRealtimeResult {
  prices: Record<string, RealtimePriceEntry>;
  trades: Record<string, RealtimeTradeEntry>;
  asps: Record<string, RealtimeAspEntry>;
  status: RealtimeStatus;
}

// 200ms 단위로 batch flush — React render 폭주 방지.
const THROTTLE_MS = 200;

// 재접속 backoff — 1s, 2s, 4s, 8s, 16s, 30s(상한)
function backoffMs(retry: number): number {
  return Math.min(30_000, 1_000 * Math.pow(2, Math.min(retry, 5)));
}

const DEFAULT_TOPICS: RealtimeTopic[] = ["price"];

export function useRealtime(
  symbols: string[],
  topics: RealtimeTopic[] = DEFAULT_TOPICS
): UseRealtimeResult {
  const enabled = process.env.NEXT_PUBLIC_REALTIME_ENABLED === "true";

  // 구독 코드 — 6자리 한국 코드만 + 중복 제거 + 정렬.
  const symbolKey = useMemo(() => {
    const six = symbols
      .map((s) => s.trim().match(/^(\d{6})/)?.[1])
      .filter((s): s is string => !!s);
    return Array.from(new Set(six)).sort().join(",");
  }, [symbols]);

  // 토픽 키 — 알파벳 정렬해서 stable 한 문자열로.
  const topicKey = useMemo(() => {
    const valid: RealtimeTopic[] = ["price", "trade", "asp"];
    const set = new Set<RealtimeTopic>(topics.filter((t) => valid.includes(t)));
    if (set.size === 0) set.add("price");
    return Array.from(set).sort().join(",");
  }, [topics]);

  const [prices, setPrices] = useState<Record<string, RealtimePriceEntry>>({});
  const [trades, setTrades] = useState<Record<string, RealtimeTradeEntry>>({});
  const [asps, setAsps] = useState<Record<string, RealtimeAspEntry>>({});
  const [status, setStatus] = useState<RealtimeStatus>(
    enabled ? "connecting" : "unsupported"
  );

  // 200ms throttle 버퍼 — 같은 code 의 최신 값만 유지(덮어쓰기). 토픽별 분리.
  const priceBufRef = useRef<Record<string, RealtimePriceEntry>>({});
  const tradeBufRef = useRef<Record<string, RealtimeTradeEntry>>({});
  const aspBufRef = useRef<Record<string, RealtimeAspEntry>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("unsupported");
      return;
    }
    if (symbolKey.length === 0 || topicKey.length === 0) {
      setStatus("closed");
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;

    const flush = () => {
      flushTimerRef.current = null;
      if (Object.keys(priceBufRef.current).length > 0) {
        const batch = priceBufRef.current;
        priceBufRef.current = {};
        setPrices((prev) => ({ ...prev, ...batch }));
      }
      if (Object.keys(tradeBufRef.current).length > 0) {
        const batch = tradeBufRef.current;
        tradeBufRef.current = {};
        setTrades((prev) => ({ ...prev, ...batch }));
      }
      if (Object.keys(aspBufRef.current).length > 0) {
        const batch = aspBufRef.current;
        aspBufRef.current = {};
        setAsps((prev) => ({ ...prev, ...batch }));
      }
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(flush, THROTTLE_MS);
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

      const qs = `symbols=${encodeURIComponent(symbolKey)}&topics=${encodeURIComponent(topicKey)}`;
      es = new EventSource(`/api/realtime/stream?${qs}`);

      es.addEventListener("open", () => {
        if (cancelled) return;
        retry = 0;
        setStatus("open");
      });

      es.addEventListener("price", (ev) => {
        if (cancelled) return;
        try {
          const j = JSON.parse((ev as MessageEvent).data) as {
            code?: string;
            price?: number;
            ts?: number;
          };
          if (typeof j.code !== "string" || !Number.isFinite(j.price)) return;
          priceBufRef.current[j.code] = {
            price: j.price as number,
            ts: typeof j.ts === "number" ? j.ts : Date.now(),
          };
          scheduleFlush();
        } catch {
          // parse error
        }
      });

      es.addEventListener("trade", (ev) => {
        if (cancelled) return;
        try {
          const j = JSON.parse((ev as MessageEvent).data) as {
            code?: string;
            cumVolume?: number;
            cumTradeValue?: number;
            ts?: number;
          };
          if (typeof j.code !== "string") return;
          tradeBufRef.current[j.code] = {
            cumVolume: Number.isFinite(j.cumVolume) ? (j.cumVolume as number) : 0,
            cumTradeValue: Number.isFinite(j.cumTradeValue)
              ? (j.cumTradeValue as number)
              : 0,
            ts: typeof j.ts === "number" ? j.ts : Date.now(),
          };
          scheduleFlush();
        } catch {
          // parse error
        }
      });

      es.addEventListener("asp", (ev) => {
        if (cancelled) return;
        try {
          const j = JSON.parse((ev as MessageEvent).data) as Partial<
            RealtimeAspEntry & { code: string }
          >;
          if (typeof j.code !== "string") return;
          if (!Array.isArray(j.asks) || !Array.isArray(j.bids)) return;
          aspBufRef.current[j.code] = {
            asks: j.asks as RealtimeAspLevel[],
            bids: j.bids as RealtimeAspLevel[],
            totalAskQty: Number.isFinite(j.totalAskQty)
              ? (j.totalAskQty as number)
              : 0,
            totalBidQty: Number.isFinite(j.totalBidQty)
              ? (j.totalBidQty as number)
              : 0,
            expectedPrice:
              typeof j.expectedPrice === "number" && j.expectedPrice > 0
                ? j.expectedPrice
                : null,
            expectedVolume:
              typeof j.expectedVolume === "number" && j.expectedVolume > 0
                ? j.expectedVolume
                : null,
            ts: typeof j.ts === "number" ? j.ts : Date.now(),
          };
          scheduleFlush();
        } catch {
          // parse error
        }
      });

      // 서버 soft-timeout → 즉시 새 연결
      es.addEventListener("reconnect", () => {
        if (cancelled) return;
        closeCurrent();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(open, 200);
      });

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
      priceBufRef.current = {};
      tradeBufRef.current = {};
      aspBufRef.current = {};
      setStatus("closed");
    };
  }, [enabled, symbolKey, topicKey]);

  return { prices, trades, asps, status };
}
