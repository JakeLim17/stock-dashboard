import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { fetchKrIntradayCandles, kisEnabled } from "@/lib/providers/kis";
import { getIntradayCandlesCached } from "@/lib/providers/kisExtraCache";
import { isKrStock } from "@/lib/providers/naver";
import { fetchIntradayBars } from "@/lib/providers/naverIntraday";
import { fetchNaverExtendedCandles } from "@/lib/providers/naverExtended";
import { fetchNaverSiseTimeBars } from "@/lib/providers/naverSiseTime";
import type { HistoricalPoint } from "@/lib/providers/yahoo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// 카드 미니 스파크라인용 통합 분봉 라우트.
//
// 한국 종목:
//   1) 정규장 1m 봉 — KIS(우선) 또는 네이버 분봉(폴백). 30~60s 메모리 캐시 재사용.
//   2) 시간외(앱장/프리장) 단일가 — fetchNaverExtendedCandles. session="extended" 마킹.
//   X축 도메인은 KST 08:00~20:00 (12시간) 고정 — 호출자가 시간외까지 일관된 폭으로 그릴 수 있게.
//
// 미국 종목:
//   Yahoo chart 1m × 1d → 정규장 분봉. 시간외는 별도 작업 (이번엔 미지원).
//   X축 도메인은 응답 첫/끝 시각으로 호출자가 자체 결정.
//
// 응답 크기를 줄이기 위해 OHLC 가 아닌 close 만 내려준다. (sparkline 만 그리므로 충분.)
//
// 캐시:
//   동일 process 안에서 메모리 캐시. 카드 6개 × 5초 폴링 시 KIS/Yahoo 호출이 폭주하지
//   않게 마지막 분봉 fetch 결과를 잠시 들고 있는다. 마지막 점은 어차피 클라이언트가
//   currentPrice 로 덮어쓰므로 stale 해도 그래프 모양엔 거의 영향이 없다.
//
//   TTL 분기 (2026-06):
//     - 정규장(~15:30 KST) 진행중: 60s — 폴링 5s 회복에 맞춰 한도 보호
//     - 15:30 이후: 300s (5분) — 마감되면 분봉이 더 늘어나지 않으므로 길게 캐시
//   sparkline 은 시각적 trend 만 보여주는 보조 시각화라 TTL 상향이 사용자 체감에 영향 거의 없다.

export interface SparklinePoint {
  time: number; // epoch ms
  price: number;
  session: "regular" | "extended";
}

interface CacheEntry {
  expiresAt: number;
  body: SparklineBody;
}

interface SparklineBody {
  points: SparklinePoint[];
  openPrice: number | null;
  domain: { startMs: number; endMs: number } | null;
  marketType: "kr" | "us" | "other";
}

const CACHE_TTL_REGULAR_MS = 60_000;
const CACHE_TTL_AFTER_CLOSE_MS = 300_000;
const cache = new Map<string, CacheEntry>();

