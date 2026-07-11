import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreHeadlineSentiment,
  assessNewsSentimentAlpha,
} from "./sentimentScore";

describe("sentimentScore", () => {
  it("scores earnings beat positive", () => {
    const r = scoreHeadlineSentiment(
      "Samsung beats estimates on HBM demand surge"
    );
    assert.ok(r.score > 0.2);
    assert.ok(r.posWeight > r.negWeight);
  });

  it("scores dilution / halt negative", () => {
    const r = scoreHeadlineSentiment("유상증자 결정에 주가 급락·거래정지 우려");
    assert.ok(r.score < -0.2);
    assert.ok(r.negWeight > r.posWeight);
  });

  it("per-symbol alpha differs by headlines", () => {
    const now = Date.now();
    const a = assessNewsSentimentAlpha(
      [
        {
          title: "AI 서버 수요 급증·대규모 수주",
          publishedAt: now - 3600_000,
          symbol: "000660.KS",
        },
      ],
      "000660.KS",
      now
    );
    const b = assessNewsSentimentAlpha(
      [
        {
          title: "유상증자·전환사채 발행 공시에 급락",
          publishedAt: now - 3600_000,
          symbol: "005930.KS",
        },
      ],
      "005930.KS",
      now
    );
    assert.ok(a.alphaBps > 0);
    assert.ok(b.alphaBps < 0);
    assert.notEqual(a.label, b.label);
  });
});
