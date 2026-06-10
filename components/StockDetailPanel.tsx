"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { NewsItem, StockSnapshot } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { SignalDetailBadges } from "./SignalDetailBadges";
import { RiskBadge } from "./RiskBadge";
import { OpportunityBadge } from "./OpportunityBadge";
import { MarketAlertBadge } from "./MarketAlertBadge";
import { VolatilityBadge } from "./VolatilityBadge";
import { PredictionPanel } from "./PredictionPanel";
import { ConsensusPanel } from "./ConsensusPanel";
import { StockFundamentalsBlock } from "./StockFundamentalsBlock";
import { fmtRelative } from "@/lib/utils";

import {
  ExternalLink,
  LineChart,
  ScrollText,
  Users,
  Newspaper,
} from "lucide-react";

// 선택된 종목 1개의 디테일 패널 — 탭 구조 [예측 | 컨센서스 | 수급 | 뉴스].
//   - PredictionPanel + ConsensusPanel을 한 카드 안에 통합
//   - "수급" 탭은 카드의 펀더멘털 블록(시간외/거래량/RSI/외인·기관·개인 당일·5일)을 흡수해
//     모바일에서 선택 종목 카드가 숨겨져도 정보 손실이 없도록 한다.
//   - "뉴스" 탭은 종목 한정 24시간 뉴스.
//
// 부모(DashboardClient)에서 활성 탭을 제어할 수 있도록 ref + jumpToPrediction 노출.
// PredictionHero 클릭 시 부모가 ref로 "예측" 탭으로 전환하고 스크롤한다.

export type DetailTabKey =
  | "prediction"
  | "consensus"
  | "flow"
  | "news";

export interface StockDetailPanelHandle {
  jumpTo: (tab: DetailTabKey) => void;
}

interface Props {
  snap?: StockSnapshot | null;
  // 종목 관련 뉴스(전체 뉴스 배열). 내부에서 24h + 종목 매칭 필터링.
  allNews: NewsItem[];
  // USDKRW 환율 — USD 종목 예측 가격(SL/TP1/TP2/진입) 원화 병기에 사용. 없으면 보조 표시 생략.
  krwRate?: number | null;
}

const TAB_META: Record<
  DetailTabKey,
  { label: string; icon: React.ReactNode }
> = {
  prediction: { label: "예측", icon: <LineChart className="h-3.5 w-3.5" /> },
  consensus: { label: "컨센서스", icon: <Users className="h-3.5 w-3.5" /> },
  flow: { label: "수급", icon: <ScrollText className="h-3.5 w-3.5" /> },
  news: { label: "뉴스", icon: <Newspaper className="h-3.5 w-3.5" /> },
};

export const StockDetailPanel = forwardRef<StockDetailPanelHandle, Props>(
  function StockDetailPanel({ snap, allNews, krwRate }, ref) {
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
              <VolatilityBadge assessment={a.volatility} size="sm" />
              <OpportunityBadge assessment={a.externalOpportunity} size="sm" />
              <RiskBadge assessment={a.externalRisk} size="sm" />
              <MarketAlertBadge alert={snap.quote.marketAlert} size="sm" />
            </div>
            <p className="text-sm font-semibold leading-snug mt-2">
              {verdict.headline}
            </p>
          </div>
          {/* 탭 — 판단에 필요한 예측/컨센서스/수급/뉴스만 남겨 화면을 단순화. */}
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5 self-start">
            {(Object.keys(TAB_META) as DetailTabKey[])
              .map((k) => {
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
              krwRate={krwRate}
            />
          )}
          {tab === "consensus" && <ConsensusPanel snap={snap} embedded />}
          {tab === "flow" && <FlowTab snap={snap} krwRate={krwRate} />}
          {tab === "news" && <NewsTab snap={snap} allNews={allNews} />}
        </CardBody>
      </Card>
      </div>
    );
  }
);

// 수급 탭 — 카드의 펀더멘털 블록(시간외/거래량/RSI/외인·기관·개인 당일·5일·출처)을 그대로 흡수.
// 모바일에서 선택 종목 카드가 hidden 되더라도 이 탭에서 모든 데이터 확인 가능.
function FlowTab({
  snap,
  krwRate,
}: {
  snap: StockSnapshot;
  krwRate?: number | null;
}) {
  const isKisLive = snap.flow.source === "kis";
  return (
    <div className="space-y-3">
      <StockFundamentalsBlock snap={snap} krwRate={krwRate} variant="detail" />
      <p className="text-[11px] text-muted-foreground/90 leading-snug">
        {isKisLive
          ? "※ KIS Open API 거의 실시간 (당일 누적 · 분~초 단위 갱신). 프로그램 매매·공매도도 함께 노출."
          : "※ 일별 누적 데이터입니다. 실시간 외인·프로그램 매매는 KIS API가 필요합니다."}
      </p>
    </div>
  );
}

// 뉴스 탭 — 종목 한정 24시간 뉴스.
function NewsTab({
  snap,
  allNews,
}: {
  snap: StockSnapshot;
  allNews: NewsItem[];
}) {
  const { meta } = snap;
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
    <section>
      <h4 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        {meta.name} 관련 뉴스 · 24h
      </h4>
      <div className="rounded-lg border border-border bg-muted/20 p-3 max-h-96 overflow-y-auto">
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
  );
}
