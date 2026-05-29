import type {
  AnalysisResult,
  AnalystConsensus,
  FlowData,
  MarketIndicator,
  Quote,
  SignalStatus,
  TechIndicators,
  Valuation,
} from "../types";

// 분석 입력. provider에서 모은 1차 데이터.
export interface AnalyzeInput {
  quote: Quote;
  tech: TechIndicators;
  flow: FlowData;
  // 펀더멘털 보조 (캐시) — 없을 수 있음.
  consensus?: AnalystConsensus | null;
  valuation?: Valuation | null;
  // 시장 컨텍스트 (반도체 강세 여부 등 평가용)
  context: {
    semiHeat: number; // 0~100, 반도체 섹터 과열도
    nasdaqRate: number; // 나스닥 선물 등락률
    fxRate: number; // 환율 등락률 (원화 약세면 양수)
    vix: number; // VIX 수치
    overseasNightRate?: number | null; // 해외 개별 GDR/DR 등락률
  };
}

// 룰별 점수. heat = 추격 위험, buy = 매수 우위. 둘 다 0~100.
interface RuleHit {
  label: string;
  heat: number; // +면 위험↑
  buy: number; // +면 매수우위↑
  good: boolean; // 화면 노출용 (긍정/부정)
}

function isRegularMarket(marketState?: string): boolean {
  return (marketState ?? "").toUpperCase() === "REGULAR";
}

