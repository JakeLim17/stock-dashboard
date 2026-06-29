import { NextResponse } from "next/server";
import {
  fetchKrAskingPrice,
  fetchKrExecutions,
  kisEnabled,
} from "@/lib/providers/kis";
import { isKrStock } from "@/lib/providers/naver";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ────────────────────────────────────────────────────────────────────
// KIS REST 호가/체결 — topics 파라미터로 필요한 데이터만 fetch.
// 호가 UI 제거 후 기본 호출은 KIS 미접속 (topics 미지정 시 skip).
//
// topics (쉼표 구분, 복수 가능):
//   asking | asp        → fetchKrAskingPrice
//   executions | ccld   → fetchKrExecutions
//
// 응답 schema:
//   {
//     asking:    AskingPriceData | null,
//     executions: ExecutionTick[] | null,
//     disabled?:  boolean,
//     reason?:    string,
//   }
// ────────────────────────────────────────────────────────────────────

// 2026-06 응급 절감: 2.5s → 6s. 클라이언트 polling 기본도 8s 로 늘려 같은 종목 burst 호출 거의 0.
const CACHE_TTL_MS = 6_000;
const CACHE_MAX_SIZE = 256;

type IntradayPayload = {
  asking: Awaited<ReturnType<typeof fetchKrAskingPrice>>;
  executions: Awaited<ReturnType<typeof fetchKrExecutions>>;
  reason?: string;
};

type CacheEntry = { ts: number; payload: IntradayPayload };

// 모듈 스코프 — 동일 lambda(or process) 안에서만 공유. 분산 환경에서도
// "한 인스턴스당 짧게 캐시" 라 호출량 절감 효과는 충분히 있음.
const cache = new Map<string, CacheEntry>();

function getCache(code: string): IntradayPayload | null {
  const hit = cache.get(code);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(code);
    return null;
  }
  return hit.payload;
}

function setCache(code: string, payload: IntradayPayload): void {
  if (cache.size >= CACHE_MAX_SIZE) {
    // 가장 오래된(=먼저 들어온) key 1개 제거 — Map 은 insertion-order.
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(code, { ts: Date.now(), payload });
}

function parseTopics(raw: string): { wantAsking: boolean; wantExecutions: boolean } {
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) {
    return { wantAsking: false, wantExecutions: false };
  }
  return {
    wantAsking: parts.some((p) => p === "asking" || p === "asp"),
    wantExecutions: parts.some((p) => p === "executions" || p === "ccld"),
  };
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
    // 캐시 key — code 만 쓰면 미래에 topics(호가/체결/지수 등) 가 추가될 때 응답 mix 위험.
    // 현재는 topics 파라미터를 받지 않지만 미래 보험으로 키에 포함.
    const topicsRaw = url.searchParams.get("topics") ?? "";
    const { wantAsking, wantExecutions } = parseTopics(topicsRaw);
    const topicsKey = topicsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort()
      .join(",");
    const cacheKey = topicsKey ? `${code}|${topicsKey}` : code;

    // topics 미지정 — KIS 호출 없이 빈 응답 (호가 UI 제거 후 기본).
    if (!wantAsking && !wantExecutions) {
      return NextResponse.json(
        { asking: null, executions: null, reason: "no-topics" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // KIS 미활성 → 빈 응답 (한 번 disabled 응답 후 클라가 reset).
    if (!kisEnabled()) {
      return NextResponse.json(
        {
          asking: null,
          executions: null,
          disabled: true,
          reason: "kis-disabled",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 한국 종목이 아니면 KIS REST 호가/체결 미지원.
    if (!isKrStock(code)) {
      return NextResponse.json(
        { asking: null, executions: null, reason: "non-kr" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 캐시 hit — 짧은 TTL 안에 같은 종목 다시 들어오면 KIS 호출 skip.
    const cached = getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "no-store", "X-Intraday-Cache": "hit" },
      });
    }

    // 요청된 topics 만 병렬 fetch. 각각 graceful null.
    const [asking, executions] = await Promise.all([
      wantAsking ? fetchKrAskingPrice(code).catch(() => null) : Promise.resolve(null),
      wantExecutions
        ? fetchKrExecutions(code, 30).catch(() => null)
        : Promise.resolve(null),
    ]);

    const payload: IntradayPayload = {
      asking,
      executions,
      ...(asking == null && executions == null
        ? { reason: "kis-restored, asking unavailable" }
        : {}),
    };
    setCache(cacheKey, payload);

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store", "X-Intraday-Cache": "miss" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
