import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyDartReport } from "../providers/opendartClassify";
import {
  disclosureFactorsFromDart,
  disclosureFactorsFromEdgar,
  mergeDisclosureFactors,
  type DartFilingLike,
  type EdgarFilingLike,
} from "./disclosureFeatures";
import { computeOrderbookSignal } from "./orderbookSignal";

describe("disclosureFeatures", () => {
  it("classifyDartReport maps 유상증자·실적·지분", () => {
    assert.equal(classifyDartReport("유상증자결정").kind, "dilution");
    assert.equal(classifyDartReport("분기보고서 (2025.03)").kind, "earnings");
    assert.equal(
      classifyDartReport("주식등의대량보유상황보고서").kind,
      "ownership"
    );
    assert.equal(classifyDartReport("자기주식취득결정").kind, "buyback");
    assert.equal(classifyDartReport("주주환원").kind, "buyback");
  });

  it("dart dilution → negative bps chip", () => {
    const now = Date.now();
    const filings: DartFilingLike[] = [
      {
        kind: "dilution",
        label: "유상·전환 공시",
        dateMs: now - 12 * 3600_000,
      },
    ];
    const factors = disclosureFactorsFromDart(filings, now);
    assert.ok(factors.length >= 1);
    assert.ok(factors[0]!.bps < 0);
    assert.match(factors[0]!.label, /유상|공시/);
  });

  it("edgar 8-K → positive-ish attention bps", () => {
    const now = Date.now();
    const filings: EdgarFilingLike[] = [
      {
        kind: "8k",
        label: "중요공시(8-K)",
        dateMs: now - 6 * 3600_000,
      },
    ];
    const factors = disclosureFactorsFromEdgar(filings, now);
    assert.ok(factors.some((f) => f.id === "sec-8k" && f.bps > 0));
  });

  it("merge caps to 4", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `dart-x${i}`,
      label: `공시${i}`,
      bps: 10 + i,
    }));
    assert.equal(mergeDisclosureFactors(many, []).length, 4);
  });
});

describe("orderbookSignal", () => {
  it("returns null factor without levels", () => {
    assert.equal(computeOrderbookSignal(null).factor, null);
  });

  it("bid-heavy book → 호가 매수우위", () => {
    const sig = computeOrderbookSignal({
      levels: [
        { askPrice: 101, askQty: 100, bidPrice: 100, bidQty: 500 },
      ],
      totalAskQty: 200,
      totalBidQty: 2000,
      ccldStrength: 140,
      fetchedAt: Date.now(),
    });
    assert.ok(sig.factor);
    assert.ok(sig.factor!.bps > 0);
    assert.equal(sig.factor!.label, "호가 매수우위");
  });
});
