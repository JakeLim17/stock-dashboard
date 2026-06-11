import "server-only";
import type {
  AnalystConsensus,
  ExtendedHoursQuote,
  MarketAlert,
  MarketAlertLevel,
  Quote,
  ResearchNote,
  Valuation,
  ValuationMetrics,
} from "../types";

/**
 * 네이버 금융 모바일 API를 이용한 실시간 한국 주식 시세 조회.
 * Yahoo Finance의 15분 딜레이 문제를 해결하기 위해 사용.
 * 한국 종목(kind: "kr-stock")에만 적용.
 */

const NAVER_API_BASE = "https://m.stock.naver.com/api/stock";
// PC 네이버 금융의 실시간 polling 엔드포인트.
// basic 응답에는 없는 overMarketPriceInfo(시간외 단일가)가 들어 있어 보조로 사용.
const NAVER_POLLING_BASE =
  "https://polling.finance.naver.com/api/realtime/domestic/stock";
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

interface NaverBasicResponse {
  stockName?: string;
  closePrice?: string;
  compareToPreviousClosePrice?: string;
  compareToPreviousPrice?: { name?: string };
  fluctuationsRatio?: string;
  marketStatus?: string;
  localTradedAt?: string;
  stockExchangeType?: { code?: string };
}

// polling.finance.naver.com 응답 일부 (시간외 정보)
interface NaverOverMarketPriceInfo {
  // "BEFORE_MARKET" | "AFTER_MARKET" | ...
  tradingSessionType?: string;
  // "OPEN" | "CLOSE"
  overMarketStatus?: string;
  // 시간외 체결가 (원, 천단위 콤마)
  overPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  // 전일 종가 대비 변화 (정규장 종가가 아님에 주의: 네이버는 전일 종가 기준으로 줌)
  compareToPreviousClosePrice?: string;
  compareToPreviousPrice?: { name?: string };
  fluctuationsRatio?: string;
  localTradedAt?: string;
  accumulatedTradingVolume?: string;
  accumulatedTradingValue?: string;
}

interface NaverIntegratedPriceInfo {
  highPrice?: string;
  lowPrice?: string;
  accumulatedTradingVolume?: string;
  accumulatedTradingValue?: string;
}

interface NaverPollingData {
  closePrice?: string;
  marketStatus?: string;
  localTradedAt?: string;
  overMarketPriceInfo?: NaverOverMarketPriceInfo | null;
  integratedPriceInfo?: NaverIntegratedPriceInfo | null;
}

interface NaverPollingResponse {
  datas?: NaverPollingData[];
}

interface NaverTotalInfo {
  key?: string;
  value?: string;
  code?: string;
}

interface NaverIntegrationResponse {
  totalInfos?: NaverTotalInfo[];
}

function parseNaverNumber(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,\s원주백만억조배%]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseMarketCap(s: string | undefined | null): number | null {
  if (!s) return null;
  let multiplier = 1;
  if (s.includes("조")) {
    const parts = s.split("조");
    const jo = parseNaverNumber(parts[0]);
    const remainder = parseNaverNumber(parts[1]?.replace("억", ""));
    if (jo == null) return null;
    return jo * 1_0000_0000_0000 + (remainder ?? 0) * 1_0000_0000;
  }
  if (s.includes("억")) multiplier = 1_0000_0000;
  const n = parseNaverNumber(s);
  return n != null ? n * multiplier : null;
}

function parseTradingValue(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = parseNaverNumber(s);
  if (n == null) return null;
  if (s.includes("조")) return n * 1_0000_0000_0000;
  if (s.includes("억")) return n * 1_0000_0000;
  if (s.includes("백만")) return n * 1_000_000;
  return n;
}

function parseRatio(s: string | undefined | null): number | null {
  const n = parseNaverNumber(s);
  return n != null && n > 0 ? n : null;
}

