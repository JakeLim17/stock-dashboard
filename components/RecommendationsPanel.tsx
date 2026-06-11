"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Recommendation,
  RecommendationCategory,
  RecommendationsResponse,
  SectorTag,
} from "@/lib/types";
import { Badge } from "./ui/Badge";
import { Card, CardBody } from "./ui/Card";
import {
  ChevronDown,
  Flame,
  Plus,
  RefreshCw,
  Sparkles,
  Check,
  Target,
  Hourglass,
  Newspaper,
  AlertTriangle,
} from "lucide-react";
import {
  changeColor,
  currencyOf,
  fmtPercent,
  fmtRelative,
} from "@/lib/utils";
import { PriceWithKrw } from "./PriceWithKrw";
import { SectorLeaderBadge } from "./SectorLeaderBadge";
import { SignalMarkBadges } from "./SignalMarkBadges";
import { WATCHLIST_CANDIDATES, MARKET_INDICATORS } from "@/lib/symbols";

// 분야 대장주 메타 조회용 맵 — code → leader meta. RecommendationsPanel 카드에서 배지 렌더링에 사용.
// Recommendation 객체에 leader 정보가 없어 client-side에서 lookup.
const LEADER_META_BY_CODE = new Map<
  string,
  { isSectorLeader: true; sectorLeaderLabel?: string }
>();
for (const m of [...WATCHLIST_CANDIDATES, ...MARKET_INDICATORS]) {
  if (m.isSectorLeader) {
    LEADER_META_BY_CODE.set(m.code, {
      isSectorLeader: true,
      sectorLeaderLabel: m.sectorLeaderLabel,
    });
  }
}

interface Props {
  // 부모에서 관리하는 watchlist (관심종목 추가 시 중복 차단·이미 있음 표시에 사용)
  watchlist: string[];
  // 관심종목 추가 핸들러 — DashboardClient 의 commitWatch 와 동일 시그니처
  onAddToWatchlist: (code: string) => void;
  // 관심종목 최대 개수 (도달 시 추가 버튼 비활성화)
  maxWatch: number;
  // USDKRW 환율 — USD 종목 카드 가격 옆 원화 보조 표시. 없으면 보조 표시 생략.
  krwRate?: number | null;
}

const CATEGORY_LABEL: Record<RecommendationCategory, string> = {
  buy: "매수·분할매수 추천",
  hold: "관망·눌림목 대기",
  reduce: "비중축소 (참고)",
};

const CATEGORY_VARIANT: Record<
  RecommendationCategory,
  "good" | "warn" | "bad"
> = {
  buy: "good",
  hold: "warn",
  reduce: "bad",
};

