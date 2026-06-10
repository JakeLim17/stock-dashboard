"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  MarketLeader,
  MarketLeadersData,
  MarketLeadersKind,
  MarketLeadersMarket,
  StockSnapshot,
} from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { changeColor, fmtNumber, fmtPercent, pickPrimaryQuote } from "@/lib/utils";

// 거래량 / 상승 / 하락 TOP — KIS 활성 시만 동작. 30s 캐시.
// 마운트 시 1회 + 사용자 탭 전환 시 fetch. 자동 폴링은 없음 (사용자 행동 기반).

const KIND_LABEL: Record<MarketLeadersKind, string> = {
  volume: "거래량 TOP",
  rising: "상승 TOP",
  falling: "하락 TOP",
};

const MARKET_LABEL: Record<MarketLeadersMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

interface LeadersResponse {
  data: MarketLeadersData | null;
  error?: string;
}

function toShortCode(code: string): string {
  return code.replace(/\.(KS|KQ)$/i, "");
}

function matchesMarket(code: string, market: MarketLeadersMarket): boolean {
  if (market === "all") return true;
  if (market === "kospi") return /\.KS$/i.test(code);
  return /\.KQ$/i.test(code);
}

function buildFallbackLeaders(
  snapshots: StockSnapshot[],
  kind: MarketLeadersKind,
  market: MarketLeadersMarket
): MarketLeadersData | null {
  const rows = snapshots
    .filter((snap) => matchesMarket(snap.meta.code, market))
    .map((snap) => {
      const { primary } = pickPrimaryQuote(snap.quote);
      return {
        code: toShortCode(snap.meta.code),
        name: snap.meta.name,
        price: primary.price,
        changeAbs: primary.changeAbs,
        changeRate: primary.changeRate,
        volume: snap.quote.volume ?? null,
      };
    });

  if (kind === "volume") {
    rows.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  } else if (kind === "rising") {
    rows.sort((a, b) => b.changeRate - a.changeRate);
  } else {
    rows.sort((a, b) => a.changeRate - b.changeRate);
  }

  const items: MarketLeader[] = rows.slice(0, 10).map((row, i) => ({
    rank: i + 1,
    ...row,
  }));
  if (items.length === 0) return null;
  return { kind, market, items, fetchedAt: Date.now() };
}

export function MarketLeadersPanel({
  snapshots,
}: {
  snapshots: StockSnapshot[];
}) {
  const [kind, setKind] = useState<MarketLeadersKind>("volume");
  const [market, setMarket] = useState<MarketLeadersMarket>("all");
  const [data, setData] = useState<MarketLeadersData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"kis" | "watchlist" | null>(null);
  const [open, setOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const fallback = buildFallbackLeaders(snapshots, kind, market);
    try {
      const r = await fetch(
        `/api/leaders?kind=${kind}&market=${market}&count=10`,
        { cache: "no-store" }
      );
      const j = (await r.json()) as LeadersResponse;
      if (j.error) {
        setError(`${j.error} · 관심종목 기준으로 표시`);
        setData(fallback);
        setSource(fallback ? "watchlist" : null);
        return;
      }
      setData(j.data ?? fallback);
      setSource(j.data ? "kis" : fallback ? "watchlist" : null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`${msg} · 관심종목 기준으로 표시`);
      setData(fallback);
      setSource(fallback ? "watchlist" : null);
    } finally {
      setLoading(false);
    }
  }, [kind, market, snapshots]);

  useEffect(() => {
    if (!open) return;
    void fetchData();
  }, [open, fetchData]);

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-left"
        >
          <CardTitle>시장 순위 (KIS)</CardTitle>
          <span className="text-xs text-muted-foreground">
            {open ? "▴ 접기" : "▾ 펴기"}
          </span>
        </button>
        {open && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* kind 토글 */}
            <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
              {(Object.keys(KIND_LABEL) as MarketLeadersKind[]).map((k) => {
                const active = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                      active
                        ? "bg-foreground text-background font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {KIND_LABEL[k]}
                  </button>
                );
              })}
            </div>
            {/* market 토글 */}
            <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
              {(Object.keys(MARKET_LABEL) as MarketLeadersMarket[]).map((m) => {
                const active = market === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMarket(m)}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                      active
                        ? "bg-foreground text-background font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {MARKET_LABEL[m]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardHeader>

      {open && (
        <CardBody>
          {loading && !data && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              불러오는 중…
            </div>
          )}
          {error && (
            <div className="mb-3 rounded-lg border border-warn/30 bg-warn/10 text-warn text-xs px-3 py-2">
              {error}
            </div>
          )}
          {!loading && !error && !data && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              표시할 순위 데이터가 없습니다.
            </div>
          )}
          {data && data.items.length > 0 && <LeadersTable items={data.items} />}
          {data && data.items.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              데이터가 없습니다.
            </div>
          )}
          {data?.fetchedAt && (
            <div className="text-[10px] text-muted-foreground text-right mt-2 tabular">
              {`기준 ${new Date(data.fetchedAt).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })} · ${
                source === "kis" ? "KIS (30s 캐시)" : "관심종목 기준"
              }`}
            </div>
          )}
        </CardBody>
      )}
    </Card>
  );
}

function LeadersTable({ items }: { items: MarketLeader[] }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="grid grid-cols-12 text-[10px] text-muted-foreground tabular px-3 py-1.5 border-b border-border bg-muted/30">
        <span className="col-span-1">#</span>
        <span className="col-span-4">종목</span>
        <span className="col-span-3 text-right">가격</span>
        <span className="col-span-2 text-right">변동</span>
        <span className="col-span-2 text-right">거래량</span>
      </div>
      {items.map((it) => (
        <div
          key={`${it.rank}-${it.code}`}
          className="grid grid-cols-12 text-xs tabular px-3 py-1.5 border-b border-border/40 last:border-0 hover:bg-muted/30"
        >
          <span className="col-span-1 text-muted-foreground">{it.rank}</span>
          <span className="col-span-4 truncate">
            <span className="font-medium">{it.name}</span>
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              {it.code}
            </span>
          </span>
          <span className="col-span-3 text-right">
            {fmtNumber(it.price, 0)}
          </span>
          <span
            className={`col-span-2 text-right ${changeColor(it.changeRate)}`}
          >
            {fmtPercent(it.changeRate)}
          </span>
          <span className="col-span-2 text-right text-muted-foreground">
            {fmtNumber(it.volume, 0)}
          </span>
        </div>
      ))}
    </div>
  );
}
