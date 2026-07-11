import "server-only";
import { getOrFetchTtl, takeRateToken } from "./ttlCache";

/**
 * SEC EDGAR (data.sec.gov) — 미국 종목 최근 공시 약식 피처.
 * - User-Agent 필수
 * - 키 불필요 (무료)
 * - ticker→CIK 맵 24h 캐시, submissions 1h 캐시
 * - rate limit: 초당 2회
 */

const SEC_UA =
  process.env.SEC_USER_AGENT?.trim() ||
  "TickerDay/0.1 (stock-dashboard; local-dev)";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_URL = "https://data.sec.gov/submissions";

export type EdgarEventKind =
  | "8k"
  | "earnings"
  | "offering"
  | "ownership"
  | "insider"
  | "other";

export interface EdgarFiling {
  ticker: string;
  form: string;
  filedAt: string; // YYYY-MM-DD
  dateMs: number;
  kind: EdgarEventKind;
  label: string;
}

function headers(): HeadersInit {
  return {
    "User-Agent": SEC_UA,
    Accept: "application/json",
  };
}

function classifyForm(form: string): { kind: EdgarEventKind; label: string } | null {
  const f = form.toUpperCase().trim();
  if (f === "8-K" || f.startsWith("8-K/")) {
    return { kind: "8k", label: "중요공시(8-K)" };
  }
  if (f === "10-Q" || f.startsWith("10-Q")) {
    return { kind: "earnings", label: "분기실적(10-Q)" };
  }
  if (f === "10-K" || f.startsWith("10-K")) {
    return { kind: "earnings", label: "연간실적(10-K)" };
  }
  if (f === "6-K") {
    return { kind: "8k", label: "해외기업공시(6-K)" };
  }
  if (/^S-1|^424B|^F-1|^F-3|^424/.test(f)) {
    return { kind: "offering", label: "증권발행 공시" };
  }
  if (/^SC 13D|^SC 13G|^13D|^13G/.test(f)) {
    return { kind: "ownership", label: "지분공시" };
  }
  if (f === "4" || f.startsWith("4/")) {
    return { kind: "insider", label: "내부자 거래" };
  }
  return null;
}

interface TickerRow {
  cik_str: number;
  ticker: string;
  title: string;
}

async function loadTickerCikMap(): Promise<Map<string, string>> {
  if (!takeRateToken("sec", 2)) return new Map();
  const res = await fetch(TICKERS_URL, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return new Map();
  const json = (await res.json()) as Record<string, TickerRow>;
  const map = new Map<string, string>();
  for (const row of Object.values(json)) {
    if (!row?.ticker) continue;
    const cik = String(row.cik_str).padStart(10, "0");
    map.set(row.ticker.toUpperCase(), cik);
  }
  return map;
}

async function getCik(ticker: string): Promise<string | null> {
  const map = await getOrFetchTtl({
    ns: "sec-tickers",
    key: "v1",
    ttlMs: 24 * 60 * 60_000,
    fetch: loadTickerCikMap,
  });
  return map.get(ticker.toUpperCase()) ?? null;
}

interface SubmissionsJson {
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
    };
  };
}

async function loadRecentFilings(
  ticker: string,
  cik: string
): Promise<EdgarFiling[]> {
  if (!takeRateToken("sec", 2)) return [];
  const url = `${SUBMISSIONS_URL}/CIK${cik}.json`;
  const res = await fetch(url, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as SubmissionsJson;
  const forms = json.filings?.recent?.form ?? [];
  const dates = json.filings?.recent?.filingDate ?? [];
  const out: EdgarFiling[] = [];
  const cutoff = Date.now() - 21 * 86_400_000;
  const n = Math.min(forms.length, dates.length, 40);
  for (let i = 0; i < n; i++) {
    const form = forms[i] ?? "";
    const filedAt = dates[i] ?? "";
    const cls = classifyForm(form);
    if (!cls) continue;
    const dateMs = Date.parse(filedAt + "T12:00:00Z");
    if (!Number.isFinite(dateMs) || dateMs < cutoff) continue;
    out.push({
      ticker: ticker.toUpperCase(),
      form,
      filedAt,
      dateMs,
      kind: cls.kind,
      label: cls.label,
    });
  }
  return out;
}

/** 미국 티커 → 최근 8-K/10-Q 등 (캐시·rate limit) */
export async function fetchEdgarFilings(
  ticker: string
): Promise<EdgarFiling[]> {
  const t = ticker.trim().toUpperCase();
  if (!t || t.includes(".")) return []; // ADR .KS 등 스킵
  // SKHY 같은 특수 티커는 SEC에 있을 수 있음

  try {
    const cik = await getCik(t);
    if (!cik) return [];
    return await getOrFetchTtl({
      ns: "sec-subs",
      key: cik,
      ttlMs: 60 * 60_000,
      fetch: () => loadRecentFilings(t, cik),
    });
  } catch (e) {
    console.warn(
      "[edgar] fail",
      t,
      e instanceof Error ? e.message : String(e)
    );
    return [];
  }
}

export function isUsTickerCode(code: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,9}$/i.test(code) && !/\.(KS|KQ)$/i.test(code);
}
