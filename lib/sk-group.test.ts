import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSkGroupLink,
  inheritSkLeaderEvents,
  skGroupSpilloverRate,
  SK_HYNIX_CODE,
} from "./sk-group";
import type { EventItem } from "./types";

describe("sk-group", () => {
  it("SK(주)와 SK스퀘어가 그룹 멤버", () => {
    assert.ok(getSkGroupLink("034730.KS"));
    assert.ok(getSkGroupLink("402340.KS"));
    assert.equal(getSkGroupLink("000660.KS"), null);
  });

  it("하이닉스 ADR 일정을 계열사에 상속", () => {
    const leader: EventItem[] = [
      {
        kind: "earnings",
        date: Date.now() + 7 * 86_400_000,
        label: "SK하이닉스 미국 ADR 상장",
        importance: "high",
        symbolCode: SK_HYNIX_CODE,
        detail: "ipo",
      },
    ];
    const merged = inheritSkLeaderEvents("402340.KS", [], leader);
    assert.equal(merged.length, 1);
    assert.match(merged[0].label, /하이닉스 연동/);
    assert.equal(merged[0].symbolCode, "402340.KS");
  });

  it("하이닉스 상승 예상을 SK스퀘어에 β 전달", () => {
    const spill = skGroupSpilloverRate("402340.KS", 0.05, "month");
    assert.ok(spill > 0);
    assert.ok(spill < 0.05);
  });
});
