import "server-only";
import type { ExtendedHoursQuote, Quote, ValuationMetrics } from "../types";

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
    const activeExtended =
      extendedHours?.active === true ? extendedHours : null;
    const livePriceInfo = pollingData?.integratedPriceInfo;

    return {
      code,
      name,
      price: activeExtended?.price ?? price,
      prevClose,
      changeAbs: activeExtended?.changeAbs ?? absChange,
      changeRate: activeExtended?.changeRate ?? changeRate,
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
      priceTime: activeExtended?.time ?? priceTime,
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
  foreignNet5d: number | null;
  institutionNet5d: number | null;
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

    let foreign5dShares = 0;
    let organ5dShares = 0;
    const days = Math.min(deals.length, 5);
    for (let i = 0; i < days; i++) {
      const f = parseSignedNumber(deals[i].foreignerPureBuyQuant) ?? 0;
      const o = parseSignedNumber(deals[i].organPureBuyQuant) ?? 0;
      foreign5dShares += f;
      organ5dShares += o;
    }

    const price = currentPrice || 1;

    return {
      foreignNet: foreignShares != null ? foreignShares * price : null,
      institutionNet: organShares != null ? organShares * price : null,
      foreignNet5d: foreign5dShares * price,
      institutionNet5d: organ5dShares * price,
    };
  } catch {
    return null;
  }
}