function extractValuation(infoMap: Map<string, string>): ValuationMetrics {
  return {
    per: parseRatio(infoMap.get("per")),
    forwardPer: parseRatio(infoMap.get("cnsPer")),
    pbr: parseRatio(infoMap.get("pbr")),
    eps: parseRatio(infoMap.get("eps")),
    forwardEps: parseRatio(infoMap.get("cnsEps")),
    bps: parseRatio(infoMap.get("bps")),
    dividendYield: parseRatio(infoMap.get("dividendYieldRatio")),
  };
}

/**
 * Yahoo 종목코드(005930.KS)에서 네이버용 6자리 코드 추출.
 */
function toNaverCode(yahooCode: string): string | null {
  const m = yahooCode.match(/^(\d{6})\.K[SQ]$/);
  return m ? m[1] : null;
}

/**
 * 네이버에서 실시간 시세를 가져온다.
 * 실패 시 null 반환 (Yahoo fallback 가능하도록).
 */
export async function fetchNaverQuote(
  code: string,
  name: string
): Promise<Quote | null> {
  const naverCode = toNaverCode(code);
  if (!naverCode) return null;

  try {
    const [basicRes, integrationRes, pollingRes] = await Promise.all([
      fetch(`${NAVER_API_BASE}/${naverCode}/basic`, {
        headers: { "User-Agent": USER_AGENT },
        next: { revalidate: 0 },
      }),
      fetch(`${NAVER_API_BASE}/${naverCode}/integration`, {
        headers: { "User-Agent": USER_AGENT },
        next: { revalidate: 0 },
      }),
      fetch(`${NAVER_POLLING_BASE}/${naverCode}`, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: "https://finance.naver.com/",
        },
        next: { revalidate: 0 },
      }).catch(() => null),
    ]);

    if (!basicRes.ok) return null;

    const basic: NaverBasicResponse = await basicRes.json();
    const integration: NaverIntegrationResponse = integrationRes.ok
      ? await integrationRes.json()
      : { totalInfos: [] };
    const polling: NaverPollingResponse = pollingRes?.ok
      ? await pollingRes.json()
      : {};

    const price = parseNaverNumber(basic.closePrice);
    if (price == null) return null;

    const infos = integration.totalInfos ?? [];
    const infoMap = new Map(
      infos.map((i) => [i.code ?? i.key ?? "", i.value ?? ""])
    );

    const prevClose =
      parseNaverNumber(infoMap.get("lastClosePrice")) ??
      price - (parseNaverNumber(basic.compareToPreviousClosePrice) ?? 0);

    const changeAbs = parseNaverNumber(basic.compareToPreviousClosePrice) ?? 0;
    const isDown = basic.compareToPreviousPrice?.name === "FALLING";
    const absChange = isDown ? -Math.abs(changeAbs) : Math.abs(changeAbs);

    const rateRaw = parseNaverNumber(basic.fluctuationsRatio);
    const changeRate =
      rateRaw != null
        ? (isDown ? -Math.abs(rateRaw) : Math.abs(rateRaw)) / 100
        : prevClose
          ? absChange / prevClose
          : 0;

    const priceTime = basic.localTradedAt
      ? new Date(basic.localTradedAt).getTime()
      : null;

    const marketStatus = basic.marketStatus;
    let marketState: string | undefined;
    if (marketStatus === "OPEN") marketState = "REGULAR";
    else if (marketStatus === "CLOSE") marketState = "CLOSED";
    else marketState = marketStatus;

    const pollingData = polling.datas?.[0];
    const extendedHours = extractKoreanExtended(
      pollingData?.overMarketPriceInfo,
      prevClose,
      price
    );
    const livePriceInfo = pollingData?.integratedPriceInfo;

    // quote.price 는 항상 정규장 종가. 시간외 단일가는 quote.extendedHours 에만 노출하고
    // 메인/부연 위치 스왑은 pickPrimaryQuote 가 책임진다. 여기서 ext.price 로 덮어쓰면
    // pickPrimaryQuote 의 secondary("정규장 종가") 가 시간외 가격으로 오염된다.
    return {
      code,
      name,
      price,
      prevClose,
      changeAbs: absChange,
      changeRate,
      volume:
        parseNaverNumber(livePriceInfo?.accumulatedTradingVolume) ??
        parseNaverNumber(infoMap.get("accumulatedTradingVolume")),
      high:
        parseNaverNumber(livePriceInfo?.highPrice) ??
        parseNaverNumber(infoMap.get("highPrice")),
      low:
        parseNaverNumber(livePriceInfo?.lowPrice) ??
        parseNaverNumber(infoMap.get("lowPrice")),
      marketCap: parseMarketCap(infoMap.get("marketValue")),
      currency: "KRW",
      valuation: extractValuation(infoMap),
      fetchedAt: Date.now(),
      marketState,
      priceTime,
      extendedHours,
    };
  } catch {
    return null;
  }
}

