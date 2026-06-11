import "server-only";
import {
  fetchQuotesBatch,
  fetchHistorical,
  computeTech,
  fetchFlowOrMock,
  fetchAllNews,
} from "./providers";
import { getConsensusBundle } from "./providers/consensusCache";
import { getMarketAlertCached } from "./providers/marketAlertCache";
import { isKrStock } from "./providers/naver";
import { analyze, evaluateSignalMarks, pickTopSignalMarks } from "./analyzer";
import { assessNewsRisk, emptyRiskAssessment } from "./news/riskScore";
import { MARKET_INDICATORS, WATCHLIST_CANDIDATES } from "./symbols";
import { buildConsensusSnap, pickCatalystNews } from "./recommendationExtras";
import type {
  ActionRecommendation,
  MarketContext,
  NewsItem,
  Recommendation,
  RecommendationCategory,
  RecommendationSubCategory,
  RecommendationsResponse,
  SectorTag,
  SymbolMeta,
} from "./types";

// 분석 결과(verdict.action) → 사용자용 3개 버킷 매핑.
//  buy   : 신규 진입·분할 매수 추천
//  hold  : 관망·눌림목·짧게 매매 (참고 매수)
//  reduce: 비중 축소
const CATEGORY_BY_ACTION: Record<ActionRecommendation, RecommendationCategory> = {
  NEW_ENTRY: "buy",
  SCALE_IN: "buy",
  HOLD_WAIT: "hold",
  HOLD: "hold",
  AVOID: "hold",
  SHORT_TRADE: "hold",
  TRIM: "reduce",
  REDUCE: "reduce",
};

// buy 버킷 내 sub 분류 — UI에서 "🎯 신규 진입" / "⏳ 눌림 분할 매수"로 분리 노출.
//   NEW_ENTRY → new_entry  (단·장기 모두 양호한 신규 진입)
//   SCALE_IN  → scale_in   (단기 약세 + 장기 양호한 눌림 분할 매수)
// 시프트 후 SCALE_IN으로 강등된 것도 포함되므로 "단·장기 모두 양호" ≠ NEW_ENTRY.
const SUBCATEGORY_BY_ACTION: Partial<
  Record<ActionRecommendation, RecommendationSubCategory>
> = {
  NEW_ENTRY: "new_entry",
  SCALE_IN: "scale_in",
};

const CATEGORY_PRIORITY: Record<RecommendationCategory, number> = {
  buy: 0,
  hold: 1,
  reduce: 2,
};

// 추천 응답 캐시 — 시장 영업시간엔 짧게, 아니면 길게.
// Vercel 함수 인스턴스마다 메모리가 분리되지만 cold start 후 다시 채워지면 충분.
declare global {
  // 핫 리로드/모듈 재평가 시 캐시 유실 방지
  var __recommendationsCache:
    | { data: RecommendationsResponse; expiresAt: number }
    | undefined;
}

// 시세·뉴스 신선도와 보조를 맞추기 위해 1h → 30min.
// 첫 빌드는 30~50초 무거우니 더 짧추면 비용이 폭증 — 30min이 균형.
const TTL_MS = 30 * 60 * 1000; // 30min

export function getCachedRecommendations(): RecommendationsResponse | null {
  const hit = global.__recommendationsCache;
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) return null;
  return hit.data;
}

export function invalidateRecommendationsCache(): void {
  global.__recommendationsCache = undefined;
}

function setCache(data: RecommendationsResponse): void {
  global.__recommendationsCache = {
    data,
    expiresAt: Date.now() + TTL_MS,
  };
}

// 간단한 동시성 제한기 — p-limit 같은 외부 패키지 없이 청크 단위로 처리.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return out;
}

// ----------------------------------------------------------------------------
// 시장 컨텍스트 — 오늘 시장 지표를 요약하고 섹터별 가산점을 계산.
// 점수는 분석 자체를 바꾸지 않고 정렬에만 영향을 준다.
// ----------------------------------------------------------------------------

function fmtPct(rate: number, digits = 1): string {
  const sign = rate > 0 ? "+" : "";
  return `${sign}${(rate * 100).toFixed(digits)}%`;
}

