"use client";

import { useEffect, useState } from "react";
import type {
  AskingPriceData,
  ExecutionTick,
} from "@/lib/types";
import { changeColor, fmtNumber, fmtPercent } from "@/lib/utils";

// 선택 종목 1개의 호가 + 체결 폴링 패널.
// KIS 미활성 또는 한국 종목 아니면 빈 메시지.
// 호가는 1초 간격, 체결도 함께. 카드 보이는 동안만 폴링.

interface Props {
  code: string;
  active: boolean;
  pollMs?: number;
}

interface IntradayResponse {
  asking: AskingPriceData | null;
  executions: ExecutionTick[] | null;
  error?: string;
}

export function AskingPricePanel({ code, active, pollMs = 1500 }: Props) {
  const [data, setData] = useState<IntradayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active || !code) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchOnce = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/intraday?code=${encodeURIComponent(code)}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as IntradayResponse;
        if (!cancelled) setData(j);
      } catch {
        if (!cancelled) setData({ asking: null, executions: null, error: "fetch 실패" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchOnce();
    timer = setInterval(() => void fetchOnce(), pollMs);
    const refresh = setInterval(() => setTick((x) => x + 1), 2000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      clearInterval(refresh);
    };
  }, [code, active, pollMs]);

  if (!active) return null;

  const asking = data?.asking;
  const executions = data?.executions;

  // 빈 응답 (KIS 미지원 등) — 패널 자체에 명시.
  if (!asking && !executions && !loading) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        호가/체결 데이터를 받지 못했어요. (KIS 키 또는 종목 미지원)
      </div>
    );
  }

  // 첫 fetch 진행 중 (data === null && loading) — 사용자에게 "호가 불러오는 중…" 명시.
  // 호가 fetch 가 1.5초 폴링 + 첫 응답 수백 ms 라 빈 화면이 길게 노출되면 답답함.
  // 주인님 규칙: "모든 창 로딩은 반드시 로딩중이라고 꼭 표시 — 예외 없다."
  if (!asking && !executions && loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
          호가 불러오는 중…
        </div>
        {/* 10단계 호가 더미 라인 — pulse skeleton 으로 실제 표 높이 채워 layout shift 방지 */}
        <div className="space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_2fr_1fr] gap-2 animate-pulse"
            >
              <div className="h-4 rounded bg-muted/60" />
              <div className="h-4 rounded bg-muted/40" />
              <div className="h-4 rounded bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {asking && <AskingTable asking={asking} />}
      {executions && executions.length > 0 && (
        <ExecutionList ticks={executions} />
      )}
      {(asking?.fetchedAt || executions?.[0]?.time) && (
        <div className="text-[10px] text-muted-foreground tabular text-right">
          KIS · {loading ? "갱신중..." : "방금 갱신"}
        </div>
      )}
    </div>
  );
}

