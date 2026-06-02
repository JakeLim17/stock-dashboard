import "server-only";
import { fetchAnalystAndValuation } from "./yahoo";
import { fetchNaverIntegration } from "./naver";
import { isKrStock } from "./naver";
import { fetchWisereportAnalystReports } from "./wisereport";
import type {
  AnalystConsensus,
  AnalystReport,
  ResearchNote,
  Valuation,
} from "../types";

// 컨센서스/밸류에이션은 하루 1회 갱신이면 충분하다.
// 매 5~15초 시세 갱신마다 Yahoo + 네이버를 종목당 추가로 때리면 비용·차단 위험이 폭증.
// → 종목당 6시간 메모리 캐시.
//
// Vercel은 함수 인스턴스마다 메모리가 분리되므로 cold start 때 다시 채워지지만 그 자체로 OK.
// (Naver/Yahoo 둘 다 anonymous 호출이라 토큰 비용은 없음.)
//
// 향후 영구 보관이 필요하면 lib/db.ts에 consensus_cache 테이블을 만들어 같은 인터페이스로
// 갈아끼우면 된다. 우선 현 단계에서는 메모리 Map만으로 충분.

const TTL_MS = 6 * 60 * 60 * 1000; // 6h

export interface ConsensusBundle {
  consensus: AnalystConsensus | null;
  valuation: Valuation | null;
  researches: ResearchNote[];
}

interface CacheEntry {
  data: ConsensusBundle;
  expiresAt: number;
}

declare global {
  // 핫 리로드/모듈 재평가 시 캐시 유실 방지
  var __consensusCache: Map<string, CacheEntry> | undefined;
  var __consensusInFlight: Map<string, Promise<ConsensusBundle>> | undefined;
}

function cache(): Map<string, CacheEntry> {
  if (!global.__consensusCache) {
    global.__consensusCache = new Map();
  }
  return global.__consensusCache;
}

// 콜드 동시 호출 race 방지용 in-flight Promise 맵.
// 같은 종목으로 동시에 여러 호출이 들어오면 첫 빌드를 공유한다.
function inFlight(): Map<string, Promise<ConsensusBundle>> {
  if (!global.__consensusInFlight) {
    global.__consensusInFlight = new Map();
  }
  return global.__consensusInFlight;
}

