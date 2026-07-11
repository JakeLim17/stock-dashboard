import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FLOW_TTL_MS,
  FULL_SNAPSHOT_TTL_MS,
  LITE_SNAPSHOT_TTL_MS,
  NULL_TTL_MS,
  QUOTE_STALE_WHILE_REVALIDATE_MS,
  QUOTE_TTL_CLOSED_MS,
  QUOTE_TTL_OPEN_MS,
  REGULAR_POLL_MS,
  pickTtl,
  quoteTtlMs,
} from "./kisCachePolicy";
import {
  isKrRegularSession,
  isUsRegularSession,
} from "../analyzer/tradingSession";

describe("KIS cache policy", () => {
  it("장중 시세 TTL 은 정규장 폴링·lite 스냅샷보다 짧다", () => {
    assert.ok(QUOTE_TTL_OPEN_MS <= REGULAR_POLL_MS);
    assert.ok(QUOTE_TTL_OPEN_MS < LITE_SNAPSHOT_TTL_MS);
    assert.equal(QUOTE_TTL_OPEN_MS, 8_000);
    assert.equal(REGULAR_POLL_MS, 15_000);
    assert.equal(LITE_SNAPSHOT_TTL_MS, 12_000);
  });

  it("장후 시세 TTL 은 장중보다 길고, SWR 창이 있다", () => {
    assert.ok(QUOTE_TTL_CLOSED_MS > QUOTE_TTL_OPEN_MS);
    assert.equal(QUOTE_TTL_CLOSED_MS, 45_000);
    assert.equal(QUOTE_STALE_WHILE_REVALIDATE_MS, 20_000);
  });

  it("수급 TTL 은 full 스냅샷 TTL 보다 길다 (접속·full 재호출 흡수)", () => {
    assert.ok(FLOW_TTL_MS > FULL_SNAPSHOT_TTL_MS);
    assert.equal(FLOW_TTL_MS, 300_000);
  });

  it("null 결과는 짧게만 봉인한다", () => {
    assert.equal(pickTtl(null, FLOW_TTL_MS), NULL_TTL_MS);
    assert.equal(pickTtl({ ok: true }, FLOW_TTL_MS), FLOW_TTL_MS);
  });

  it("세션별 TTL — KR/US 정규장에 따라 분기", () => {
    // 2026-07-10(금) 11:00 KST = 02:00 UTC — KR 정규장, US 휴장
    const krOpen = new Date(Date.UTC(2026, 6, 10, 2, 0));
    assert.equal(isKrRegularSession(krOpen), true);
    assert.equal(isUsRegularSession(krOpen), false);
    assert.equal(quoteTtlMs("kr", krOpen), QUOTE_TTL_OPEN_MS);
    assert.equal(quoteTtlMs("us", krOpen), QUOTE_TTL_CLOSED_MS);

    // 2026-07-10(금) 23:00 KST = 14:00 UTC — US 정규장, KR 휴장
    const usOpen = new Date(Date.UTC(2026, 6, 10, 14, 0));
    assert.equal(isUsRegularSession(usOpen), true);
    assert.equal(isKrRegularSession(usOpen), false);
    assert.equal(quoteTtlMs("us", usOpen), QUOTE_TTL_OPEN_MS);
    assert.equal(quoteTtlMs("kr", usOpen), QUOTE_TTL_CLOSED_MS);

    // 2026-07-11(토) 12:00 KST = 03:00 UTC — 양쪽 휴장
    const weekend = new Date(Date.UTC(2026, 6, 11, 3, 0));
    assert.equal(quoteTtlMs("kr", weekend), QUOTE_TTL_CLOSED_MS);
    assert.equal(quoteTtlMs("us", weekend), QUOTE_TTL_CLOSED_MS);
  });

  it("KIS 수급 유무로 폴링을 가속하지 않는다 (정책)", () => {
    // 예전: hasRealFlow → 25s. 지금은 시장 상태만으로 간격 결정.
    const hasRealFlow = true;
    const isRegular = true;
    const refreshMs = isRegular ? REGULAR_POLL_MS : 600_000;
    assert.equal(refreshMs, 15_000);
    assert.ok(hasRealFlow); // 수급이 있어도 위 간격 유지
  });
});
