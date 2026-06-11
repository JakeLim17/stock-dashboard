"use client";

import type { StockSnapshot } from "@/lib/types";
import { Badge } from "./ui/Badge";
import { PriceTicker } from "./PriceTicker";
import { PriceWithKrw } from "./PriceWithKrw";
import {
  changeColor,
  currencyOf,
  fmtNumber,
  fmtPercent,
  fmtSigned,
  fmtTime,
  pickPrimaryQuote,
  priceTimeLabel,
} from "@/lib/utils";

// 카드/디테일 패널 양쪽에서 재사용하는 "종목 펀더멘털 블록".
// 직접 들어있는 것:
//   - secondary 박스 (시간외 ↔ 정규장 종가 자동 스왑)
//   - 거래량 / RSI(14)
//   - 수급(외인/기관/개인 당일·5일) + 출처·신선도 라벨
//
// StockCard 본문에서 단일 source로 노출, StockDetailPanel "수급" 탭에서도 동일 컴포넌트 재사용.
// 비선택 종목 카드는 여전히 카드 본문에서 이 블록을 보고, 선택 종목은 모바일에서 카드가 숨겨지지만
// Detail "수급" 탭에서 같은 정보를 한눈에 본다.
//
// variant:
//   "card"   - 종목 카드 본문 (배경 muted/40, 좁은 폭 기준)
//   "detail" - StockDetailPanel "수급" 탭 (배경 muted/20, 넓은 폭 기준)
type Variant = "card" | "detail";

interface Props {
  snap: StockSnapshot;
  krwRate?: number | null;
  variant?: Variant;
  // KIS Open API 가 서버 설정에 활성화돼 있는지 — DashboardSnapshot.kisActive 미러.
  // true 면 "분 단위 실시간은 KIS API 필요" 안내 문구를 숨긴다.
  kisActive?: boolean;
}

export function StockFundamentalsBlock({
  snap,
  krwRate,
  variant = "card",
  kisActive = false,
}: Props) {
  const { meta, quote, tech, flow } = snap;
  const { secondary } = pickPrimaryQuote(quote);
  const currency = currencyOf(meta.code, meta.currency);
  const isDetail = variant === "detail";

  return (
    <div className={isDetail ? "space-y-4" : "space-y-4"}>
      {/* 부연 박스 — 시간외 거래 또는 정규장 종가. 카드/디테일 동일 노출. */}
      {secondary && (
        <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-3">
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <Badge variant={secondary.active ? "good" : "neutral"} size="sm">
                {secondary.label}
                {secondary.active ? " · 거래중" : ""}
              </Badge>
              {secondary.time && (
                <span className="text-muted-foreground tabular">
                  {secondary.isExtended
                    ? fmtTime(secondary.time)
                    : priceTimeLabel(secondary.time)}
                </span>
              )}
            </div>
            {secondary.isExtended && secondary.volume != null && (
              <div className="text-[11px] text-muted-foreground tabular">
                시간외 거래량 {fmtNumber(secondary.volume)}
              </div>
            )}
          </div>
          <div className="text-right">
            <div
              className={`text-base font-semibold ${
                secondary.isExtended
                  ? changeColor(secondary.changeRate)
                  : "text-muted-foreground"
              }`}
            >
              <PriceTicker
                value={secondary.price}
                decimals={currency === "USD" ? 2 : 0}
              />
            </div>
            {currency === "USD" && (
              <div className="mt-0.5">
                <PriceWithKrw
                  price={secondary.price}
                  currency={currency}
                  krwRate={krwRate ?? null}
                  size="xs"
                />
              </div>
            )}
            <div
              className={`tabular text-[11px] ${
                secondary.isExtended
                  ? changeColor(secondary.changeRate)
                  : "text-muted-foreground"
              }`}
            >
              {fmtSigned(secondary.changeAbs)} ({fmtPercent(secondary.changeRate)})
            </div>
          </div>
        </div>
      )}

      {/* 거래량 / RSI(14) */}
      <div
        className={`grid grid-cols-2 gap-x-4 gap-y-2 text-sm ${
          isDetail ? "" : "border-t border-border pt-3"
        }`}
      >
        <Row label="거래량" value={fmtNumber(quote.volume)} />
        <Row
          label="RSI(14)"
          value={tech.rsi14 != null ? tech.rsi14.toFixed(0) : "—"}
        />
      </div>

      {/* 수급 — 외인/기관/개인 당일 + 5일 누적 + 출처 */}
      <FlowSection flow={flow} variant={variant} kisActive={kisActive} />

      {/* 프로그램 매매 — KIS 활성 시 종목별 차익/비차익. 데이터 없으면 미노출. */}
      {snap.programTrade && (
        <ProgramTradeSection program={snap.programTrade} variant={variant} />
      )}

      {/* 공매도 잔고 — KIS 활성 시. detail 변형에만 줄 노출, card에서는 헤더 배지로 대체.
          여기서는 detail 한정으로 한 줄 노출. */}
      {variant === "detail" && snap.shortBalance && (
        <ShortBalanceSection short={snap.shortBalance} />
      )}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: React.ReactNode;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular font-medium">{value}</span>
    </div>
  );
}