// Yahoo + 네이버 결과 머지. 한국 종목은 네이버가 PER/PBR을 더 잘 줘서 네이버 우선,
// 그 외 필드(애널 분포·targetHigh·targetLow)는 Yahoo만 줄 수 있어 Yahoo 우선.
// 둘 다 있으면 source = "merged".
function mergeBundle(
  yahoo: { consensus: AnalystConsensus | null; valuation: Valuation | null } | null,
  naver:
    | {
        consensus: AnalystConsensus | null;
        valuation: Valuation | null;
        researches: ResearchNote[];
      }
    | null,
  // wisereport 의 증권사별 표 — 한국 종목 한정.
  // reports 자체와 국내 평균 통계를 함께 들고온다.
  wise:
    | {
        reports: AnalystReport[];
        domesticMean: number | null;
        domesticHigh: number | null;
        domesticLow: number | null;
        domesticCount: number;
      }
    | null
): ConsensusBundle {
  // ── 컨센서스: Yahoo가 있으면 Yahoo를 베이스로 하고 targetMean이 비어있을 때만 네이버 채움.
  let consensus: AnalystConsensus | null = null;
  if (yahoo?.consensus && naver?.consensus) {
    consensus = {
      ...yahoo.consensus,
      // Yahoo가 targetMean을 못 주는 경우는 거의 없지만 fallback
      targetMean: yahoo.consensus.targetMean ?? naver.consensus.targetMean,
      upsidePercent:
        yahoo.consensus.upsidePercent ?? naver.consensus.upsidePercent,
      source: "merged",
    };
  } else if (yahoo?.consensus) {
    consensus = yahoo.consensus;
  } else if (naver?.consensus) {
    consensus = naver.consensus;
  }

  // ── wisereport 증권사별 reports + 국내 평균 — 한국 종목에서만 채워진다.
  //    consensus 객체가 없는데 wise 만 있는 경우(Yahoo·네이버 둘 다 빈 경우)도
  //    domesticMean 으로 최소한의 컨센을 구성해 준다.
  if (wise) {
    if (!consensus && wise.domesticMean != null) {
      consensus = {
        targetMean: wise.domesticMean,
        targetMedian: null,
        targetHigh: wise.domesticHigh,
        targetLow: wise.domesticLow,
        analystCount: wise.domesticCount || null,
        recommendationKey: null,
        recommendationMean: null,
        strongBuy: 0,
        buy: 0,
        hold: 0,
        sell: 0,
        strongSell: 0,
        upsidePercent: null,
        source: "naver",
        asOf: Date.now(),
      };
    }
    if (consensus) {
      consensus = {
        ...consensus,
        reports: wise.reports,
        domesticMean: wise.domesticMean,
        domesticHigh: wise.domesticHigh,
        domesticLow: wise.domesticLow,
        domesticCount: wise.domesticCount,
      };
    }
  }

  // ── 밸류에이션: 네이버가 한국 종목 PER/PBR을 더 잘 줘서 우선. Yahoo는 52주가/배당으로 보강.
  let valuation: Valuation | null = null;
  if (yahoo?.valuation && naver?.valuation) {
    // 두 소스의 forwardPer 비교 — 2배 이상 차이나면 신뢰도 "low".
    const yFp = yahoo.valuation.forwardPer;
    const nFp = naver.valuation.forwardPer;
    let forwardPerConfidence: "high" | "low" = "high";
    if (yFp != null && nFp != null && yFp > 0 && nFp > 0) {
      const ratio = Math.max(yFp, nFp) / Math.min(yFp, nFp);
      if (ratio >= 2) forwardPerConfidence = "low";
    }
    valuation = {
      per: naver.valuation.per ?? yahoo.valuation.per,
      forwardPer: naver.valuation.forwardPer ?? yahoo.valuation.forwardPer,
      pbr: naver.valuation.pbr ?? yahoo.valuation.pbr,
      eps: naver.valuation.eps ?? yahoo.valuation.eps,
      bps: naver.valuation.bps ?? yahoo.valuation.bps,
      dividendYield:
        naver.valuation.dividendYield ?? yahoo.valuation.dividendYield,
      week52High: yahoo.valuation.week52High ?? naver.valuation.week52High,
      week52Low: yahoo.valuation.week52Low ?? naver.valuation.week52Low,
      source: "merged",
      asOf: Date.now(),
      forwardPerConfidence,
      forwardPerYahoo: yFp,
      forwardPerNaver: nFp,
    };
  } else if (naver?.valuation) {
    valuation = { ...naver.valuation, forwardPerConfidence: "high" };
  } else if (yahoo?.valuation) {
    valuation = { ...yahoo.valuation, forwardPerConfidence: "high" };
  }

  return {
    consensus,
    valuation,
    researches: naver?.researches ?? [],
  };
}

export async function getConsensusBundle(
  code: string
): Promise<ConsensusBundle> {
  const now = Date.now();
  const c = cache();
  const hit = c.get(code);
  if (hit && hit.expiresAt > now) return hit.data;

  // 같은 종목으로 빌드 중인 Promise가 있으면 공유 (cold race 방지)
  const flight = inFlight();
  const inProgress = flight.get(code);
  if (inProgress) return inProgress;

  // 한국 종목은 Yahoo+Naver+Wisereport 병렬, 해외는 Yahoo만.
  const promise = (async () => {
    const isKr = isKrStock(code);
    const [yahooResult, naverResult, wiseResult] = await Promise.all([
      fetchAnalystAndValuation(code).catch(() => null),
      isKr ? fetchNaverIntegration(code).catch(() => null) : Promise.resolve(null),
      isKr ? fetchWisereportAnalystReports(code).catch(() => null) : Promise.resolve(null),
    ]);

    const merged = mergeBundle(yahooResult, naverResult, wiseResult);
    c.set(code, { data: merged, expiresAt: Date.now() + TTL_MS });
    return merged;
  })().finally(() => {
    flight.delete(code);
  });
  flight.set(code, promise);
  return promise;
}

// 테스트/관리자용 — 현재 캐시 무효화
export function invalidateConsensusCache(code?: string) {
  if (code) cache().delete(code);
  else cache().clear();
}
