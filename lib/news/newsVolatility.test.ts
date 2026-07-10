import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeNewsVolatility } from "./newsVolatility";
import { usMarketDrift } from "../analyzer/marketDrift";
import type { NewsRiskAssessment, NewsRiskDriver } from "../types";

function driver(category: string, label: string): NewsRiskDriver {
  return {
    label,
    category: category as NewsRiskDriver["category"],
    headline: `${label} 헤드라인`,
    date: Date.now(),
    weight: 4,
    contribution: 2.8,
  };
}

function risk(
  score: number,
  drivers: NewsRiskDriver[]
): NewsRiskAssessment {
  const level = score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  return { level, score, drivers, matchCount: drivers.length };
}

describe("newsVolatility — 뉴스 리스크 σ 확대", () => {
  it("리스크 없음/저점수 → factor 1 (확대 없음)", () => {
    assert.equal(computeNewsVolatility(null).factor, 1);
    assert.equal(
      computeNewsVolatility(risk(10, [driver("실적", "하락")])).factor,
      1
    );
  });

  it("지정학 주도 high 리스크 → σ 확대 + 지정학 라벨", () => {
    const r = computeNewsVolatility(
      risk(70, [driver("지정학", "지정학 충돌"), driver("경기", "공포·우려")])
    );
    assert.ok(r.factor > 1.1, `factor ${r.factor} > 1.1 이어야 함`);
    assert.ok(r.factor <= 1.25, "지정학 상한 1.25");
    assert.equal(r.geoDriven, true);
    assert.equal(r.label, "지정학 리스크 ↑ 변동성 확대");
    assert.equal(r.topDriver, "지정학 충돌");
  });

  it("관세·제재도 지정학성으로 취급", () => {
    const r = computeNewsVolatility(risk(50, [driver("관세", "관세")]));
    assert.equal(r.geoDriven, true);
    assert.ok(r.factor > 1);
  });

  it("일반(실적) 리스크는 지정학보다 확대 폭 작음 + 별도 상한", () => {
    const geo = computeNewsVolatility(risk(60, [driver("지정학", "지역 긴장")]));
    const gen = computeNewsVolatility(risk(60, [driver("실적", "실적쇼크")]));
    assert.ok(gen.factor > 1, "medium 이상이면 소폭 확대");
    assert.ok(gen.factor < geo.factor, "일반 < 지정학");
    assert.ok(gen.factor <= 1.12, "일반 상한 1.12");
    assert.equal(gen.geoDriven, false);
    assert.equal(gen.label, "뉴스 리스크 ↑ 변동성 확대");
  });

  it("점수 최대(100)여도 상한 밖으로 안 나감", () => {
    const r = computeNewsVolatility(risk(100, [driver("지정학", "전쟁")]));
    assert.equal(r.factor, 1.2); // 1 + 1.0×0.2 = 1.2 < cap 1.25
  });
});

describe("marketDrift — 미장(IXIC) lag drift", () => {
  it("입력 없으면 0", () => {
    assert.equal(usMarketDrift(null, null, null), 0);
    assert.equal(usMarketDrift(1.2, 0.5, null), 0);
  });

  it("나스닥 상승 × 양의 β → 양의 drift (방향성)", () => {
    const d = usMarketDrift(1.2, 0.6, 0.01); // 나스닥 +1%
    assert.ok(d > 0);
    // 1.2 × 0.01 × min(1, 0.8) = 0.0096 → cap 0.008
    assert.equal(d, 0.008);
  });

  it("나스닥 하락 → 음의 drift, R² 낮으면 축소", () => {
    const strong = usMarketDrift(1.0, 0.8, -0.005);
    const weak = usMarketDrift(1.0, 0.05, -0.005);
    assert.ok(strong < 0 && weak < 0);
    assert.ok(Math.abs(weak) < Math.abs(strong), "낮은 R² → 가중 축소");
  });

  it("상한 ±0.8% 클램프", () => {
    assert.equal(usMarketDrift(2.0, 1.0, 0.03), 0.008);
    assert.equal(usMarketDrift(2.0, 1.0, -0.03), -0.008);
  });
});