// 대시보드 상단에 펼침 패널 형태로 노출되는 종목 추천.
// - 기본 접힘. 헤더 클릭 시 펼침.
// - 펼치면 컨텍스트 한 줄 → 섹터 탭 → 추천 카드 그리드.
// - 첫 fetch 는 ~30-50초 가능 (콘센·시장경보 미캐시), 그래서 안내 문구 추가.
// - 각 카드 하단에는 "이유 보기" 토글이 있어 펼치면 단·장기 reason / 컨센서스 / 카탈리스트 뉴스 /
//   외부 위험·시장경보를 함께 본다.
export function RecommendationsPanel({
  watchlist,
  onAddToWatchlist,
  maxWatch,
  krwRate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSector, setActiveSector] = useState<SectorTag | "ALL">("ALL");
  const [, setTick] = useState(0); // "n분 전" 표시 강제 갱신
  const abortRef = useRef<AbortController | null>(null);
  const fetchedOnce = useRef(false);

  const fetchData = useCallback(async (refresh = false) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/recommendations${refresh ? "?refresh=1" : ""}`,
        {
          cache: "no-store",
          signal: ctrl.signal,
        }
      );
      if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
      const j = (await r.json()) as RecommendationsResponse;
      setData(j);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // 펼침 시 lazy fetch — 처음 열 때 한 번만 자동 호출.
  useEffect(() => {
    if (!open) return;
    if (fetchedOnce.current) return;
    fetchedOnce.current = true;
    void fetchData(false);
  }, [open, fetchData]);

  // 언마운트 시 진행 중 fetch 정리
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // 상대 시각 라벨 갱신
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [open]);

  // 선택된 섹터가 응답에 없으면 ALL 로 보정
  useEffect(() => {
    if (!data) return;
    if (activeSector === "ALL") return;
    if (!data.sectors.includes(activeSector)) setActiveSector("ALL");
  }, [data, activeSector]);

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (activeSector === "ALL") return data.items;
    return data.items.filter((i) => i.sector === activeSector);
  }, [data, activeSector]);

  // 카테고리별로 묶기 (정렬은 이미 서버에서 끝났으므로 순서 유지)
  const grouped = useMemo(() => {
    const map: Record<RecommendationCategory, Recommendation[]> = {
      buy: [],
      hold: [],
      reduce: [],
    };
    for (const item of filtered) map[item.category].push(item);
    return map;
  }, [filtered]);

  const topCount = grouped.buy.length;
  const buildAgeLabel = data
    ? `${fmtRelative(data.generatedAt)} 기준${
        data.cached ? " · 캐시" : ""
      }`
    : null;

  return (
    <Card className="border-accent/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors rounded-2xl"
        aria-expanded={open}
      >
        <Sparkles className="h-4 w-4 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">오늘의 추천</span>
            {data ? (
              <span className="text-[11px] text-muted-foreground">
                매수 후보 {topCount}종목 · 전체 {data.items.length}종목
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {open ? "분석 중…" : "펼쳐서 추천 받기 (첫 분석 약 1분 소요)"}
              </span>
            )}
            {buildAgeLabel && (
              <span className="text-[11px] text-muted-foreground ml-1">
                · {buildAgeLabel}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <CardBody className="pt-0 space-y-3">
          {/* 컨텍스트 한 줄 + 새로고침 */}
          <div className="flex items-start gap-2 flex-wrap pt-2 border-t border-border/60">
            <div className="flex-1 min-w-0 text-xs text-muted-foreground leading-snug">
              {data ? (
                data.context.summary
              ) : loading ? (
                "오늘 시장 데이터 수집 중…"
              ) : (
                "잠시만 기다려 주세요."
              )}
            </div>
            <button
              type="button"
              onClick={() => void fetchData(true)}
              disabled={loading}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border bg-card hover:bg-muted disabled:opacity-50 transition-colors"
              title="추천 다시 분석 (캐시 무시)"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              />
              새로고침
            </button>
          </div>

          {/* 로딩/에러 */}
          {loading && !data && (
            <div className="text-xs text-muted-foreground py-6 text-center space-y-1">
              <div className="flex items-center justify-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>40여개 종목 분석 중…</span>
              </div>
              <p className="text-[11px]">
                처음 분석엔 약 1분 소요됩니다. 이후 1시간은 캐시에서 즉시 표시.
              </p>
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg border border-down/30 bg-down/10 text-down text-xs px-3 py-2">
              {error}
            </div>
          )}

          {data && (
            <>
              {/* 섹터 탭 */}
              <div className="flex flex-wrap gap-1.5">
                <SectorTab
                  active={activeSector === "ALL"}
                  onClick={() => setActiveSector("ALL")}
                  label={`전체 ${data.items.length}`}
                />
                {data.sectors.map((s) => {
                  const count = data.items.filter((i) => i.sector === s).length;
                  const favored = data.context.favorableSectors.includes(s);
                  return (
                    <SectorTab
                      key={s}
                      active={activeSector === s}
                      onClick={() => setActiveSector(s)}
                      label={`${s} ${count}`}
                      highlight={favored}
                    />
                  );
                })}
              </div>

              {/* 카테고리별 그리드 */}
              <div className="space-y-4">
                {(
                  ["buy", "hold", "reduce"] as RecommendationCategory[]
                ).map((cat) => {
                  const list = grouped[cat];
                  if (list.length === 0) return null;
                  // buy 버킷은 sub 분리 (신규 진입 / 눌림 분할 매수)
                  if (cat === "buy") {
                    const newEntry = list.filter(
                      (r) => r.subCategory === "new_entry"
                    );
                    const scaleIn = list.filter(
                      (r) => r.subCategory === "scale_in"
                    );
                    const others = list.filter(
                      (r) =>
                        r.subCategory !== "new_entry" &&
                        r.subCategory !== "scale_in"
                    );
                    return (
                      <section key={cat} className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Badge variant={CATEGORY_VARIANT[cat]} size="sm">
                            {CATEGORY_LABEL[cat]}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {list.length}종목
                          </span>
                        </div>
                        {newEntry.length > 0 && (
                          <BuySubBlock
                            icon={
                              <Target className="h-3 w-3 text-up" />
                            }
                            label="신규 진입"
                            description="단·장기 모두 양호"
                            list={newEntry}
                            watchSet={watchSet}
                            watchlist={watchlist}
                            maxWatch={maxWatch}
                            onAddToWatchlist={onAddToWatchlist}
                            krwRate={krwRate}
                          />
                        )}
                        {scaleIn.length > 0 && (
                          <BuySubBlock
                            icon={
                              <Hourglass className="h-3 w-3 text-warn" />
                            }
                            label="눌림 분할 매수"
                            description="단기 과열·차익실현 + 장기 양호"
                            list={scaleIn}
                            watchSet={watchSet}
                            watchlist={watchlist}
                            maxWatch={maxWatch}
                            onAddToWatchlist={onAddToWatchlist}
                            krwRate={krwRate}
                          />
                        )}
                        {others.length > 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                            {others.map((rec) => (
                              <RecommendationCard
                                key={rec.code}
                                rec={rec}
                                inWatchlist={watchSet.has(rec.code)}
                                disabled={
                                  !watchSet.has(rec.code) &&
                                  watchlist.length >= maxWatch
                                }
                                onAdd={() => onAddToWatchlist(rec.code)}
                                krwRate={krwRate}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  }
                  return (
                    <section key={cat} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={CATEGORY_VARIANT[cat]} size="sm">
                          {CATEGORY_LABEL[cat]}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {list.length}종목
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                        {list.map((rec) => (
                          <RecommendationCard
                            key={rec.code}
                            rec={rec}
                            inWatchlist={watchSet.has(rec.code)}
                            disabled={
                              !watchSet.has(rec.code) &&
                              watchlist.length >= maxWatch
                            }
                            onAdd={() => onAddToWatchlist(rec.code)}
                            krwRate={krwRate}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    이 섹터에 해당하는 종목이 없습니다.
                  </div>
                )}
              </div>

              {Object.keys(data.errors).length > 0 && (
                <details className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                  <summary className="cursor-pointer">
                    분석 실패 종목 ({Object.keys(data.errors).length})
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(data.errors).map(([k, v]) => (
                      <li key={k}>
                        <code className="text-foreground">{k}</code>: {v}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </CardBody>
      )}
    </Card>
  );
}

function SectorTab({
  label,
  active,
  highlight,
  onClick,
}: {
  label: string;
  active: boolean;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "bg-foreground text-background border-foreground"
          : highlight
          ? "bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"
          : "bg-card border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function RecommendationCard({
  rec,
  inWatchlist,
  disabled,
  onAdd,
  krwRate,
}: {
  rec: Recommendation;
  inWatchlist: boolean;
  disabled: boolean;
  onAdd: () => void;
  krwRate?: number | null;
}) {
  // rec.currency는 string("USD"/"KRW")라 캐스팅하지 않고 currencyOf로 정규화.
  const explicit =
    rec.currency === "USD" || rec.currency === "KRW" ? rec.currency : undefined;
  const currency = currencyOf(rec.code, explicit);

  // "왜 이 종목인가" 펼침. 기본 접힘 — 카드가 그리드라 모두 펼치면 길어진다.
  // 사용자가 관심 가는 카드만 펼쳐서 reason을 확인하는 패턴.
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 space-y-2 hover:border-foreground/20 transition-colors">
      {/* 상단: 종목명·티커 + verdict 배지 + 현재가/등락률 */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold truncate">{rec.name}</span>
            {/* 분야 대장주 배지 — 작은 카드라 xs 사이즈 */}
            <SectorLeaderBadge
              meta={LEADER_META_BY_CODE.get(rec.code)}
              size="xs"
            />
            <Badge
              variant={rec.verdict.tone}
              size="sm"
              className={rec.verdict.tone === "sell" ? "shake-warn" : undefined}
            >
              {rec.verdict.label}
            </Badge>
          </div>
          <div className="text-[10px] text-muted-foreground tabular mt-0.5">
            {rec.code} · {rec.sector}
          </div>
          {/* 시그널 마크 — 신고가/거래량폭발/외인픽 등 한눈에 보이는 신호 (작은 카드라 xs) */}
          {rec.signalMarks && rec.signalMarks.length > 0 && (
            <SignalMarkBadges
              marks={rec.signalMarks}
              size="xs"
              className="mt-1"
            />
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold tabular">
            {currency === "USD"
              ? `$${rec.price.toFixed(2)}`
              : rec.price.toLocaleString("ko-KR")}
          </div>
          {/* USD 종목 — 환율 적용 원화 보조. 없으면 자동 생략. */}
          {currency === "USD" && (
            <div className="text-[10px] leading-tight">
              <PriceWithKrw
                price={rec.price}
                currency={currency}
                krwRate={krwRate ?? null}
                prefix=""
                size="xs"
              />
            </div>
          )}
          <div className={`text-[11px] tabular ${changeColor(rec.changeRate)}`}>
            {fmtPercent(rec.changeRate)}
          </div>
        </div>
      </div>

      {/* 한 줄 헤드라인 */}
      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
        {rec.headline}
      </p>

      {/* 단·장기 미니 배지 — 한눈에 두 시그널 차이 인지 (P0 권고) */}
      <div className="flex items-center gap-1 flex-wrap">
        <SignalBadge label="단기" signal={rec.shortTerm.signal} />
        <SignalBadge label="장기" signal={rec.longTerm.signal} />
      </div>

      {/* 점수 미니바: 매수우위 / 과열도 + 보너스 표기 */}
      <div className="grid grid-cols-2 gap-2">
        <MiniScoreBar
          label="매수우위"
          value={rec.buyScore}
          variantHigh="up"
          bonus={rec.contextBonus}
        />
        <MiniScoreBar
          label={
            <span className="inline-flex items-center gap-0.5">
              <Flame className="h-2.5 w-2.5" />
              과열
            </span>
          }
          value={rec.heatScore}
          variantHigh="warn"
        />
      </div>

      {/* "이유 보기" 펼친 영역 */}
      {expanded && <CardReasonSection rec={rec} currency={currency} />}

      {/* 하단: 펼침 토글 + 관심종목 추가 버튼 */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
          {expanded ? "이유 접기" : "왜 이 종목인가"}
        </button>
        {inWatchlist ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground px-2 py-1 rounded-md border border-border bg-muted/40">
            <Check className="h-3 w-3" />
            관심종목
          </span>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={disabled ? "관심종목이 가득 찼습니다" : "관심종목에 추가"}
          >
            <Plus className="h-3 w-3" />
            추가
          </button>
        )}
      </div>
    </div>
  );
}

// 카드 펼침 영역 — analyzer가 이미 만든 단·장기 reasons + consensus + 카탈리스트 뉴스 +
// 외부 위험 드라이버 + 시장경보를 한 카드 안에 정리한다. 새 분석은 추가하지 않고
// 이미 계산된 값만 노출.
function CardReasonSection({
  rec,
  currency,
}: {
  rec: Recommendation;
  currency: "USD" | "KRW";
}) {
  const stReasons = rec.shortTerm.reasons ?? [];
  const ltReasons = rec.longTerm.reasons ?? [];
  const cs = rec.consensusSnap;
  const news = rec.catalystNews ?? [];
  const risk = rec.externalRisk;
  const riskDrivers = (risk?.drivers ?? []).slice(0, 2);
  const showRisk = risk && risk.score >= 25 && riskDrivers.length > 0;
  const alert = rec.marketAlert;

  const hasConsensus =
    cs && (cs.targetMean != null || cs.opinionLabel || cs.upsidePercent != null);

  return (
    <div className="border-t border-border/50 pt-2 space-y-2">
      <p className="text-[10px] font-semibold text-foreground/80">
        왜 이 종목인가
      </p>

      <ReasonBlock title="단기" reasons={stReasons} />
      <ReasonBlock title="장기" reasons={ltReasons} />

      {hasConsensus && (
        <div className="flex items-start gap-1.5 text-[10px] leading-snug">
          <Target className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
          <span className="text-foreground/85">
            <span className="text-muted-foreground">목표가</span>{" "}
            {cs!.targetMean != null
              ? currency === "USD"
                ? `$${cs!.targetMean.toFixed(2)}`
                : cs!.targetMean.toLocaleString("ko-KR")
              : "—"}
            {cs!.upsidePercent != null && (
              <span
                className={`ml-1 ${
                  cs!.upsidePercent >= 0 ? "text-up" : "text-down"
                }`}
              >
                ({cs!.upsidePercent >= 0 ? "+" : ""}
                {(cs!.upsidePercent * 100).toFixed(1)}%)
              </span>
            )}
            {cs!.opinionLabel && (
              <span className="ml-1 text-muted-foreground">
                · {cs!.opinionLabel}
                {cs!.analystCount != null && cs!.analystCount > 0
                  ? ` ${cs!.analystCount}명`
                  : ""}
              </span>
            )}
          </span>
        </div>
      )}

      {news.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold text-foreground/80 flex items-center gap-1">
            <Newspaper className="h-3 w-3" />
            최근 카탈리스트
          </p>
          <ul className="space-y-0.5">
            {news.map((n, i) => (
              <li
                key={i}
                className="text-[10px] text-foreground/85 leading-snug line-clamp-2"
              >
                · {n.title}
                <span className="ml-1 text-[9px] text-muted-foreground">
                  ({n.source})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showRisk && (
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold text-down/85 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            위험 신호
          </p>
          <ul className="space-y-0.5">
            {riskDrivers.map((d, i) => (
              <li
                key={i}
                className="text-[10px] text-foreground/85 leading-snug line-clamp-2"
              >
                · [{d.category}] {d.headline}
              </li>
            ))}
          </ul>
        </div>
      )}

      {alert && (
        <p className="text-[10px] text-warn flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          시장경보 · {alert.label}
        </p>
      )}
    </div>
  );
}

// 단/장기 reasons를 한 블록으로 — analyzer가 만든 최대 3줄 메시지를 그대로 노출.
function ReasonBlock({
  title,
  reasons,
}: {
  title: string;
  reasons: string[];
}) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-0.5">{title}</p>
      <ul className="space-y-0.5">
        {reasons.slice(0, 3).map((r, i) => (
          <li
            key={i}
            className="text-[10px] text-foreground/85 leading-snug"
          >
            · {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniScoreBar({
  label,
  value,
  variantHigh,
  bonus,
}: {
  label: React.ReactNode;
  value: number;
  variantHigh: "up" | "warn";
  bonus?: number;
}) {
  // variantHigh="up"  : 높은 값이 좋음 (매수우위)
  // variantHigh="warn": 높은 값이 위험 (과열)
  const color =
    variantHigh === "up"
      ? value >= 65
        ? "bg-up"
        : value <= 35
        ? "bg-down"
        : "bg-muted-foreground"
      : value >= 65
      ? "bg-warn"
      : value <= 35
      ? "bg-up"
      : "bg-muted-foreground";

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
        <span>{label}</span>
        <span className="tabular font-medium text-foreground">
          {value}
          {bonus !== undefined && bonus !== 0 && (
            <span
              className={`ml-1 text-[10px] ${
                bonus > 0 ? "text-up" : "text-down"
              }`}
              title="섹터 컨텍스트 가산점"
            >
              {bonus > 0 ? "+" : ""}
              {bonus}
            </span>
          )}
        </span>
      </div>
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// buy 버킷을 sub로 묶어서 노출하는 블록.
// 예: 신규 진입(NEW_ENTRY) / 눌림 분할 매수(SCALE_IN)
function BuySubBlock({
  icon,
  label,
  description,
  list,
  watchSet,
  watchlist,
  maxWatch,
  onAddToWatchlist,
  krwRate,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  list: Recommendation[];
  watchSet: Set<string>;
  watchlist: string[];
  maxWatch: number;
  onAddToWatchlist: (code: string) => void;
  krwRate?: number | null;
}) {
  return (
    <div className="space-y-1.5 pl-2 border-l-2 border-border/60">
      <div className="flex items-center gap-1.5 flex-wrap">
        {icon}
        <span className="text-xs font-semibold text-foreground/90">{label}</span>
        <span className="text-[10px] text-muted-foreground">
          · {description} · {list.length}종목
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {list.map((rec) => (
          <RecommendationCard
            key={rec.code}
            rec={rec}
            inWatchlist={watchSet.has(rec.code)}
            disabled={!watchSet.has(rec.code) && watchlist.length >= maxWatch}
            onAdd={() => onAddToWatchlist(rec.code)}
            krwRate={krwRate}
          />
        ))}
      </div>
    </div>
  );
}

// 단/장기 시그널 미니 배지 — 한눈에 두 시그널 차이 인지.
// 단기 SELL + 장기 BUY 같은 SCALE_IN 케이스에서 두 시그널을 분명히 보여준다.
function SignalBadge({
  label,
  signal,
}: {
  label: string;
  signal: "BUY" | "ADD" | "HOLD" | "WATCH" | "SELL";
}) {
  const tone: Record<typeof signal, string> = {
    BUY: "bg-up/15 text-up border-up/30",
    ADD: "bg-up/10 text-up border-up/20",
    HOLD: "bg-muted text-muted-foreground border-border",
    WATCH: "bg-warn/10 text-warn border-warn/30",
    SELL: "bg-down/10 text-down border-down/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md border tabular ${tone[signal]}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{signal}</span>
    </span>
  );
}
