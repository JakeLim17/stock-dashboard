import "server-only";
import { getOrFetchTtl, takeRateToken } from "./ttlCache";
import {
  classifyDartReport,
  type DartEventKind,
} from "./opendartClassify";

export type { DartEventKind };
export { classifyDartReport };

/**
 * OpenDART 공시 목록 (한국).
 * - 키 없으면 graceful empty
 * - 시장 전체 최근 공시를 페이지로 받아 stock_code 인덱스 (corp_code 불필요)
 * - TTL 30분 + 초당 2회 rate limit
 */

const OPENDART_BASE = "https://opendart.fss.or.kr/api/list.json";
const TTL_MS = 30 * 60_000;
const LOOKBACK_DAYS = 10;
/** 페이지 수↓ — 콜드 시 직렬 8s×N 이 full 스냅샷을 막던 병목 */
const MAX_PAGES = 2;
const PAGE_COUNT = 100;
const PAGE_TIMEOUT_MS = 4_000;

export interface DartFiling {
  stockCode: string;
  corpName: string;
  reportNm: string;
  rceptDt: string; // YYYYMMDD
  rceptNo: string;
  kind: DartEventKind;
  label: string;
  /** epoch ms (KST noon approx) */
  dateMs: number;
}

function getApiKey(): string | null {
  const k = process.env.OPENDART_API_KEY?.trim();
  return k || null;
}

export function openDartEnabled(): boolean {
  return !!getApiKey();
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseYmd(s: string): number {
  if (!/^\d{8}$/.test(s)) return Date.now();
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  // KST 정오 근사
  return Date.UTC(y, m, d, 3, 0, 0);
}

interface DartListRow {
  corp_code?: string;
  corp_name?: string;
  stock_code?: string;
  report_nm?: string;
  rcept_no?: string;
  rcept_dt?: string;
}

interface DartListResponse {
  status?: string;
  message?: string;
  list?: DartListRow[];
}

async function fetchDartPage(
  key: string,
  bgn: string,
  end: string,
  pageNo: number
): Promise<DartListRow[]> {
  if (!takeRateToken("opendart", 2)) {
    return [];
  }
  const url = new URL(OPENDART_BASE);
  url.searchParams.set("crtfc_key", key);
  url.searchParams.set("bgn_de", bgn);
  url.searchParams.set("end_de", end);
  url.searchParams.set("page_no", String(pageNo));
  url.searchParams.set("page_count", String(PAGE_COUNT));
  url.searchParams.set("pblntf_ty", "B");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as DartListResponse;
  if (json.status && json.status !== "000" && json.status !== "013") {
    console.warn("[opendart] status", json.status, json.message);
    return [];
  }
  return json.list ?? [];
}

async function loadDartIndex(): Promise<Map<string, DartFiling[]>> {
  const key = getApiKey();
  if (!key) return new Map();

  const end = new Date();
  const bgn = new Date(end.getTime() - LOOKBACK_DAYS * 86_400_000);
  const bgnS = ymd(bgn);
  const endS = ymd(end);

  const rows: DartListRow[] = [];
  // 페이지 병렬 — 콜드 직렬 대기를 줄임. 실패 페이지는 빈 배열.
  const pageNums = Array.from({ length: MAX_PAGES }, (_, i) => i + 1);
  const chunks = await Promise.all(
    pageNums.map((page) =>
      fetchDartPage(key, bgnS, endS, page).catch(() => [] as DartListRow[])
    )
  );
  for (const chunk of chunks) {
    rows.push(...chunk);
    if (chunk.length < PAGE_COUNT) break;
  }

  try {
    if (takeRateToken("opendart", 2)) {
      const url = new URL(OPENDART_BASE);
      url.searchParams.set("crtfc_key", key);
      url.searchParams.set("bgn_de", bgnS);
      url.searchParams.set("end_de", endS);
      url.searchParams.set("page_no", "1");
      url.searchParams.set("page_count", String(PAGE_COUNT));
      url.searchParams.set("pblntf_ty", "I");
      const res = await fetch(url.toString(), {
        cache: "no-store",
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      if (res.ok) {
        const json = (await res.json()) as DartListResponse;
        if (json.status === "000" && json.list) rows.push(...json.list);
      }
    }
  } catch {
    /* skip */
  }

  const map = new Map<string, DartFiling[]>();
  for (const r of rows) {
    const stock = (r.stock_code ?? "").trim();
    if (!stock || stock === " " || stock.length < 5) continue;
    const reportNm = (r.report_nm ?? "").trim();
    if (!reportNm) continue;
    const { kind, label } = classifyDartReport(reportNm);
    if (kind === "other") continue;
    const filing: DartFiling = {
      stockCode: stock.padStart(6, "0"),
      corpName: r.corp_name ?? "",
      reportNm,
      rceptDt: r.rcept_dt ?? "",
      rceptNo: r.rcept_no ?? "",
      kind,
      label,
      dateMs: parseYmd(r.rcept_dt ?? ""),
    };
    const list = map.get(filing.stockCode) ?? [];
    list.push(filing);
    map.set(filing.stockCode, list);
  }
  return map;
}

/** 6자리 종목코드 → 최근 이벤트 공시 (캐시) */
export async function fetchOpenDartFilings(
  stockCode6: string
): Promise<DartFiling[]> {
  if (!openDartEnabled()) return [];
  const six = stockCode6.replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (!six || six === "000000") return [];

  try {
    const index = await getOrFetchTtl({
      ns: "opendart-index",
      key: "v1",
      ttlMs: TTL_MS,
      fetch: loadDartIndex,
    });
    return index.get(six) ?? [];
  } catch (e) {
    console.warn(
      "[opendart] index fail",
      e instanceof Error ? e.message : String(e)
    );
    return [];
  }
}

/** Yahoo/내부 코드 (005930.KS) → 6자리 */
export function toDartStockCode(code: string): string | null {
  const m = code.match(/^(\d{6})\.(KS|KQ)$/i);
  if (m) return m[1];
  if (/^\d{6}$/.test(code)) return code;
  return null;
}