// 네이버의 overMarketPriceInfo → ExtendedHoursQuote 변환
//  - tradingSessionType: BEFORE_MARKET(장전 시간외) / AFTER_MARKET(장후 시간외·앱장)
//                        REGULAR_MARKET 은 정규장 거래 중이라는 뜻이므로 시간외로 취급하지 않음
//  - 변동률은 정규장 종가 기준이 아니라 네이버가 주는 fluctuationsRatio(전일 종가 기준)을 그대로 사용
function extractKoreanExtended(
  info: NaverOverMarketPriceInfo | null | undefined,
  prevClose: number,
  regularClose: number
): ExtendedHoursQuote | null {
  if (!info) return null;
  // 정규장 거래중이면 overMarketPriceInfo가 함께 와도 시간외 의미 없음
  const session = (info.tradingSessionType ?? "").toUpperCase();
  if (session === "REGULAR_MARKET" || session === "") return null;
  const price = parseNaverNumber(info.overPrice);
  if (price == null) return null;

  const isDown = info.compareToPreviousPrice?.name === "FALLING";
  const rawAbs = parseNaverNumber(info.compareToPreviousClosePrice);
  const abs = rawAbs != null ? (isDown ? -Math.abs(rawAbs) : Math.abs(rawAbs)) : 0;

  const rawRate = parseNaverNumber(info.fluctuationsRatio);
  const rate =
    rawRate != null
      ? (isDown ? -Math.abs(rawRate) : Math.abs(rawRate)) / 100
      : prevClose
        ? abs / prevClose
        : 0;

  const sessionKind: ExtendedHoursQuote["session"] =
    session === "BEFORE_MARKET" ? "kr-before" : "kr-after";

  return {
    session: sessionKind,
    price,
    changeAbs: abs,
    changeRate: rate,
    volume: parseNaverNumber(info.accumulatedTradingVolume),
    tradingValue: parseTradingValue(info.accumulatedTradingValue),
    high: parseNaverNumber(info.highPrice),
    low: parseNaverNumber(info.lowPrice),
    regularClose,
    time: info.localTradedAt ? new Date(info.localTradedAt).getTime() : null,
    active: info.overMarketStatus === "OPEN",
  };
}

export function isKrStock(code: string): boolean {
  return /^\d{6}\.K[SQ]$/.test(code);
}

/**
 * 네이버에서 외인/기관 순매수 데이터를 가져온다 (일별 데이터, 최대 5일).
 * 주(shares) 단위를 원(KRW) 단위로 변환하기 위해 현재가를 곱한다.
 */
export interface NaverFlowResult {
  foreignNet: number | null;
  institutionNet: number | null;
  individualNet: number | null;
  foreignNet5d: number | null;
  institutionNet5d: number | null;
  individualNet5d: number | null;
  // dealTrendInfos[0].bizdate 그대로 (KST YYYYMMDD). 응답에 없으면 undefined.
  bizdate?: string;
}

interface DealTrendInfo {
  bizdate?: string;
  foreignerPureBuyQuant?: string;
  organPureBuyQuant?: string;
  individualPureBuyQuant?: string;
  closePrice?: string;
}

