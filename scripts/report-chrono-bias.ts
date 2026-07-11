/**
 * ChronoPulse 1개월 center 대비 현재가 비율 리포트.
 * 사용: npx tsx scripts/report-chrono-bias.ts [snapshot.json ...]
 */
import { readFileSync } from "node:fs";
import { buildMultiHorizonFairValue } from "../lib/fair-value";
import type { StockSnapshot } from "../lib/types";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: npx tsx scripts/report-chrono-bias.ts <snapshot.json> [...]");
  process.exit(1);
}

const snaps: StockSnapshot[] = [];
for (const f of files) {
  const d = JSON.parse(readFileSync(f, "utf8"));
  for (const s of d.primaries ?? [d]) {
    if (s?.meta?.code) snaps.push(s as StockSnapshot);
  }
}

let up = 0;
let down = 0;
let flat = 0;
let total = 0;

console.log("ChronoPulse 1개월 center ± 비율 리포트\n");
console.log(
  "code".padEnd(12),
  "현재가".padStart(10),
  "1M예측".padStart(10),
  "Δ%".padStart(8),
  "drift일".padStart(8),
  "top요인"
);

for (const snap of snaps) {
  const price = snap.quote.price;
  if (!price) continue;
  const horizons = buildMultiHorizonFairValue(snap);
  const month = horizons.find((h) => h.id === "month")?.estimate;
  if (!month?.ready) {
    console.log(`${snap.meta.code.padEnd(12)} pending`);
    continue;
  }
  total++;
  const delta = month.close.price / price - 1;
  if (delta > 0.002) up++;
  else if (delta < -0.002) down++;
  else flat++;

  const cp = snap.predictions?.chronoPulse;
  const drift = cp?.driftDaily ?? 0;
  const top = (cp?.factors ?? [])
    .filter((f) => Math.abs(f.bps) >= 1)
    .slice(0, 2)
    .map((f) => `${f.label}${f.bps >= 0 ? "+" : ""}${(f.bps / 100).toFixed(1)}%`)
    .join(", ");

  console.log(
    snap.meta.code.padEnd(12),
    Math.round(price).toLocaleString("ko-KR").padStart(10),
    Math.round(month.close.price).toLocaleString("ko-KR").padStart(10),
    `${(delta * 100).toFixed(2)}%`.padStart(8),
    `${(drift * 100).toFixed(2)}%`.padStart(8),
    top
  );
}

console.log(`\n합계 ${total}종목 — 상향 ${up} · 하향 ${down} · 보합 ${flat}`);
if (total > 0) {
  console.log(
    `상향 비율 ${((up / total) * 100).toFixed(1)}% · 하향 ${((down / total) * 100).toFixed(1)}%`
  );
}