function evaluateRules(input: AnalyzeInput): RuleHit[] {
  const { quote, tech, flow, consensus, valuation, context } = input;
  const hits: RuleHit[] = [];
  const flowWeight = flow.source === "mock" ? 0.35 : 1;
  const flowSuffix = flow.source === "mock" ? " (mock 가중치 축소)" : "";

  // 1) 단기 등락률
  const r = quote.changeRate;
  if (r >= 0.04) hits.push({ label: "오늘 +4% 이상 급등", heat: 25, buy: -10, good: false });
  else if (r >= 0.02) hits.push({ label: "오늘 +2% 강세", heat: 10, buy: 0, good: true });
  else if (r <= -0.03) hits.push({ label: "오늘 -3% 이상 급락", heat: -10, buy: 15, good: true });

  // 2) RSI 과열/침체
  if (tech.rsi14 != null) {
    if (tech.rsi14 >= 75) hits.push({ label: `RSI ${tech.rsi14.toFixed(0)} 과열`, heat: 20, buy: -10, good: false });
    else if (tech.rsi14 >= 65) hits.push({ label: `RSI ${tech.rsi14.toFixed(0)} 다소 과열`, heat: 10, buy: -5, good: false });
    else if (tech.rsi14 <= 30) hits.push({ label: `RSI ${tech.rsi14.toFixed(0)} 침체권`, heat: -15, buy: 20, good: true });
    else if (tech.rsi14 <= 40) hits.push({ label: `RSI ${tech.rsi14.toFixed(0)} 약세권`, heat: -5, buy: 10, good: true });
  }

  // 3) 이평선 정배열 / 데드크로스
  if (tech.sma5 != null && tech.sma20 != null) {
    if (tech.sma5 > tech.sma20 * 1.01) hits.push({ label: "단기 이평 상향 (5>20)", heat: 5, buy: 10, good: true });
    if (tech.sma5 < tech.sma20 * 0.99) hits.push({ label: "단기 이평 하향 (5<20)", heat: -5, buy: -10, good: false });
  }

  // 4) 외인 수급
  if (flow.foreignNet != null) {
    if (flow.foreignNet > 5e10) hits.push({ label: `외인 +500억 이상 순매수${flowSuffix}`, heat: Math.round(-5 * flowWeight), buy: Math.round(20 * flowWeight), good: true });
    else if (flow.foreignNet > 1e10) hits.push({ label: `외인 순매수${flowSuffix}`, heat: 0, buy: Math.round(10 * flowWeight), good: true });
    else if (flow.foreignNet < -5e10) hits.push({ label: `외인 -500억 이상 순매도${flowSuffix}`, heat: Math.round(5 * flowWeight), buy: Math.round(-20 * flowWeight), good: false });
    else if (flow.foreignNet < -1e10) hits.push({ label: `외인 순매도${flowSuffix}`, heat: Math.round(5 * flowWeight), buy: Math.round(-10 * flowWeight), good: false });
  }

  // 5) 기관 수급
  if (flow.institutionNet != null) {
    if (flow.institutionNet > 3e10) hits.push({ label: `기관 순매수${flowSuffix}`, heat: 0, buy: Math.round(10 * flowWeight), good: true });
    else if (flow.institutionNet < -3e10) hits.push({ label: `기관 순매도${flowSuffix}`, heat: 0, buy: Math.round(-10 * flowWeight), good: false });
  }

  // 6) 시장 컨텍스트 — 반도체 종목은 SOX/NVDA에 민감
  if (context.semiHeat >= 70) hits.push({ label: "미국 반도체 과열", heat: 10, buy: -10, good: false });
  if (context.semiHeat <= 35) hits.push({ label: "미국 반도체 약세", heat: 5, buy: -15, good: false });
  if (context.semiHeat > 40 && context.semiHeat < 65) hits.push({ label: "미국 반도체 안정", heat: 0, buy: 5, good: true });

  // 7) 환율 — 원화 급격한 약세는 외인 이탈 신호
  if (context.fxRate >= 0.005) hits.push({ label: "환율 급등 (원화 약세)", heat: 10, buy: -10, good: false });
  if (context.fxRate <= -0.005) hits.push({ label: "환율 안정/하락", heat: -5, buy: 5, good: true });

  // 8) VIX
  if (context.vix >= 25) hits.push({ label: `VIX ${context.vix.toFixed(0)} 변동성 경계`, heat: 15, buy: -10, good: false });

  // 9) 나스닥 선물
  if (context.nasdaqRate >= 0.005) hits.push({ label: "나스닥 선물 강세", heat: 0, buy: 10, good: true });
  if (context.nasdaqRate <= -0.01) hits.push({ label: "나스닥 선물 약세", heat: 10, buy: -10, good: false });

  // 10) 해외 개별 야간 지표(GDR/DR). 토글이 켜졌을 때만 들어온다.
  if (context.overseasNightRate != null) {
    const nr = context.overseasNightRate;
    if (nr >= 0.03) hits.push({ label: "해외 개별 야간 +3% 이상", heat: 8, buy: 12, good: true });
    else if (nr >= 0.01) hits.push({ label: "해외 개별 야간 강세", heat: 3, buy: 8, good: true });
    else if (nr <= -0.03) hits.push({ label: "해외 개별 야간 -3% 이상", heat: 12, buy: -12, good: false });
    else if (nr <= -0.01) hits.push({ label: "해외 개별 야간 약세", heat: 8, buy: -8, good: false });
  }

  // 11) 밸류에이션 부담. 캐시된 valuation(Yahoo+네이버 머지)이 있으면 우선 사용,
  //     없으면 quote.valuation으로 fallback.
  const per = valuation?.per ?? quote.valuation?.per ?? null;
  const forwardPer =
    valuation?.forwardPer ?? quote.valuation?.forwardPer ?? null;
  const pbr = valuation?.pbr ?? quote.valuation?.pbr ?? null;
  const activePer = forwardPer ?? per;

  if (per != null) {
    if (per >= 150) hits.push({ label: `PER ${per.toFixed(0)}배 초고평가 부담`, heat: 28, buy: -18, good: false });
    else if (per >= 80) hits.push({ label: `PER ${per.toFixed(0)}배 고평가 부담`, heat: 20, buy: -12, good: false });
    else if (per >= 40) hits.push({ label: `PER ${per.toFixed(0)}배 다소 부담`, heat: 10, buy: -5, good: false });
  }

  if (activePer != null && activePer <= 12 && per != null && per < 40) {
    hits.push({ label: `PER ${activePer.toFixed(1)}배 저평가 구간`, heat: -5, buy: 8, good: true });
  }

  // 12) 추정 PER (forwardPer) — 다음 실적 기준 저평가/고평가.
  //     "현재 PER이 비싸도 내년 실적 대비로는 싸다" 같은 케이스를 잡는다.
  if (forwardPer != null) {
    if (forwardPer < 8) {
      hits.push({
        label: `추정PER ${forwardPer.toFixed(1)}배 — 내년 실적 대비 매우 저렴`,
        heat: -5,
        buy: 15,
        good: true,
      });
    } else if (forwardPer < 10) {
      hits.push({
        label: `추정PER ${forwardPer.toFixed(1)}배 저평가`,
        heat: -3,
        buy: 10,
        good: true,
      });
    } else if (forwardPer > 40) {
      hits.push({
        label: `추정PER ${forwardPer.toFixed(0)}배 — 다음 실적 대비도 부담`,
        heat: 10,
        buy: -5,
        good: false,
      });
    } else if (forwardPer > 25) {
      hits.push({
        label: `추정PER ${forwardPer.toFixed(0)}배 — 다음 실적 부담`,
        heat: 5,
        buy: 0,
        good: false,
      });
    }
  }

  if (pbr != null) {
    if (pbr >= 8) hits.push({ label: `PBR ${pbr.toFixed(1)}배 — 자산가치 대비 매우 부담`, heat: 20, buy: -10, good: false });
    else if (pbr >= 5) hits.push({ label: `PBR ${pbr.toFixed(1)}배 자산가치 부담`, heat: 15, buy: -10, good: false });
    else if (pbr >= 3) hits.push({ label: `PBR ${pbr.toFixed(1)}배 다소 부담`, heat: 8, buy: -5, good: false });
    else if (pbr < 1.0) hits.push({ label: `PBR ${pbr.toFixed(2)}배 — 청산가치 이하`, heat: -3, buy: 5, good: true });
  }

  // 13) 컨센서스 목표가 대비 상승여력. 단기 기술이 과열이어도 펀더멘털 여력이 크면
  //     관망이 아니라 분할 진입이 우위. 반대로 이미 컨센 평균을 크게 초과하면 비중 축소.
  if (consensus?.upsidePercent != null) {
    const up = consensus.upsidePercent;
    if (up <= -0.25) {
      hits.push({
        label: `컨센서스 평균 대비 ${(up * 100).toFixed(0)}% — 25% 이상 고평가`,
        heat: 10,
        buy: -25,
        good: false,
      });
    } else if (up <= -0.1) {
      hits.push({
        label: `컨센서스 평균 대비 ${(up * 100).toFixed(0)}% — 이미 목표가 초과`,
        heat: 5,
        buy: -15,
        good: false,
      });
    } else if (up <= -0.05) {
      hits.push({
        label: `컨센서스 평균 대비 ${(up * 100).toFixed(0)}% — 여력 제한적`,
        heat: 0,
        buy: -5,
        good: false,
      });
    } else if (up < 0.1) {
      // 0% ~ +10%
      hits.push({
        label: `컨센서스 대비 +${(up * 100).toFixed(0)}% 여력`,
        heat: 0,
        buy: 5,
        good: true,
      });
    } else if (up < 0.2) {
      hits.push({
        label: `컨센서스 대비 +${(up * 100).toFixed(0)}% 상승여력`,
        heat: -5,
        buy: 15,
        good: true,
      });
    } else {
      hits.push({
        label: `컨센서스 대비 +${(up * 100).toFixed(0)}% 상승여력`,
        heat: -10,
        buy: 25,
        good: true,
      });
    }
  }

  // 14) 컨센서스 최고가 보너스. mean으로는 -10%여도 high가 +30% 이상이면
  //     "범위 안에 강세 시나리오 존재" — 약한 보너스만.
  if (consensus?.targetHigh != null && quote.price > 0) {
    const highUp = consensus.targetHigh / quote.price - 1;
    if (highUp >= 0.5) {
      hits.push({
        label: `최고 컨센서스 +${(highUp * 100).toFixed(0)}% — 강세 시나리오 존재`,
        heat: -3,
        buy: 8,
        good: true,
      });
    } else if (highUp >= 0.3) {
      hits.push({
        label: `최고 컨센서스 +${(highUp * 100).toFixed(0)}% 여지`,
        heat: -2,
        buy: 5,
        good: true,
      });
    }
  }

  // 15) 애널리스트 분포. Yahoo 기반(strongBuy/buy/hold/sell/strongSell). 한국 종목은
  //     네이버에 분포 데이터가 없어 0,0,0,0,0이면 룰 미적용.
  if (consensus) {
    const total =
      consensus.strongBuy +
      consensus.buy +
      consensus.hold +
      consensus.sell +
      consensus.strongSell;
    if (total >= 5) {
      const strongBuyShare = consensus.strongBuy / total;
      const buyShare = (consensus.strongBuy + consensus.buy) / total;
      const holdShare = consensus.hold / total;
      const sellShare = (consensus.sell + consensus.strongSell) / total;

      if (strongBuyShare >= 0.25 && consensus.sell + consensus.strongSell === 0) {
        hits.push({
          label: `Strong Buy 비중 ${(strongBuyShare * 100).toFixed(0)}%·매도 0`,
          heat: -3,
          buy: 15,
          good: true,
        });
      } else if (buyShare >= 0.7 && sellShare <= 0.05) {
        hits.push({
          label: `매수 의견 ${(buyShare * 100).toFixed(0)}% 우세`,
          heat: 0,
          buy: 10,
          good: true,
        });
      }

      if (sellShare >= 0.2) {
        hits.push({
          label: `매도 의견 ${(sellShare * 100).toFixed(0)}% — 분포 부정적`,
          heat: 5,
          buy: -15,
          good: false,
        });
      } else if (holdShare >= 0.5) {
        hits.push({
          label: `Hold 비중 ${(holdShare * 100).toFixed(0)}% — 의견 보수적`,
          heat: 0,
          buy: -5,
          good: false,
        });
      }
    }
  }

  return hits;
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function decideSignal(heat: number, buy: number, marketState?: string): SignalStatus {
  // 장중/비장중 임계값을 분리한다.
  // 강한 매수 근거가 있으면 과열만으로 바로 관망/축소로 밀지 않는다.
  // 추가: 펀더멘털·컨센이 강해 buy 점수가 매우 높으면 (>=85) 단기 과열(heat 65~78)이어도
  //       관망이 아니라 ADD 우위로 본다. 사용자 피드백: "230대인데 관망만 하면 옳지 않다".
  if (isRegularMarket(marketState)) {
    // 강한 buy(>=85)면 단기 과열을 덮어 SELL을 회피.
    if (heat >= 80 && buy <= 35) return "SELL";
    if (buy >= 68 && heat <= 55) return "BUY";
    if (buy >= 90 && heat <= 80) return "ADD"; // 강한 매수 근거가 단기 과열을 덮음
    if (buy >= 56 && heat <= 62) return "ADD";
    if (heat >= 65 && buy < 60) return "WATCH";
    if (buy <= 35 && heat <= 45) return "WATCH";
    return "HOLD";
  }

  // 비장중은 보수적으로 보되, 해외 야간 강세 같은 보조 근거가 있으면 기회를 남긴다.
  if (heat >= 82 && buy <= 32) return "SELL";
  if (buy >= 72 && heat <= 52) return "BUY";
  if (buy >= 90 && heat <= 80) return "ADD";
  if (buy >= 58 && heat <= 62) return "ADD";
  if (heat >= 65 && buy < 62) return "WATCH";
  if (buy <= 35 && heat <= 45) return "WATCH";
  return "HOLD";
}

// 펀더멘털 강도: 컨센 상승여력 + 추정PER 저평가 → 단기 과열을 일부 상쇄해 메시지를 바꾼다.
function fundamentalStrength(
  consensus?: AnalystConsensus | null,
  valuation?: Valuation | null
): "strong" | "weak" | "neutral" {
  let score = 0;
  if (consensus?.upsidePercent != null) {
    if (consensus.upsidePercent >= 0.15) score += 2;
    else if (consensus.upsidePercent >= 0.05) score += 1;
    else if (consensus.upsidePercent <= -0.15) score -= 2;
    else if (consensus.upsidePercent <= -0.05) score -= 1;
  }
  if (valuation?.forwardPer != null) {
    if (valuation.forwardPer < 8) score += 2;
    else if (valuation.forwardPer < 12) score += 1;
    else if (valuation.forwardPer > 30) score -= 1;
  }
  if (score >= 2) return "strong";
  if (score <= -2) return "weak";
  return "neutral";
}

function headlineFor(
  signal: SignalStatus,
  heat: number,
  buy: number,
  consensus?: AnalystConsensus | null,
  valuation?: Valuation | null
): string {
  const f = fundamentalStrength(consensus, valuation);

  switch (signal) {
    case "BUY":
      return "지금 신규 진입 우위";
    case "ADD":
      if (f === "strong") return "장기 펀더멘털 양호 — 분할 진입 우위";
      return "눌림목 분할매수 우위";
    case "HOLD":
      if (f === "strong" && heat >= 60)
        return "장기 펀더멘털 양호, 단기 과열 — 분할 진입 고려";
      if (f === "weak") return "보유 유지 / 신규 진입은 신중";
      return "보유 유지 / 추격은 자제";
    case "WATCH":
      if (f === "strong" && heat >= 60)
        return "장기 컨센서스 양호, 단기 과열 — 분할 진입 고려";
      return heat >= 60 ? "과열 구간 — 눌림 확인" : "방향성 확인 필요";
    case "SELL":
      if (f === "weak") return "컨센 대비 고평가 + 약세 — 비중 축소 고려";
      return "과열 + 약세 신호 — 일부 익절 검토";
  }
}

export function analyze(input: AnalyzeInput): AnalysisResult {
  const hits = evaluateRules(input);

  // 베이스 50점에서 출발해 룰별 가감산
  let heat = 50;
  let buy = 50;
  for (const h of hits) {
    heat += h.heat;
    buy += h.buy;
  }
  heat = clamp(heat);
  buy = clamp(buy);

  const signal = decideSignal(heat, buy, input.quote.marketState);
  const headlineBase = headlineFor(
    signal,
    heat,
    buy,
    input.consensus,
    input.valuation
  );
  const headline = isRegularMarket(input.quote.marketState)
    ? headlineBase
    : `${headlineBase} (비장중 기준)`;

  // 사용자에게 보일 근거 3줄: 영향이 큰 순서로
  const reasons = hits
    .map((h) => ({ ...h, weight: Math.abs(h.heat) + Math.abs(h.buy) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((h) => `${h.good ? "+ " : "− "}${h.label}`);

  if (!isRegularMarket(input.quote.marketState)) {
    reasons.unshift("· 비장중이라 종가/야간 지표 기준으로 판정");
  }

  if (reasons.length === 0) reasons.push("특이 신호 없음");

  return { signal, heatScore: heat, buyScore: buy, headline, reasons: reasons.slice(0, 3) };
}

// 시장 분위기 라벨링 (강세/중립/약세)
export function marketMoodLabel(
  indicators: MarketIndicator[]
): "강세" | "중립" | "약세" {
  const nasdaq = indicators.find((i) => i.code === "NQ=F");
  const sox = indicators.find((i) => i.code === "^SOX");
  const vix = indicators.find((i) => i.code === "^VIX");
  const fx = indicators.find((i) => i.code === "KRW=X");

  let score = 0;
  if (nasdaq) score += nasdaq.changeRate * 100;
  if (sox) score += sox.changeRate * 100 * 1.5;
  if (vix && vix.value >= 25) score -= 1;
  if (fx && fx.changeRate >= 0.005) score -= 1;

  if (score >= 1) return "강세";
  if (score <= -1) return "약세";
  return "중립";
}