// 섹터별 컨텍스트 보너스 — 보수적으로 +/-10점 안쪽.
export function computeContextBonus(
  sector: SectorTag,
  ctx: { soxRate: number; fxRate: number; nasdaqRate: number; vix: number }
): number {
  let bonus = 0;
  const { soxRate, fxRate, nasdaqRate, vix } = ctx;

  switch (sector) {
    case "반도체":
      if (soxRate >= 0.015) bonus += 8;
      else if (soxRate >= 0.005) bonus += 4;
      else if (soxRate <= -0.015) bonus -= 6;
      else if (soxRate <= -0.005) bonus -= 3;
      if (nasdaqRate >= 0.01) bonus += 2;
      break;
    case "IT가전":
      if (nasdaqRate >= 0.01) bonus += 3;
      if (soxRate >= 0.01) bonus += 2;
      break;
    case "자동차":
      if (fxRate >= 0.005) bonus += 5;
      else if (fxRate <= -0.005) bonus -= 3;
      if (vix >= 25) bonus -= 2;
      break;
    case "배터리":
      if (fxRate >= 0.005) bonus += 3;
      if (nasdaqRate >= 0.01) bonus += 2;
      if (vix >= 25) bonus -= 2;
      break;
    case "조선":
      if (fxRate >= 0.005) bonus += 3;
      break;
    case "화학":
      if (fxRate >= 0.005) bonus += 2;
      break;
    case "철강소재":
      if (fxRate >= 0.005) bonus += 2;
      if (nasdaqRate >= 0.01) bonus += 1;
      break;
    case "인터넷":
    case "게임":
      if (nasdaqRate >= 0.01) bonus += 5;
      else if (nasdaqRate <= -0.01) bonus -= 3;
      if (vix >= 25) bonus -= 3;
      break;
    case "바이오":
      if (nasdaqRate >= 0.01) bonus += 3;
      if (vix >= 25) bonus -= 3;
      break;
    case "엔터":
      if (nasdaqRate >= 0.005) bonus += 2;
      break;
    case "금융":
      if (vix >= 25) bonus += 5;
      else if (vix >= 20) bonus += 2;
      if (nasdaqRate >= 0.015) bonus -= 1;
      break;
    case "통신":
      if (vix >= 25) bonus += 6;
      else if (vix >= 20) bonus += 3;
      if (nasdaqRate <= -0.01) bonus += 3;
      break;
    case "원전전력":
      if (vix >= 25) bonus += 4;
      else if (vix >= 20) bonus += 2;
      break;
    case "방산":
      if (vix >= 25) bonus += 4;
      break;
    case "유통종합":
      if (fxRate <= -0.005) bonus += 3;
      break;
    case "항공":
      if (fxRate <= -0.005) bonus += 3;
      else if (fxRate >= 0.005) bonus -= 3;
      if (vix >= 25) bonus -= 2;
      break;
  }
  return bonus;
}

// 컨텍스트 한 줄 요약 + 우호 섹터 목록.
function summarizeContext(ctx: {
  soxRate: number;
  fxRate: number;
  nasdaqRate: number;
  vix: number;
}): { summary: string; favorableSectors: SectorTag[] } {
  const { soxRate, fxRate, nasdaqRate, vix } = ctx;

  const indicators: string[] = [];
  if (Math.abs(soxRate) >= 0.005) indicators.push(`SOX ${fmtPct(soxRate)}`);
  if (Math.abs(fxRate) >= 0.003) indicators.push(`환율 ${fmtPct(fxRate)}`);
  if (Math.abs(nasdaqRate) >= 0.005)
    indicators.push(`나스닥 선물 ${fmtPct(nasdaqRate)}`);
  if (vix >= 20) indicators.push(`VIX ${vix.toFixed(1)}`);

  const favorable: SectorTag[] = [];
  if (soxRate >= 0.01) favorable.push("반도체");
  if (fxRate >= 0.005) {
    favorable.push("자동차");
    favorable.push("조선");
  }
  if (fxRate <= -0.005) {
    favorable.push("유통종합");
    favorable.push("항공");
  }
  if (vix >= 25) {
    favorable.push("금융");
    favorable.push("통신");
  }
  if (nasdaqRate >= 0.01) {
    favorable.push("인터넷");
    favorable.push("바이오");
  }

  const indStr = indicators.length > 0 ? indicators.join(", ") : "변동 미미";

  let summary: string;
  if (favorable.length === 0) {
    summary = `오늘 시장: ${indStr} — 뚜렷한 우호 섹터 없음, 종목 선별 접근`;
  } else {
    // 중복 제거 + 사용자에게 친숙한 라벨로 표시
    const uniq = Array.from(new Set(favorable));
    summary = `오늘 시장: ${indStr} → ${uniq.join("·")} 우호`;
  }
  return { summary, favorableSectors: Array.from(new Set(favorable)) };
}

