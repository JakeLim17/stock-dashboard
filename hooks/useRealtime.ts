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
//
// 영구 stop (status="disabled"):
//   - 운영에서 KIS_WS_RELAY_URL 가 없으면 /api/realtime/stream 이 503 + SSE body 로 응답.
//     EventSource 는 200 + text/event-stream 만 SSE 로 파싱하므로 503 body 정보가
//     클라이언트에 전달되지 않고 `onerror` 만 발생 → backoff 재연결 무한 루프 발생.
//   - 해결: EventSource 를 열기 전에 /api/realtime/health 한 번 fetch 해서 503 이면
//     이번 페이지 lifetime 동안 영구 disabled. 새로고침 전까지 다시 시도 안 함.
//   - 호출자 입장에선 "unsupported" 와 동일하게 취급 (폴링만 동작).

export type RealtimeStatus =
  | "unsupported" // feature flag OFF
  | "disabled" // 서버측 영구 비활성 (relay 미설정 등) — 페이지 새로고침 전까지 재시도 안 함
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

// ─── 영구 disabled 상태 (모듈 레벨, 페이지 새로고침 전까지 유지) ─────
// 한 페이지 안에서 useRealtime 이 여러 인스턴스로 호출되더라도 health 체크는 1회만.
// `realtimeDisabled = true` 가 되면 어떤 인스턴스도 EventSource 를 열지 않는다.
let realtimeDisabled = false;
let healthProbed = false;
let healthProbePromise: Promise<void> | null = null;

async function probeRealtimeHealthOnce(): Promise<void> {
  if (healthProbed) return;
  if (healthProbePromise) return healthProbePromise;
  healthProbePromise = (async () => {
    try {
      const r = await fetch("/api/realtime/health", {
        method: "GET",
        cache: "no-store",
        // 인증 게이트는 PUBLIC_PATHS 로 우회됨 — credentials 기본값으로 OK
      });
      if (r.status === 503) {
        // 서버가 영구 비활성 응답 — 이번 lifetime 동안 EventSource 안 연다.
        realtimeDisabled = true;
      }
      // 그 외(200, 401, 500…) 는 일시 오류로 보고 EventSource 진행.
      // ES 자체 backoff 가 처리.
    } catch {
      // 네트워크 오류 — 영구 disabled 로 단정하지 않음.
    } finally {
      healthProbed = true;
      healthProbePromise = null;
    }
  })();
  return healthProbePromise;
}

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
  const [status, setStatus] = useState<RealtimeStatus>(() => {
    if (!enabled) return "unsupported";
    if (realtimeDisabled) return "disabled";
    return "connecting";
  });

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
    if (realtimeDisabled) {
      // 이전에 503 받은 적 있음 — 페이지 새로고침 전까지 재시도 금지.
      setStatus("disabled");
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

    // 503/realtime-disabled 감지 시 영구 stop — 어떤 reconnect 도 발화 안 함.
    const markDisabledPermanently = () => {
      realtimeDisabled = true;
      cancelled = true;
      closeCurrent();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setStatus("disabled");
    };

    const open = () => {
      if (cancelled || realtimeDisabled) return;
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

      // 서버가 향후 200 + SSE body 로 realtime-disabled 를 보내주면
      // named "error" event 의 data 에 reason 이 들어온다 (방어적 처리).
      // 일반 connection error 는 data 가 없으므로 try/catch 로 안전.
      es.addEventListener("error", (ev) => {
        if (cancelled) return;
        try {
          const me = ev as MessageEvent;
          if (typeof me.data === "string" && me.data.length > 0) {
            const j = JSON.parse(me.data) as { reason?: string };
            if (j?.reason === "realtime-disabled") {
              markDisabledPermanently();
              return;
            }
          }
        } catch {
          // SSE event 가 아니거나 파싱 실패 — 일반 connection error 로 처리
        }
        closeCurrent();
        setStatus("error");
        retry += 1;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(open, backoffMs(retry));
      });
    };

    // 사전 health 체크 후 EventSource 연결 (503 이면 영구 stop, 0번 연결).
    void probeRealtimeHealthOnce().then(() => {
      if (cancelled) return;
      if (realtimeDisabled) {
        setStatus("disabled");
        return;
      }
      open();
    });

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
      // 영구 disabled 로 결정됐으면 cleanup 으로 덮어쓰지 않음.
      setStatus(realtimeDisabled ? "disabled" : "closed");
    };
  }, [enabled, symbolKey, topicKey]);

  return { prices, trades, asps, status };
}
