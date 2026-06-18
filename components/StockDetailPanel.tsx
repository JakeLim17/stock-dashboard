"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
import { AskingPricePanel } from "./AskingPricePanel";
import { VerdictHint } from "./VerdictHint";
import { VerdictReasonLine } from "./VerdictReasonLine";
import type { RealtimeAspEntry } from "@/hooks/useRealtime";
import { fmtRelative } from "@/lib/utils";
import { isNewsRelated } from "@/lib/news/symbolKeywords";

// 한국 종목 여부 — 클라이언트에서도 쓰는 단순 정규식 판정.
// (lib/providers/naver.ts 의 isKrStock 은 server-only 라 client component에서 사용 불가.)
function isKrStockCode(code: string): boolean {
  return /^\d{6}\.K[SQ]$/.test(code);
}
import {
  ExternalLink,
  LayoutList,
  LineChart,
  ScrollText,
  Users,
  Newspaper,
} from "lucide-react";

// 선택된 종목 1개의 디테일 패널 — 탭 구조 [예측 | 컨센서스 | 수급 | 호가 | 뉴스].
//   - PredictionPanel + ConsensusPanel을 한 카드 안에 통합
//   - "수급" 탭은 카드의 펀더멘털 블록(시간외/거래량/RSI/외인·기관·개인 당일·5일)을 흡수해
//     모바일에서 선택 종목 카드가 숨겨져도 정보 손실이 없도록 한다.
//   - "호가" 탭은 KIS 활성 + 한국 종목 한정 — 10단계 호가 + 체결강도 + 최근 체결.
//   - "뉴스" 탭은 종목 한정 24시간 뉴스.
//
// 부모(DashboardClient)에서 활성 탭을 제어할 수 있도록 ref + jumpToPrediction 노출.
// PredictionHero 클릭 시 부모가 ref로 "예측" 탭으로 전환하고 스크롤한다.

export type DetailTabKey =
  | "prediction"
  | "consensus"
  | "flow"
  | "asking"
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
  // KIS Open API 활성 여부 — 펀더멘털 블록 안내 분기.
  kisActive?: boolean;
  // 모바일 모달(MobileDetailSheet) 안에서 렌더되는지 여부.
  // true 면 PredictionPanel 의 "상세 예측 보기" details 를 기본 펼침 등 모바일 친화 동작.
  mobileSheet?: boolean;
  // Phase 3 — KIS WS H0STASP0 호가 실시간. 있으면 AskingPricePanel 에 우선 표시.
  aspOverride?: RealtimeAspEntry | null;
}

const TAB_META: Record<
  DetailTabKey,
  { label: string; icon: React.ReactNode }
> = {
  prediction: { label: "예측", icon: <LineChart className="h-3.5 w-3.5" /> },
  consensus: { label: "컨센서스", icon: <Users className="h-3.5 w-3.5" /> },
  flow: { label: "수급", icon: <ScrollText className="h-3.5 w-3.5" /> },
  asking: { label: "호가", icon: <LayoutList className="h-3.5 w-3.5" /> },
  news: { label: "뉴스", icon: <Newspaper className="h-3.5 w-3.5" /> },
};