// ----------------------------------------------------------------------------
// 메인 빌드 함수 — watchlist candidates 전체를 분석 파이프라인에 돌린다.
//
//   1) 시장 지표 + 뉴스 한 번만 fetch
//   2) 각 종목당: quote / historical / flow / consensus(캐시) / marketAlert(캐시)
//   3) analyze() 로 단·장기 시그널 + verdict 도출
//   4) 섹터 컨텍스트 보너스 가산 → rankScore 정렬
//   5) verdict.action 기준으로 카테고리 버킷에 분류
//
// 첫 호출은 ~30-50초 (consensus·marketAlert 미캐시). 두 번째 부터는 캐시 hit 으로 빠름.
// ----------------------------------------------------------------------------
export async function buildRecommendations(): Promise<RecommendationsResponse> {
  const startedAt = Date.now();
  const errors: Record<string, string> = {};

  // 1) 시장 지표 + 뉴스 병렬 fetch
  const [indicatorResults, newsAllResult] = await Promise.all([
    fetchQuotesBatch(MARKET_INDICATORS).catch((e) => {
      errors["market-indicators"] = e instanceof Error ? e.message : String(e);
      return [] as Awaited<ReturnType<typeof fetchQuotesBatch>>;
    }),
    fetchAllNews(30).catch((e) => {
      errors["news"] = e instanceof Error ? e.message : String(e);
      return [] as NewsItem[];
    }),
  ]);

  const indicatorMap = new Map<string, { value: number; changeRate: number }>();
  for (let i = 0; i < indicatorResults.length; i++) {
    const r = indicatorResults[i];
    const meta = MARKET_INDICATORS[i];
    if (!r.ok) {
      errors[meta.code] = r.error;
      continue;
    }
    indicatorMap.set(meta.code, {
      value: r.quote.price,
      changeRate: r.quote.changeRate,
    });
  }
  const sox = indicatorMap.get("^SOX");
  const nvda = indicatorMap.get("NVDA");
  const nq = indicatorMap.get("NQ=F");
  const fx = indicatorMap.get("KRW=X");
  const vix = indicatorMap.get("^VIX");

  // 반도체 과열도 — SOX/NVDA 둘 다 있을 때만 계산. 결손이면 null (룰 미적용).
  const soxRate = sox?.changeRate;
  const nvdaRate = nvda?.changeRate;
  const semiHeat: number | null =
    typeof soxRate === "number" && typeof nvdaRate === "number"
      ? Math.max(
          0,
          Math.min(100, Math.round(50 + ((soxRate + nvdaRate) / 2) * 1500))
        )
      : null;

  const ctxNumbers = {
    soxRate: sox?.changeRate ?? 0,
    fxRate: fx?.changeRate ?? 0,
    nasdaqRate: nq?.changeRate ?? 0,
    vix: vix?.value ?? 15,
  };

  const ctxSummary = summarizeContext(ctxNumbers);
  const marketContext: MarketContext = {
    soxRate: ctxNumbers.soxRate,
    fxRate: ctxNumbers.fxRate,
    nasdaqRate: ctxNumbers.nasdaqRate,
    vix: ctxNumbers.vix,
    summary: ctxSummary.summary,
    favorableSectors: ctxSummary.favorableSectors,
  };

  // 2) 후보 전체 분석. 동시성 6 — Yahoo 레이트리밋·블록 회피.
  const candidates = WATCHLIST_CANDIDATES.filter((c): c is SymbolMeta & {
    sector: SectorTag;
  } => !!c.sector);

  const items = await mapWithConcurrency(candidates, 6, async (meta) => {
    try {
      const [quoteRes, hist, bundle, marketAlert] = await Promise.all([
        fetchQuotesBatch([meta]).then((r) => r[0]),
        fetchHistorical(meta.code, 90).catch(() => []),
        getConsensusBundle(meta.code).catch(() => ({
          consensus: null,
          valuation: null,
          researches: [],
        })),
        isKrStock(meta.code)
          ? getMarketAlertCached(meta.code).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (!quoteRes.ok) {
        errors[meta.code] = quoteRes.error;
        return null;
      }
      const quote = { ...quoteRes.quote, marketAlert };

      // 컨센서스 upsidePercent / domesticUpsidePercent 는 현재가 기준으로 재계산
      const consensus = bundle.consensus
        ? {
            ...bundle.consensus,
            upsidePercent:
              bundle.consensus.targetMean != null && quote.price > 0
                ? bundle.consensus.targetMean / quote.price - 1
                : null,
            domesticUpsidePercent:
              bundle.consensus.domesticMean != null && quote.price > 0
                ? bundle.consensus.domesticMean / quote.price - 1
                : null,
          }
        : null;

      const tech = computeTech(hist);
      const flowResult = await fetchFlowOrMock(meta.code, quote.price);
      const flow = flowResult.flow;

      // 종목 관련 뉴스 + 시장 전반 뉴스를 합쳐 외부 리스크 평가.
      const relatedNews = newsAllResult.filter(
        (n) =>
          n.symbol === meta.code ||
          (n.title || "").includes(meta.name) ||
          n.symbol == null
      );
      const externalRisk =
        relatedNews.length > 0
          ? assessNewsRisk(relatedNews)
          : emptyRiskAssessment();

      const analysis = analyze({
        quote,
        tech,
        flow,
        consensus,
        valuation: bundle.valuation,
        externalRisk,
        context: {
          semiHeat,
          nasdaqRate: ctxNumbers.nasdaqRate,
          fxRate: ctxNumbers.fxRate,
          vix: ctxNumbers.vix,
        },
      });

      const sector = meta.sector;
      const contextBonus = computeContextBonus(sector, ctxNumbers);
      const rankScore = analysis.buyScore + contextBonus;
      const category = CATEGORY_BY_ACTION[analysis.verdict.action];
      const subCategory = SUBCATEGORY_BY_ACTION[analysis.verdict.action];

      // 시그널 마크 — 추천 카드 헤더에도 같이 노출. 작은 카드라 3개로 컷.
      // 추천 빌드 단계에선 종목별 upcomingEvents 를 별도로 fetch 하지 않으므로
      // 어닝 D-N 마크는 건너뛴다 (대시보드 카드에서만 노출). valuation 은 활용 가능.
      const signalMarks = pickTopSignalMarks(
        evaluateSignalMarks({
          quote,
          history: hist,
          flow,
          valuation: bundle.valuation,
        }),
        3
      );

      const rec: Recommendation = {
        code: meta.code,
        name: meta.name,
        kind: meta.kind,
        sector,
        price: quote.price,
        changeRate: quote.changeRate,
        currency: quote.currency,
        verdict: analysis.verdict,
        shortTerm: analysis.shortTerm,
        longTerm: analysis.longTerm,
        externalRisk: analysis.externalRisk,
        buyScore: analysis.buyScore,
        heatScore: analysis.heatScore,
        longScore: analysis.longTerm.score,
        contextBonus,
        rankScore,
        category,
        subCategory,
        headline: analysis.verdict.headline,
        marketAlert,
        signalMarks,
        consensusSnap: buildConsensusSnap(consensus, quote.price),
        catalystNews: pickCatalystNews(relatedNews, meta.code, meta.name, 2),
      };
      return rec;
    } catch (e) {
      errors[meta.code] = e instanceof Error ? e.message : String(e);
      return null;
    }
  });

  const recommendations = items.filter((x): x is Recommendation => x !== null);

  // 3) 정렬 — 카테고리 우선순위 > rankScore desc > heatScore asc
  recommendations.sort((a, b) => {
    const ca = CATEGORY_PRIORITY[a.category];
    const cb = CATEGORY_PRIORITY[b.category];
    if (ca !== cb) return ca - cb;
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return a.heatScore - b.heatScore;
  });

  // 4) 응답에 포함된 섹터 — 탭 UI 용. 분류 우선순위는 가나다순 + 추천 수 동률 일관성.
  const sectors = Array.from(
    new Set(recommendations.map((r) => r.sector))
  ).sort((a, b) => a.localeCompare(b, "ko"));

  const response: RecommendationsResponse = {
    generatedAt: Date.now(),
    context: marketContext,
    sectors,
    items: recommendations,
    errors,
    buildMs: Date.now() - startedAt,
    cached: false,
  };

  setCache(response);
  return response;
}

// 캐시가 있으면 그것을 쓰고, 없거나 무시 옵션이면 새로 빌드.
// 콜드 동시 호출 race 방지 — 빌드 중인 Promise가 있으면 그걸 공유한다.
// (forceRefresh=true 도 같은 in-flight를 공유해 무한 새 빌드 방지)
let inFlightBuild: Promise<RecommendationsResponse> | null = null;

export async function getOrBuildRecommendations(options?: {
  forceRefresh?: boolean;
}): Promise<RecommendationsResponse> {
  if (!options?.forceRefresh) {
    const hit = getCachedRecommendations();
    if (hit) return { ...hit, cached: true };
  }
  if (inFlightBuild) return inFlightBuild;
  inFlightBuild = buildRecommendations().finally(() => {
    inFlightBuild = null;
  });
  return inFlightBuild;
}