// KST 현재 시각의 HH*60+MM 분 단위 값. UTC+9 오프셋만 적용 (서버 timezone 무관).
function getKstMinuteOfDay(nowMs: number = Date.now()): number {
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

// 정규장 마감(KST 15:30) 이후면 캐시를 길게, 그 외엔 기본 TTL.
// 미국 종목도 동일 기준 — 미국 정규장(KST 22:30~05:00)은 거의 항상 15:30 이후 시간대라
// 한국 시각 기준으로 분기해도 사용자 체감 차이 없음.
function getCacheTtlMs(nowMs: number = Date.now()): number {
  const minute = getKstMinuteOfDay(nowMs);
  return minute >= 15 * 60 + 30 ? CACHE_TTL_AFTER_CLOSE_MS : CACHE_TTL_REGULAR_MS;
}

const yahoo = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

function isUsTicker(code: string): boolean {
  if (code.includes("=") || code.startsWith("^") || code.includes(".")) return false;
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(code);
}

// 주어진 epoch 의 "KST 날짜" 기준 HH:MM 시각의 epoch ms.
// refMs 가 없으면 "지금"의 KST 날짜.
function kstHourMs(hour: number, minute = 0, refMs?: number): number {
  const base = typeof refMs === "number" ? refMs : Date.now();
  const kst = new Date(base + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  return Date.UTC(y, m, d, hour - 9, minute);
}

// 정규장 1분봉 풀데이 (~390건) 캐시. KIS FHKST03010200 시각 거꾸로 4페이지 호출 후 dedup.
//   - 153000 → 13:50~15:30 (100건)
//   - 135000 → 12:10~13:50
//   - 121000 → 10:30~12:10
//   - 103000 → 09:00~10:30 (점심 휴장 KOSPI 는 없음)
// route 자체 30s 캐시 안에 들어가므로 카드 6장 × 30s 재호출 시 1회만 발생.
const KR_FULL_PAGE_SLOTS = ["153000", "135000", "121000", "103000"];
async function fetchKrFullDay(code: string): Promise<HistoricalPoint[]> {
  if (!kisEnabled()) return [];
  const results = await Promise.allSettled(
    KR_FULL_PAGE_SLOTS.map((s) =>
      fetchKrIntradayCandles(code, s).catch(() => null)
    )
  );
  const map = new Map<number, HistoricalPoint>();
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      for (const p of r.value) {
        if (!map.has(p.date)) map.set(p.date, p);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date - b.date);
}

async function buildKrPoints(code: string): Promise<SparklineBody> {
  // 분봉 데이터 — 우선순위 (Round 4 추가):
  //   1) Naver sise_time HTML 풀데이 (정규장 6.5h ≈ 390건) ← 가장 풍부, 마감 후에도 보장
  //   2) KIS 4페이지 호출 (정규장 풀데이 백업)
  //   3) KIS 단일 호출 (getIntradayCandlesCached 30s 메모리)
  //   4) Naver minute?range=1d (장중에만 응답)
  //   네 소스를 dedup 병합. 빠른 소스(Naver sise_time)가 가장 풍부하므로 우선 채우고,
  //   동일 시각이면 KIS 가 덮어쓰며 정확도 ↑.
  const [siseTimeBars, kisFull, kisSingle, naverBars] = await Promise.all([
    fetchNaverSiseTimeBars(code).catch(() => []),
    fetchKrFullDay(code).catch(() => [] as HistoricalPoint[]),
    kisEnabled()
      ? getIntradayCandlesCached(code).catch(() => null)
      : Promise.resolve(null),
    fetchIntradayBars(code).catch(() => null),
  ]);

  const byTime = new Map<number, { time: number; close: number; open: number }>();
  // 1) Naver sise_time — 가장 풍부. 먼저 채워 다른 소스가 보강하도록.
  for (const b of siseTimeBars) {
    byTime.set(b.time, { time: b.time, close: b.close, open: b.open });
  }
  // 2) Naver minute?range=1d — 장중 OHLCV 정확. siseTime 의 close-only 를 OHLC 로 보강.
  for (const b of naverBars ?? []) {
    byTime.set(b.time, { time: b.time, close: b.close, open: b.open });
  }
  // 3) KIS 풀데이 — 가장 신선·정확. 동일 시각이면 덮어쓴다.
  for (const c of kisFull) {
    byTime.set(c.date, { time: c.date, close: c.close, open: c.open });
  }
  // 4) KIS 단일 호출 — 최신 마지막 봉 fallback.
  for (const c of kisSingle ?? []) {
    byTime.set(c.date, { time: c.date, close: c.close, open: c.open });
  }
  const regular = Array.from(byTime.values()).sort((a, b) => a.time - b.time);

  // 시간외 캔들 — 정규장이 비어 있어도 시도 (앱장 시간대일 수 있음).
  const ext = await fetchNaverExtendedCandles(code).catch(() => []);

  const points: SparklinePoint[] = [];
  for (const r of regular) {
    points.push({ time: r.time, price: r.close, session: "regular" });
  }
  for (const e of ext) {
    points.push({ time: e.date, price: e.close, session: "extended" });
  }
  points.sort((a, b) => a.time - b.time);

  const openPrice = regular.length > 0 ? regular[0].open : null;
  // X축 도메인 — "데이터 실제 첫/끝 시각" 으로 fit.
  //   이전: KST 08:00 ~ 20:00 (12시간) 고정. 카드끼리 시각 일관성은 있지만
  //   장 마감 후 데이터가 14:00~15:30 만 들어오면 가로폭의 ~12% 만 차지해
  //   "막대기처럼" 보였다. 사용자 UX 우선으로 데이터 fit 으로 변경.
  //   데이터가 너무 적을 때(점 < 2)는 fallback 으로 정규장 09:00 ~ 15:30 사용.
  const refTime =
    regular.length > 0
      ? regular[regular.length - 1].time
      : ext.length > 0
        ? ext[ext.length - 1].date
        : Date.now();
  let domain: { startMs: number; endMs: number } | null;
  if (points.length >= 2) {
    const startMs = points[0].time;
    const endMs = points[points.length - 1].time;
    // 좌우 약간(2%) 패딩 — 첫/마지막 점이 모서리에 딱 붙지 않게.
    const padMs = Math.max(60_000, Math.round((endMs - startMs) * 0.02));
    domain = { startMs: startMs - padMs, endMs: endMs + padMs };
  } else {
    domain = {
      startMs: kstHourMs(9, 0, refTime),
      endMs: kstHourMs(15, 30, refTime),
    };
  }
  return {
    points,
    openPrice,
    domain,
    marketType: "kr",
  };
}

async function buildUsPoints(code: string): Promise<SparklineBody> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    // 정규장만 — includePrePost=false. 프리/애프터를 켜면 24h 분봉 ~960점이 들어가
    // sparkline 시간축이 프리·정규·애프터를 한 줄로 압축해 모양이 어색해진다.
    // 미국 시간외는 별도 작업으로 분리.
    const raw = (await yahoo.chart(code, {
      period1: start,
      period2: end,
      interval: "1m",
      includePrePost: false,
    })) as unknown as { quotes?: Array<Record<string, unknown>> };
    const list = raw?.quotes ?? [];
    const points: SparklinePoint[] = [];
    let openPrice: number | null = null;
    for (const q of list) {
      const close = Number(q.close);
      const open = Number(q.open);
      const ds = q.date as Date | string | number | undefined;
      if (!Number.isFinite(close) || close <= 0) continue;
      const time =
        ds instanceof Date
          ? ds.getTime()
          : ds != null
            ? new Date(ds as string | number).getTime()
            : 0;
      if (!time) continue;
      points.push({ time, price: close, session: "regular" });
      if (openPrice == null && Number.isFinite(open) && open > 0) openPrice = open;
    }
    points.sort((a, b) => a.time - b.time);
    if (openPrice == null && points.length > 0) openPrice = points[0].price;
    const domain =
      points.length > 0
        ? {
            startMs: points[0].time,
            endMs: points[points.length - 1].time,
          }
        : null;
    return { points, openPrice, domain, marketType: "us" };
  } catch {
    return { points: [], openPrice: null, domain: null, marketType: "us" };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code")?.trim();
    if (!code) {
      return NextResponse.json(
        { error: "code 파라미터 필요" },
        { status: 400 }
      );
    }

    const now = Date.now();
    const hit = cache.get(code);
    if (hit && hit.expiresAt > now) {
      return NextResponse.json(hit.body, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    let body: SparklineBody;
    if (isKrStock(code)) {
      body = await buildKrPoints(code);
    } else if (isUsTicker(code)) {
      body = await buildUsPoints(code);
    } else {
      body = {
        points: [],
        openPrice: null,
        domain: null,
        marketType: "other",
      };
    }

    cache.set(code, { expiresAt: now + getCacheTtlMs(now), body });
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
