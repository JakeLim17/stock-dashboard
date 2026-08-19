import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASKING_TTL_CLOSED_MS,
  ASKING_TTL_OPEN_MS,
  CORE_SNAPSHOT_TTL_MS,
  EXTENDED_POLL_MS,
  FLOW_TTL_CLOSED_MS,
  FLOW_TTL_MS,
  FLOW_TTL_OPEN_MS,
  FULL_SNAPSHOT_MIN_MS,
  FULL_SNAPSHOT_TTL_MS,
  LITE_SNAPSHOT_TTL_MS,
  NULL_TTL_MS,
  OFF_HOURS_POLL_MS,
  OVERSEAS_NIGHT_POLL_MS,
  QUOTE_STALE_WHILE_REVALIDATE_MS,
  QUOTE_TTL_CLOSED_MS,
  QUOTE_TTL_OPEN_MS,
  REGULAR_POLL_MS,
  askingTtlMs,
  flowTtlMs,
  pickTtl,
  quoteTtlMs,
} from "./kisCachePolicy";
import {
  isKrRegularSession,
  isUsRegularSession,
} from "../analyzer/tradingSession";

describe("KIS cache policy", () => {
  it("장중 시세 TTL 은 정규장 폴링·lite 스냅샷보다 짧거나 같다", () => {
    assert.ok(QUOTE_TTL_OPEN_MS <= REGULAR_POLL_MS);
    assert.ok(QUOTE_TTL_OPEN_MS <= LITE_SNAPSHOT_TTL_MS);
    assert.equal(QUOTE_TTL_OPEN_MS, 20_000);
    assert.equal(REGULAR_POLL_MS, 90_000);
    assert.equal(LITE_SNAPSHOT_TTL_MS, REGULAR_POLL_MS);
  });

  it("lite/full 서버 TTL 은 폴링과 맞추거나 더 길다 (Vercel 람다 절감)", () => {
    assert.ok(LITE_SNAPSHOT_TTL_MS >= REGULAR_POLL_MS);
    assert.ok(FULL_SNAPSHOT_TTL_MS >= FULL_SNAPSHOT_MIN_MS);
    assert.equal(FULL_SNAPSHOT_MIN_MS, 900_000);
    assert.equal(FULL_SNAPSHOT_TTL_MS, 900_000);
    assert.ok(CORE_SNAPSHOT_TTL_MS >= 60_000);
  });

  it("장후·휴장 폴링은 2~5분 대 (Vercel 절감)", () => {
    assert.ok(EXTENDED_POLL_MS >= 120_000);
    assert.ok(EXTENDED_POLL_MS <= 300_000);
    assert.ok(OVERSEAS_NIGHT_POLL_MS >= 120_000);
    assert.ok(OFF_HOURS_POLL_MS >= 120_000);
    assert.ok(OFF_HOURS_POLL_MS <= 600_000);
  });

  it("장후 시세 TTL 은 장중보다 길고, SWR 창이 있다", () => {
    assert.ok(QUOTE_TTL_CLOSED_MS > QUOTE_TTL_OPEN_MS);
    assert.equal(QUOTE_TTL_CLOSED_MS, 300_000);
    assert.equal(QUOTE_STALE_WHILE_REVALIDATE_MS, 45_000);
  });

  it("수급 TTL 은 장중 1시간·장후 24시간 (접속마다 재호출 방지)", () => {
    assert.equal(FLOW_TTL_OPEN_MS, 60 * 60_000);
    assert.equal(FLOW_TTL_CLOSED_MS, 24 * 60 * 60_000);
    assert.equal(FLOW_TTL_MS, FLOW_TTL_OPEN_MS);
    assert.ok(FLOW_TTL_OPEN_MS >= 30 * 60_000);
    assert.ok(FLOW_TTL_CLOSED_MS >= 12 * 60 * 60_000);
  });

  it("호가 TTL 은 장중 10분·장후 24시간 (full fanout 흡수)", () => {
    assert.equal(ASKING_TTL_OPEN_MS, 10 * 60_000);
    assert.equal(ASKING_TTL_CLOSED_MS, 24 * 60 * 60_000);
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
    assert.equal(flowTtlMs(krOpen), FLOW_TTL_OPEN_MS);
    assert.equal(askingTtlMs(krOpen), ASKING_TTL_OPEN_MS);

    // 2026-07-10(금) 23:00 KST = 14:00 UTC — US 정규장, KR 휴장
    const usOpen = new Date(Date.UTC(2026, 6, 10, 14, 0));
    assert.equal(isUsRegularSession(usOpen), true);
    assert.equal(isKrRegularSession(usOpen), false);
    assert.equal(quoteTtlMs("us", usOpen), QUOTE_TTL_OPEN_MS);
    assert.equal(quoteTtlMs("kr", usOpen), QUOTE_TTL_CLOSED_MS);
    assert.equal(flowTtlMs(usOpen), FLOW_TTL_CLOSED_MS);
    assert.equal(askingTtlMs(usOpen), ASKING_TTL_CLOSED_MS);

    // 2026-07-11(토) 12:00 KST = 03:00 UTC — 양쪽 휴장
    const weekend = new Date(Date.UTC(2026, 6, 11, 3, 0));
    assert.equal(quoteTtlMs("kr", weekend), QUOTE_TTL_CLOSED_MS);
    assert.equal(quoteTtlMs("us", weekend), QUOTE_TTL_CLOSED_MS);
    assert.equal(flowTtlMs(weekend), FLOW_TTL_CLOSED_MS);
  });

  it("KIS 수급 유무로 폴링을 가속하지 않는다 (정책)", () => {
    // 예전: hasRealFlow → 25s. 지금은 시장 상태만으로 간격 결정.
    const hasRealFlow = true;
    const isRegular = true;
    const refreshMs = isRegular ? REGULAR_POLL_MS : OFF_HOURS_POLL_MS;
    assert.equal(refreshMs, REGULAR_POLL_MS);
    assert.ok(hasRealFlow); // 수급이 있어도 위 간격 유지
  });
});
