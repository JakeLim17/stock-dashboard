import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shareholderReturnFactorFromNews } from "./shareholderReturn";

describe("shareholderReturnFactorFromNews", () => {
  it("하이닉스 주주환원 계획 → 공시·환원 호재 칩", () => {
    const now = Date.now();
    const f = shareholderReturnFactorFromNews(
      [
        {
          title: "SK하이닉스, 대규모 주주환원 계획 발표",
          publishedAt: now - 2 * 3600_000,
          symbol: "000660.KS",
        },
      ],
      now
    );
    assert.ok(f);
    assert.equal(f!.id, "disclosure-return");
    assert.match(f!.label, /^공시·환원 호재 \+/);
    assert.ok(f!.bps >= 40 && f!.bps <= 80);
  });

  it("자사주 매입도 양수", () => {
    const now = Date.now();
    const f = shareholderReturnFactorFromNews(
      [
        {
          title: "자기주식 취득 결정",
          publishedAt: now - 3600_000,
        },
      ],
      now
    );
    assert.ok(f);
    assert.ok(f!.bps > 0);
  });

  it("배당 삭감은 스킵", () => {
    const now = Date.now();
    const f = shareholderReturnFactorFromNews(
      [{ title: "배당 삭감 결정", publishedAt: now }],
      now
    );
    assert.equal(f, null);
  });
});
