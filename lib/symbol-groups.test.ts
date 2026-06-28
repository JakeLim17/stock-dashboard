import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getGroupCatalystPeer,
  spilloverLeaderEvents,
} from "./symbol-groups";
import type { EventItem } from "./types";

describe("symbol-groups", () => {
  it("SK스퀘어는 하이닉스 리더에 연동", () => {
    const peer = getGroupCatalystPeer("402340.KS");
    assert.ok(peer);
    assert.equal(peer!.leaderCode, "000660.KS");
    assert.ok(peer!.catalystShare > 0.8);
  });

  it("SK 지주는 하이닉스 일정을 전이", () => {
    const leaderEvent: EventItem = {
      kind: "earnings",
      date: Date.now() + 10 * 86_400_000,
      label: "SK하이닉스 미국 ADR 상장",
      importance: "high",
      symbolCode: "000660.KS",
      detail: "ipo",
    };
    const spilled = spilloverLeaderEvents("034730.KS", [leaderEvent]);
    assert.equal(spilled.length, 1);
    assert.equal(spilled[0]!.symbolCode, "034730.KS");
    assert.match(spilled[0]!.detail ?? "", /호재|연동/);
  });
});
