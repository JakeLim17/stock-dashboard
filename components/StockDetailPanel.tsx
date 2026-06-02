"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { NewsItem, StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { SignalDetailBadges } from "./SignalDetailBadges";
import { RiskBadge } from "./RiskBadge";
import { MarketAlertBadge } from "./MarketAlertBadge";
import { PredictionPanel } from "./PredictionPanel";
import { ConsensusPanel } from "./ConsensusPanel";
import { changeColor, fmtNumber, fmtRelative } from "@/lib/utils";
import { ExternalLink, LineChart, ScrollText, Users } from "lucide-react";

// 선택된 종목 1개의 디테일 패널 — 탭 구조 [예측 | 컨센서스 | 수급·뉴스].
//   - PredictionPanel + ConsensusPanel을 한 카드 안에 통합
//   - 수급은 외인/기관/개인 당일·5일, 뉴스는 종목 한정 24h
//
// 부모(DashboardClient)에서 활성 탭을 제어할 수 있도록 ref + jumpToPrediction 노출.
// PredictionHero 클릭 시 부모가 ref로 "예측" 탭으로 전환하고 스크롤한다.

export type DetailTabKey = "prediction" | "consensus" | "flow-news";

export interface StockDetailPanelHandle {
  jumpTo: (tab: DetailTabKey) => void;
}

interface Props {
  snap?: StockSnapshot | null;
  // 종목 관련 뉴스(전체 뉴스 배열). 내부에서 24h + 종목 매칭 필터링.
  allNews: NewsItem[];
}

const TAB_META: Record<
  DetailTabKey,
  { label: string; icon: React.ReactNode }
> = {
  prediction: { label: "예측", icon: <LineChart className="h-3.5 w-3.5" /> },
  consensus: { label: "컨센서스", icon: <Users className="h-3.5 w-3.5" /> },
  "flow-news": { label: "수급·뉴스", icon: <ScrollText className="h-3.5 w-3.5" /> },
};

export const StockDetailPanel = forwardRef<StockDetailPanelHandle, Props>(
  function StockDetailPanel({ snap, allNews }, ref) {
    const [tab, setTab] = useState<DetailTabKey>("prediction");
    const rootRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(
      ref,
      () => ({
        jumpTo: (next) => {
          setTab(next);
          rootRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        },
      }),
      []
    );

    if (!snap) {
      return (
        <div ref={rootRef}>
          <Card>
            <CardBody>
              <p className="text-sm text-muted-foreground">
                종목을 선택하면 상세 분석을 표시합니다.
              </p>
            </CardBody>
          </Card>
        </div>
      );
    }

    const a = snap.analysis;
    const verdict = a.verdict;

    return (
      <div ref={rootRef}>
      <Card>
        <CardHeader className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle>{snap.meta.name} 상세 분석</CardTitle>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Badge variant={verdict.tone} size="md">
                {verdict.label}
              </Badge>
              <SignalDetailBadges
                short={a.shortTerm.signal}
                long={a.longTerm.signal}
                title={verdict.detail}
              />
              <RiskBadge assessment={a.externalRisk} size="sm" />
              <MarketAlertBadge alert={snap.quote.marketAlert} size="sm" />
            </div>
            <p className="text-sm font-semibold leading-snug mt-2">
              {verdict.headline}
            </p>
          </div>
          {/* 탭 */}
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5 self-start">
            {(Object.keys(TAB_META) as DetailTabKey[]).map((k) => {
              const m = TAB_META[k];
              const active = tab === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
                    active
                      ? "bg-foreground text-background font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.icon}
                  {m.label}
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardBody>
          {tab === "prediction" && (
            <PredictionPanel
              snaps={[snap]}
              selectedCode={snap.meta.code}
              embedded
            />
          )}
          {tab === "consensus" && <ConsensusPanel snap={snap} embedded />}
          {tab === "flow-news" && (
            <FlowNewsTab snap={snap} allNews={allNews} />
          )}
        </CardBody>
      </Card>
      </div>
    );
  }
);

// 수급·뉴스 탭 — 외인/기관/개인 당일·5일 + 종목 한정 뉴스 24h.
function FlowNewsTab({
  snap,
  allNews,
}: {
  snap: StockSnapshot;
  allNews: NewsItem[];
}) {
  const { flow, meta } = snap;
  const has5d =
    flow.foreignNet5d != null ||
    flow.institutionNet5d != null ||
    flow.individualNet5d != null;

  // 종목 관련 24시간 뉴스 — symbol 매칭 또는 제목에 종목명 포함.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const news = allNews
    .filter((n) => {
      if (n.publishedAt < cutoff) return false;
      if (n.symbol === meta.code) return true;
      if ((n.title || "").includes(meta.name)) return true;
      return false;
    })
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 10);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* 수급 */}
      <section>
        <h4 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          수급 (단위: 억원)
          {flow.source && (
            <span className="ml-auto text-[10px] normal-case tracking-normal">
              {flow.source === "naver"
                ? "네이버"
                : flow.source === "kis"
                  ? "KIS"
                  : "mock"}
            </span>
          )}
        </h4>
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
          <FlowBlock
            label="당일"
            cells={[
              { label: "외인", value: flow.foreignNet },
              { label: "기관", value: flow.institutionNet },
              { label: "개인", value: flow.individualNet },
            ]}
          />
          {has5d && (
            <FlowBlock
              label="5일 누적"
              cells={[
                { label: "외인", value: flow.foreignNet5d },
                { label: "기관", value: flow.institutionNet5d },
                { label: "개인", value: flow.individualNet5d },
              ]}
            />
          )}
        </div>
      </section>

      {/* 뉴스 24h */}
      <section>
        <h4 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          {meta.name} 관련 뉴스 · 24h
        </h4>
        <div className="rounded-lg border border-border bg-muted/20 p-3 max-h-72 overflow-y-auto">
          {news.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              최근 24시간 내 종목 관련 뉴스가 없습니다.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {news.map((n) => (
                <li
                  key={n.id}
                  className="border-b border-border/60 pb-2 last:border-0 last:pb-0"
                >
                  <a
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-2"
                  >
                    <span className="flex-1 text-sm leading-snug group-hover:underline">
                      {n.title}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </a>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                    <span>{n.source}</span>
                    <span>·</span>
                    <span>{fmtRelative(n.publishedAt)}</span>
                    {n.sentiment === "positive" && (
                      <Badge variant="good" size="sm">
                        호재
                      </Badge>
                    )}
                    {n.sentiment === "negative" && (
                      <Badge variant="bad" size="sm">
                        악재
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function FlowBlock({
  label,
  cells,
}: {
  label: string;
  cells: { label: string; value: number | null | undefined }[];
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-1.5">{label}</div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        {cells.map((c) => (
          <div
            key={c.label}
            className="rounded-md bg-background border border-border px-2 py-1.5 text-center"
          >
            <div className="text-[10px] text-muted-foreground">{c.label}</div>
            <div
              className={`tabular font-semibold ${
                c.value != null ? changeColor(c.value) : ""
              }`}
            >
              {flowEokLabel(c.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function flowEokLabel(v: number | null | undefined): string {
  if (v == null) return "—";
  const eok = v / 1e8;
  // 절대값이 1조 이상이면 콤마 표기, 그 외 정수 억 표시
  if (Math.abs(eok) >= 10000) {
    const sign = eok > 0 ? "+" : "";
    return `${sign}${fmtNumber(Math.round(eok), 0)}억`;
  }
  const sign = eok > 0 ? "+" : "";
  return `${sign}${eok.toFixed(0)}억`;
}