// 10단계 호가 — 매도 위(역순), 매수 아래. 가운데에 잔량 막대.
function AskingTable({ asking }: { asking: AskingPriceData }) {
  const maxQty = Math.max(
    1,
    ...asking.levels.map((l) => Math.max(l.askQty || 0, l.bidQty || 0))
  );
  // 매도 호가는 위에서 아래로 가까운 가격(1호가)이 아래에 오도록 역순.
  const askRows = [...asking.levels].slice().reverse();
  const bidRows = asking.levels;

  const ratioPct = asking.ccldStrength;
  // 잔량 분포 — 매수 비율 = bid / (bid+ask). 0~100.
  const totalLevelQty = asking.totalAskQty + asking.totalBidQty;
  const bidShare =
    totalLevelQty > 0 ? (asking.totalBidQty / totalLevelQty) * 100 : 50;

  return (
    <div className="space-y-3">
      {/* 헤더 — 체결강도 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
          10단계 호가 잔량
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">체결강도</span>
          <span
            className={`tabular font-semibold ${
              ratioPct != null && ratioPct >= 100 ? "text-up" : "text-down"
            }`}
          >
            {ratioPct != null ? ratioPct.toFixed(0) : "—"}
          </span>
        </div>
      </div>

      {/* 매수 비율 게이지 */}
      <div className="h-2 rounded-full overflow-hidden bg-muted/40 flex">
        <div
          className="bg-up/70"
          style={{ width: `${bidShare}%` }}
          title={`매수잔량 ${asking.totalBidQty.toLocaleString("ko-KR")}`}
        />
        <div
          className="bg-down/70"
          style={{ width: `${100 - bidShare}%` }}
          title={`매도잔량 ${asking.totalAskQty.toLocaleString("ko-KR")}`}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular">
        <span>매수 {bidShare.toFixed(0)}%</span>
        <span>매도 {(100 - bidShare).toFixed(0)}%</span>
      </div>

      {/* 호가 테이블 */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* 매도 (위) */}
        {askRows.map((l, idx) => (
          <Row
            key={`ask-${idx}`}
            side="ask"
            price={l.askPrice}
            qty={l.askQty}
            maxQty={maxQty}
          />
        ))}
        {/* 구분선 */}
        <div className="h-px bg-border" />
        {/* 매수 (아래) */}
        {bidRows.map((l, idx) => (
          <Row
            key={`bid-${idx}`}
            side="bid"
            price={l.bidPrice}
            qty={l.bidQty}
            maxQty={maxQty}
          />
        ))}
      </div>

      {asking.expectedPrice != null && asking.expectedPrice > 0 && (
        <div className="text-[11px] text-muted-foreground tabular">
          예상체결가 {fmtNumber(asking.expectedPrice, 0)} ·
          예상거래량 {fmtNumber(asking.expectedVolume, 0)}
        </div>
      )}
    </div>
  );
}

function Row({
  side,
  price,
  qty,
  maxQty,
}: {
  side: "ask" | "bid";
  price: number;
  qty: number;
  maxQty: number;
}) {
  const widthPct = maxQty > 0 ? (qty / maxQty) * 100 : 0;
  const isAsk = side === "ask";
  return (
    <div className="grid grid-cols-2 text-xs tabular border-b border-border/40 last:border-0">
      {/* 매도(왼쪽) - 가격 오른쪽 정렬, 잔량 막대 왼쪽으로 */}
      {isAsk ? (
        <>
          <div className="relative px-2 py-1 text-right text-down">
            {fmtNumber(price, 0)}
          </div>
          <div className="relative px-2 py-1">
            <div
              className="absolute inset-y-0 left-0 bg-down/15"
              style={{ width: `${widthPct}%` }}
              aria-hidden
            />
            <span className="relative">{fmtNumber(qty, 0)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="relative px-2 py-1 text-right">
            <div
              className="absolute inset-y-0 right-0 bg-up/15"
              style={{ width: `${widthPct}%` }}
              aria-hidden
            />
            <span className="relative">{fmtNumber(qty, 0)}</span>
          </div>
          <div className="px-2 py-1 text-left text-up">
            {fmtNumber(price, 0)}
          </div>
        </>
      )}
    </div>
  );
}

function ExecutionList({ ticks }: { ticks: ExecutionTick[] }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
        최근 체결 {ticks.length}건
      </div>
      <div className="rounded-lg border border-border max-h-80 overflow-y-auto">
        <div className="grid grid-cols-4 text-[10px] text-muted-foreground tabular px-2 py-1.5 border-b border-border bg-muted/30 sticky top-0">
          <span>시각</span>
          <span className="text-right">가격</span>
          <span className="text-right">변동</span>
          <span className="text-right">체결량</span>
        </div>
        {ticks.map((t, i) => {
          const color = t.side === "buy" ? "text-up" : t.side === "sell" ? "text-down" : "";
          const d = new Date(t.time);
          const hms = `${String(d.getHours()).padStart(2, "0")}:${String(
            d.getMinutes()
          ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
          return (
            <div
              key={i}
              className={`grid grid-cols-4 text-[11px] tabular px-2 py-1 border-b border-border/40 last:border-0 ${color}`}
            >
              <span className="text-muted-foreground">{hms}</span>
              <span className="text-right font-medium">
                {fmtNumber(t.price, 0)}
              </span>
              <span className={`text-right ${changeColor(t.changeRate ?? 0)}`}>
                {t.changeRate != null ? fmtPercent(t.changeRate) : "—"}
              </span>
              <span className="text-right">{fmtNumber(t.volume, 0)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
