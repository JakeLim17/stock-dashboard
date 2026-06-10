"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import type {
  MarketLeader,
  MarketLeadersData,
  MarketLeadersKind,
  MarketLeadersMarket,
} from "@/lib/types";
import { Card, CardBody } from "./ui/Card";
import { changeColor, fmtNumber, fmtPercent } from "@/lib/utils";

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

export function MarketLeadersPanel() {
  const [kind, setKind] = useState<MarketLeadersKind>("volume");
  const [market, setMarket] = useState<MarketLeadersMarket>("all");
  const [data, setData] = useState<MarketLeadersData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/leaders?kind=${kind}&market=${market}&count=10`,
        { cache: "no-store" }
      );
      const j = (await r.json()) as LeadersResponse;
      if (j.error) {
        setError(j.error);
        setData(null);
        return;
      }
      setData(j.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, market]);

  useEffect(() => {
    if (!open) return;
    void fetchData();
  }, [open, fetchData]);

  return (
    <Card className="border-accent/20">
      {/* 헤더 — ThemeGroupView / RecommendationsPanel 와 동일한 패턴
          (아이콘 + 제목 + 보조설명 + 우측 ChevronDown). */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors rounded-2xl"
        aria-expanded={open}
      >
        <Trophy className="h-4 w-4 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">시장 순위 (KIS)</span>
            <span className="text-[11px] text-muted-foreground">
              {open
                ? `${KIND_LABEL[kind]} · ${MARKET_LABEL[market]}`
                : "거래량·상승·하락 TOP 10 (KIS 실시간)"}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <CardBody className="pt-0">
          {/* kind / market 토글 — 펼침 후 본문 상단에 한 줄로 배치 */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
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

          {loading && !data && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              불러오는 중…
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-down/30 bg-down/10 text-down text-sm px-3 py-2">
              {error}
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
              })} · KIS (30s 캐시)`}
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