export const StockDetailPanel = forwardRef<StockDetailPanelHandle, Props>(
  function StockDetailPanel(
    { snap, allNews, krwRate, kisActive, mobileSheet = false, aspOverride },
    ref
  ) {
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
              <Badge
                variant={verdict.tone}
                size="md"
                className={verdict.tone === "sell" ? "shake-warn" : undefined}
              >
                {verdict.label}
              </Badge>
              <VerdictHint />
              <VerdictReasonLine line={verdict.reasonLine} />
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
          {/* 탭 — 호가 탭은 한국 종목에만 노출. KIS 미활성도 동일하게 노출하되 안에서 빈 메시지.
              좁은 폭(360~414px) 에서도 5탭 한 줄 안정 표시되도록:
                - 모바일: 패딩 px-2 + gap-1 + 텍스트 [11px] (5×약60px = 약300px)
                - sm 이상: 기존 px-3 + gap-1.5 + text-xs
              컨테이너는 max-w-full overflow-x-auto 로 그래도 안 맞으면 좌우 스와이프 폴백. */}
          <div className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-muted/30 p-0.5 self-start [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(Object.keys(TAB_META) as DetailTabKey[])
              .filter((k) => k !== "asking" || isKrStockCode(snap.meta.code))
              .map((k) => {
                const m = TAB_META[k];
                const active = tab === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    className={`inline-flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs px-2 sm:px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
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
              detailDefaultOpen={mobileSheet}
            />
          )}
          {tab === "consensus" && <ConsensusPanel snap={snap} embedded />}
          {tab === "flow" && (
            <FlowTab snap={snap} krwRate={krwRate} kisActive={kisActive} />
          )}
          {tab === "asking" && (
            <AskingPricePanel
              code={snap.meta.code}
              active={tab === "asking"}
              aspOverride={aspOverride}
            />
          )}
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
  kisActive,
}: {
  snap: StockSnapshot;
  krwRate?: number | null;
  kisActive?: boolean;
}) {
  const isKisLive = snap.flow.source === "kis";
  return (
    <div className="space-y-3">
      <StockFundamentalsBlock
        snap={snap}
        krwRate={krwRate}
        variant="detail"
        kisActive={kisActive}
      />
      {/* KIS active 시에는 안내 문구 자체를 노출하지 않는다 — 사용자에게 의미 없음. */}
      {!kisActive && (
        <p className="text-[11px] text-muted-foreground/90 leading-snug">
          {isKisLive
            ? "※ KIS Open API 거의 실시간 (당일 누적 · 분~초 단위 갱신). 프로그램 매매·공매도도 함께 노출."
            : "※ 일별 누적 데이터입니다. 실시간 외인·프로그램 매매는 KIS API가 필요합니다."}
        </p>
      )}
    </div>
  );
}

// 뉴스 탭 — 종목 한정 24시간 뉴스.
// - 매칭은 한·영 키워드 기반 isNewsRelated() 로 (워커A).
// - 표시는 titleKo(번역본) 우선 + 원문 작은 회색 병기 (워커B).
function NewsTab({
  snap,
  allNews,
}: {
  snap: StockSnapshot;
  allNews: NewsItem[];
}) {
  const { meta } = snap;
  const [perCodeNews, setPerCodeNews] = useState<NewsItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPerCodeNews(null);
    fetch(`/api/news?symbols=${encodeURIComponent(meta.code)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (cancelled) return;
        const items: NewsItem[] = Array.isArray(j?.items) ? j.items : [];
        setPerCodeNews(items);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPerCodeNews([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meta.code]);

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  // 종목별 fetch 결과가 도착하면 그것을 우선, 아직 없으면 snapshot.news + isNewsRelated 폴백.
  const baseNews =
    perCodeNews ??
    allNews.filter((n) => isNewsRelated(n, meta.code, meta.name));
  const news = baseNews
    .filter((n) => n.publishedAt >= cutoff)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 10);

  return (
    <section>
      <h4 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        {meta.name} 관련 뉴스 · 24h
      </h4>
      <div className="rounded-lg border border-border bg-muted/20 p-3 max-h-96 overflow-y-auto">
        {loading && news.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            뉴스 불러오는 중…
          </p>
        ) : news.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            최근 24시간 내 종목 관련 뉴스가 없습니다.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {news.map((n) => {
              // 표시 우선순위: titleKo(번역본) → title(원문).
              // 영어 원문이 따로 있을 때만 작은 회색 보조 라인으로 병기한다.
              const primaryTitle = n.titleKo || n.title;
              const showOriginal = !!n.titleKo && n.titleKo !== n.title;
              return (
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
                    <span className="flex-1 leading-snug group-hover:underline">
                      <span className="block text-sm">{primaryTitle}</span>
                      {showOriginal && (
                        <span className="block text-[11px] text-muted-foreground mt-0.5">
                          {n.title}
                        </span>
                      )}
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
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
