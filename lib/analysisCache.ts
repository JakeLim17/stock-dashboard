import "server-only";
import type { AnalysisResult, Predictions } from "./types";
import { getDb } from "./db";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간

export interface CachedAnalysisEntry {
  symbol: string;
  analysis: AnalysisResult;
  predictions: Predictions | null;
  cachedAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __analysisCacheMap: Map<string, CachedAnalysisEntry> | undefined;
}

function memCache(): Map<string, CachedAnalysisEntry> {
  if (!global.__analysisCacheMap) {
    global.__analysisCacheMap = new Map();
  }
  return global.__analysisCacheMap;
}

export function isAnalysisCacheFresh(cachedAt: number, now = Date.now()): boolean {
  return now - cachedAt < CACHE_TTL_MS;
}

export function saveAnalysisCache(entry: CachedAnalysisEntry): void {
  memCache().set(entry.symbol, entry);
  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO analysis_cache (symbol, payload, cached_at)
         VALUES (@symbol, @payload, @cachedAt)`
      )
      .run({
        symbol: entry.symbol,
        payload: JSON.stringify({
          analysis: entry.analysis,
          predictions: entry.predictions,
        }),
        cachedAt: entry.cachedAt,
      });
  } catch {
    /* serverless read-only 등 */
  }
}

export function getAnalysisCache(
  symbol: string,
  now = Date.now()
): CachedAnalysisEntry | null {
  const mem = memCache().get(symbol);
  if (mem && isAnalysisCacheFresh(mem.cachedAt, now)) return mem;

  try {
    const row = getDb()
      .prepare(
        `SELECT payload, cached_at FROM analysis_cache WHERE symbol = ? ORDER BY cached_at DESC LIMIT 1`
      )
      .get(symbol) as { payload: string; cached_at: number } | undefined;
    if (!row || !isAnalysisCacheFresh(row.cached_at, now)) return null;
    const parsed = JSON.parse(row.payload) as {
      analysis: AnalysisResult;
      predictions: Predictions | null;
    };
    const entry: CachedAnalysisEntry = {
      symbol,
      analysis: parsed.analysis,
      predictions: parsed.predictions,
      cachedAt: row.cached_at,
    };
    memCache().set(symbol, entry);
    return entry;
  } catch {
    return null;
  }
}

export function getAnalysisCacheBatch(
  symbols: string[],
  now = Date.now()
): Map<string, CachedAnalysisEntry> {
  const out = new Map<string, CachedAnalysisEntry>();
  for (const s of symbols) {
    const e = getAnalysisCache(s, now);
    if (e) out.set(s, e);
  }
  return out;
}