function parseSignedNumber(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ─── 컨센서스 / 밸류에이션 / 리서치 (네이버 integration) ───────
//
// 한 번의 호출로 totalInfos(밸류에이션 raw 문자열)·consensusInfo·researches가 같이 온다.
// totalInfos의 value는 "22.54배", "317,000", "9.81배" 같은 사람이 읽는 문자열이므로 파싱 필요.
//
// 주의: 네이버 recommMean(1~5) 척도는 Yahoo와 다르며 (실측 SK하이닉스 4.00 = 매수)
// "높을수록 매수"인 것으로 추정된다. 혼동 방지를 위해 Yahoo 척도(낮을수록 매수)만
// 단일 진실의 소스로 사용하고, 네이버 recommMean은 무시한다.
//
// 한국 종목에 한해 호출, 그 외 코드는 null.
interface NaverConsensusInfo {
  itemCode?: string;
  createDate?: string;
  // 네이버는 숫자도 문자열로 주는 경우가 있다 (예: "2,437,083", "4.00")
  recommMean?: string | number;
  priceTargetMean?: string | number;
}

interface NaverResearchItem {
  id?: string | number;
  cd?: string;
  nm?: string;
  bnm?: string; // 증권사
  tit?: string; // 제목
  wdt?: string; // 'YYYYMMDD'
}

interface NaverIntegrationFull {
  totalInfos?: NaverTotalInfo[];
  consensusInfo?: NaverConsensusInfo;
  researches?: NaverResearchItem[];
  closePrice?: string;
}

function parseNaverDate(wdt: string | undefined): string {
  if (!wdt || wdt.length !== 8) return "";
  return `${wdt.slice(0, 4)}-${wdt.slice(4, 6)}-${wdt.slice(6, 8)}`;
}

export async function fetchNaverIntegration(
  code: string
): Promise<{
  consensus: AnalystConsensus | null;
  valuation: Valuation | null;
  researches: ResearchNote[];
} | null> {
  const naverCode = toNaverCode(code);
  if (!naverCode) return null;

  try {
    const res = await fetch(`${NAVER_API_BASE}/${naverCode}/integration`, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://m.stock.naver.com/",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as NaverIntegrationFull;
    const infos = data.totalInfos ?? [];
    const infoMap = new Map(
      infos.map((i) => [i.code ?? i.key ?? "", i.value ?? ""])
    );

    const currentPrice =
      parseNaverNumber(data.closePrice) ??
      parseNaverNumber(infoMap.get("closePrice"));

    // 컨센서스 (한국 한정 — 분포 데이터는 없음)
    const rawTarget = data.consensusInfo?.priceTargetMean;
    const targetMean =
      typeof rawTarget === "number"
        ? rawTarget
        : parseNaverNumber(rawTarget ?? undefined);
    const upsidePercent =
      targetMean != null && currentPrice != null && currentPrice > 0
        ? targetMean / currentPrice - 1
        : null;
    const consensus: AnalystConsensus | null =
      targetMean != null
        ? {
            targetMean,
            targetMedian: null,
            targetHigh: null,
            targetLow: null,
            analystCount: null,
            recommendationKey: null,
            recommendationMean: null,
            strongBuy: 0,
            buy: 0,
            hold: 0,
            sell: 0,
            strongSell: 0,
            upsidePercent,
            source: "naver",
            asOf: Date.now(),
          }
        : null;

    // 밸류에이션
    const per = parseRatio(infoMap.get("per"));
    const forwardPer = parseRatio(infoMap.get("cnsPer"));
    const pbr = parseRatio(infoMap.get("pbr"));
    const eps = parseRatio(infoMap.get("eps"));
    const bps = parseRatio(infoMap.get("bps"));
    const dividendYield = (() => {
      const raw = parseNaverNumber(infoMap.get("dividendYieldRatio"));
      return raw != null ? raw / 100 : null;
    })();
    const week52High = parseNaverNumber(infoMap.get("highPriceOf52Weeks"));
    const week52Low = parseNaverNumber(infoMap.get("lowPriceOf52Weeks"));

    const valuation: Valuation | null =
      per != null ||
      forwardPer != null ||
      pbr != null ||
      eps != null ||
      week52High != null
        ? {
            per,
            forwardPer,
            pbr,
            eps,
            bps,
            dividendYield,
            week52High,
            week52Low,
            source: "naver",
            asOf: Date.now(),
          }
        : null;

    const researches: ResearchNote[] = (data.researches ?? [])
      .slice(0, 5)
      .map((r) => ({
        brokerage: r.bnm ?? "",
        title: r.tit ?? "",
        date: parseNaverDate(r.wdt),
        id: r.id != null ? String(r.id) : undefined,
      }))
      .filter((r) => r.title);

    return { consensus, valuation, researches };
  } catch {
    return null;
  }
}

// ─── 시장경보 (한국거래소) — 네이버 PC HTML 파싱 ──────────────────
//
// 모바일 API의 iconInfos/tradeStopType은 시장경보 종목에서도 대부분 null이라
// PC 종목 페이지(`/item/main.naver?code=XXXXXX`)의 마크업을 직접 파싱한다.
//
// 실측 표본 (2026-06-01): 네이처셀 007390 → `<em class="warning"> <span class="blind">투자경고</span></em>`
//                       SK하이닉스 000660 → 마크업 없음
//
// 마크업이 등장하는 위치는 종목명 옆 알림 영역으로, em 의 class 가 caution/warning/risk 셋 중 하나.
// 관리종목·거래정지는 같은 영역 또는 종목명 상단 표기로 등장할 수 있어
// `<em class="admin">`/`<em class="halt">`도 함께 매칭하되, 발견되면 추가 검증 없이 채택.
//
// **주의:** 정규식 기반이므로 네이버가 마크업을 바꾸면 작동하지 않는다.
// 그때는 매월 한 번 정도 표본 확인 + 정규식 보정 필요.

const NAVER_ITEM_BASE = "https://finance.naver.com/item/main.naver";

// 강도 우선순위: halt > risk > warning > admin > caution.
// 거래정지(halt)는 사실상 최상위 위험이고, 관리종목(admin)은 risk만큼은 아니지만
// 단기 caution 보다는 무겁다는 관점.
const ALERT_PRIORITY: Record<MarketAlertLevel, number> = {
  halt: 50,
  risk: 40,
  warning: 30,
  admin: 20,
  caution: 10,
};

const ALERT_LABEL: Record<MarketAlertLevel, string> = {
  caution: "투자주의",
  warning: "투자경고",
  risk: "투자위험",
  halt: "거래정지",
  admin: "관리종목",
};

// 종목명 옆 알림 영역의 `<em class="..."><span class="blind">...</span></em>` 패턴.
// caution/warning/risk 는 class 명에서, halt/admin 은 보조로 blind 텍스트("거래정지"·"관리종목") 매칭.
const ALERT_EM_RE =
  /<em\s+class=\"(caution|warning|risk|halt|admin)\"[^>]*>[\s\S]*?<\/em>/gi;
// 보조 — class 명을 못 잡았을 때 blind 텍스트로 fallback.
const ALERT_BLIND_RE =
  /<span\s+class=\"blind\">\s*(투자주의|투자경고|투자위험|거래정지|관리종목)\s*<\/span>/gi;

const BLIND_TO_LEVEL: Record<string, MarketAlertLevel> = {
  투자주의: "caution",
  투자경고: "warning",
  투자위험: "risk",
  거래정지: "halt",
  관리종목: "admin",
};

function isKrxCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * 한국 종목의 시장경보 상태를 네이버 PC 페이지에서 읽어온다.
 * 호출자는 6자리 KRX 코드(예: "007390") 또는 Yahoo 코드("007390.KS") 모두 넘길 수 있다.
 * 시장경보가 없거나 실패하면 null 반환.
 */
export async function fetchMarketAlert(
  code: string
): Promise<MarketAlert | null> {
  // 입력 정규화: "007390.KS" → "007390"
  const naverCode = isKrxCode(code) ? code : toNaverCode(code);
  if (!naverCode) return null;

  try {
    const res = await fetch(`${NAVER_ITEM_BASE}?code=${naverCode}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html) return null;

    // 1차: class 명으로 잡기
    const found = new Set<MarketAlertLevel>();
    for (const m of html.matchAll(ALERT_EM_RE)) {
      const lvl = m[1].toLowerCase() as MarketAlertLevel;
      if (lvl in ALERT_PRIORITY) found.add(lvl);
    }
    // 2차 보조: blind 텍스트
    for (const m of html.matchAll(ALERT_BLIND_RE)) {
      const lvl = BLIND_TO_LEVEL[m[1]];
      if (lvl) found.add(lvl);
    }
    if (found.size === 0) return null;

    // 가장 강한 단계 채택
    const top = Array.from(found).reduce((a, b) =>
      ALERT_PRIORITY[a] >= ALERT_PRIORITY[b] ? a : b
    );

    return {
      level: top,
      label: ALERT_LABEL[top],
      source: "naver",
      asOf: Date.now(),
    };
  } catch {
    return null;
  }
}

export async function fetchNaverFlow(
  code: string,
  currentPrice: number
): Promise<NaverFlowResult | null> {
  const naverCode = toNaverCode(code);
  if (!naverCode) return null;

  try {
    const res = await fetch(`${NAVER_API_BASE}/${naverCode}/integration`, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as NaverIntegrationResponse & {
      dealTrendInfos?: DealTrendInfo[];
    };
    const deals = data.dealTrendInfos ?? [];
    if (deals.length === 0) return null;

    const today = deals[0];
    const foreignShares = parseSignedNumber(today.foreignerPureBuyQuant);
    const organShares = parseSignedNumber(today.organPureBuyQuant);
    const individualShares = parseSignedNumber(today.individualPureBuyQuant);

    // 디버그 로그 — production Vercel Functions Logs 에서 네이버 raw 응답 확인용.
    // 사용자 보고: 토스 +3,082(백만원 추정=30.82억) vs 우리 -2,409억 → 1000배+부호반전.
    // 이 로그로 dealTrendInfos[0] 의 bizdate/raw quant 단위·부호를 직접 검증할 수 있다.
    // 추후 단위 확정되면 fetchNaverFlow 정상화 가능. (지금은 fetchFlowOrMock 에서 결과 무시.)
    console.warn(
      `[naver-flow] ${code} bizdate=${today.bizdate ?? "?"} foreignerPureBuyQuant=${today.foreignerPureBuyQuant ?? "?"} organPureBuyQuant=${today.organPureBuyQuant ?? "?"} individualPureBuyQuant=${today.individualPureBuyQuant ?? "?"} closePrice=${today.closePrice ?? "?"} currentPrice=${currentPrice}`
    );

    // 5일 누적: 각 거래일 종가 × 해당일 수량으로 합산해야 정확.
    //   기존 구현은 모든 일자에 currentPrice를 곱해 단기 급등 종목에서 ~5-6% 오차가 발생.
    //   각 일자 closePrice가 없으면 currentPrice로 폴백.
    let foreign5dKrw = 0;
    let organ5dKrw = 0;
    let individual5dKrw = 0;
    const days = Math.min(deals.length, 5);
    for (let i = 0; i < days; i++) {
      const dayClose = parseSignedNumber(deals[i].closePrice) ?? currentPrice ?? 0;
      const f = parseSignedNumber(deals[i].foreignerPureBuyQuant) ?? 0;
      const o = parseSignedNumber(deals[i].organPureBuyQuant) ?? 0;
      const ind = parseSignedNumber(deals[i].individualPureBuyQuant) ?? 0;
      foreign5dKrw += f * dayClose;
      organ5dKrw += o * dayClose;
      individual5dKrw += ind * dayClose;
    }

    // 당일은 가장 최근 영업일 종가로 환산 (currentPrice가 시간외에 흔들려도 안정).
    //   시간외/장중 0이면 currentPrice로 폴백.
    const todayClose = parseSignedNumber(today.closePrice) ?? currentPrice ?? 0;

    return {
      foreignNet: foreignShares != null ? foreignShares * todayClose : null,
      institutionNet: organShares != null ? organShares * todayClose : null,
      individualNet: individualShares != null ? individualShares * todayClose : null,
      foreignNet5d: foreign5dKrw,
      institutionNet5d: organ5dKrw,
      individualNet5d: individual5dKrw,
      bizdate: today.bizdate,
    };
  } catch {
    return null;
  }
}