function flowLabel(v: number | null | undefined): string {
  if (v == null) return "—";
  const eok = v / 1e8;
  const sign = eok > 0 ? "+" : "";
  return `${sign}${eok.toFixed(0)}억`;
}

function flowLabel5d(v: number | null | undefined): string {
  if (v == null) return "—";
  const eok = Math.round(v / 1e8);
  const sign = eok > 0 ? "+" : "";
  return `${sign}${eok.toLocaleString("ko-KR")}`;
}

function freshnessLabel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "방금 전";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "방금 전";
  if (min < 60) return `조회 ${min}분 전`;
  const hr = Math.round(min / 60);
  return `조회 ${hr}시간 전`;
}

function ProgramTradeSection({
  program,
  variant,
}: {
  program: import("@/lib/types").ProgramTradeData;
  variant: Variant;
}) {
  const isDetail = variant === "detail";
  const fresh = freshnessLabel(program.fetchedAt);
  const totalLabel = flowLabel(program.totalNet);
  const arbLabel = flowLabel(program.arbitrageNet);
  const nabLabel = flowLabel(program.nonArbitrageNet);
  return (
    <div
      className={
        isDetail
          ? "rounded-lg border border-border bg-muted/20 p-3 space-y-1.5"
          : "border-t border-border pt-3 space-y-1.5"
      }
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
          프로그램 매매 (당일 누적, 억)
        </span>
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
          <span>{fresh}</span>
          <span>KIS</span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">합계</span>
        <span
          className={`tabular font-semibold ${
            program.totalNet != null ? changeColor(program.totalNet) : ""
          }`}
        >
          {totalLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] tabular">
        <div className="flex items-center justify-between rounded px-2 py-1 bg-muted/40">
          <span className="text-muted-foreground">차익</span>
          <span
            className={
              program.arbitrageNet != null ? changeColor(program.arbitrageNet) : ""
            }
          >
            {arbLabel}
          </span>
        </div>
        <div className="flex items-center justify-between rounded px-2 py-1 bg-muted/40">
          <span className="text-muted-foreground">비차익</span>
          <span
            className={
              program.nonArbitrageNet != null
                ? changeColor(program.nonArbitrageNet)
                : ""
            }
          >
            {nabLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function ShortBalanceSection({
  short,
}: {
  short: import("@/lib/types").ShortBalanceData;
}) {
  const ratioPct = short.ratio != null ? (short.ratio * 100).toFixed(2) : "—";
  const qty =
    short.qty != null ? short.qty.toLocaleString("ko-KR") : "—";
  const asOf =
    short.asOf != null
      ? new Date(short.asOf).toLocaleDateString("ko-KR", {
          month: "2-digit",
          day: "2-digit",
        })
      : null;
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
          공매도 잔고
        </span>
        <span className="text-[10px] text-muted-foreground">
          {asOf ? `기준 ${asOf} · ` : ""}KIS
        </span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">잔고 비율</span>
        <span className="tabular font-semibold">{ratioPct}%</span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular">
        <span>잔고 수량</span>
        <span>{qty}</span>
      </div>
    </div>
  );
}

function flowSubtitle(source: import("@/lib/types").FlowData["source"]): string {
  if (source === "kis") return "수급 (당일 누적 · 거의 실시간, 억)";
  if (source === "kis-unavailable") return "수급 (KIS 일시 실패)";
  return "수급 (당일 누적 · 종일치, 억)";
}

function flowSourceLabel(source: import("@/lib/types").FlowData["source"]): string {
  if (source === "kis") return "KIS 실시간";
  if (source === "kis-unavailable") return "—";
  if (source === "naver") return "네이버";
  return "mock";
}

function FlowSection({
  flow,
  variant,
  kisActive,
}: {
  flow: import("@/lib/types").FlowData;
  variant: Variant;
  kisActive?: boolean;
}) {
  const cells: Array<{
    label: string;
    value: number | null | undefined;
  }> = [
    { label: "외인", value: flow.foreignNet },
    { label: "기관", value: flow.institutionNet },
    { label: "개인", value: flow.individualNet },
  ];
  const has5d =
    flow.foreignNet5d != null ||
    flow.institutionNet5d != null ||
    flow.individualNet5d != null;
  const fresh = flow.fetchedAt ? freshnessLabel(flow.fetchedAt) : null;
  const isDetail = variant === "detail";

  return (
    <div
      className={
        isDetail
          ? "rounded-lg border border-border bg-muted/20 p-3 space-y-2"
          : "border-t border-border pt-3 space-y-2"
      }
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
          {flowSubtitle(flow.source)}
        </span>
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
          {fresh && <span>{fresh}</span>}
          {flow.source && <span>{flowSourceLabel(flow.source)}</span>}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        {cells.map((c) => (
          <div
            key={c.label}
            className={`rounded-md px-2 py-1.5 text-center ${
              isDetail
                ? "bg-background border border-border"
                : "bg-muted/40"
            }`}
          >
            <div className="text-[10px] text-muted-foreground">{c.label}</div>
            <div
              className={`tabular font-semibold ${
                c.value != null ? changeColor(c.value) : ""
              }`}
            >
              {flowLabel(c.value)}
            </div>
          </div>
        ))}
      </div>
      {has5d && flow.source !== "kis-unavailable" && (
        <div className="text-[11px] text-muted-foreground tabular leading-snug">
          <span className="mr-1">5일:</span>
          외인 {flowLabel5d(flow.foreignNet5d)} / 기관{" "}
          {flowLabel5d(flow.institutionNet5d)} / 개인{" "}
          {flowLabel5d(flow.individualNet5d)} 억
        </div>
      )}
      {/* KIS 일시 실패 안내 — 네이버 응답은 토스/KRX 와 단위·부호 mismatch (사용자 보고)
          가 확인돼 일시 비표시. 잘못된 숫자보다 빈 표시가 안전. */}
      {flow.source === "kis-unavailable" && (
        <div className="text-[11px] text-warn leading-snug">
          ⚠ KIS 데이터 일시 실패 — 잠시 후 자동 재시도. (토스/KRX 와 정합 보장 위해 비표시)
        </div>
      )}
      {/* "분 단위 실시간은 KIS API 필요" 안내 — KIS 가 active 하면 의미 없는 안내라 항상 미노출.
          mock/naver 출처일 때만 (현재는 거의 발생 안 함). */}
      {!kisActive &&
        flow.source !== "kis" &&
        flow.source !== "kis-unavailable" && (
          <div className="text-[10px] text-muted-foreground/80 leading-snug">
            ※ 일별 누적값. 분 단위 실시간은 KIS API 필요.
          </div>
        )}
    </div>
  );
}
