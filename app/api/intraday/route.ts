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
// 임시 복원 — KIS WS relay 호스팅 전까지 REST 호가/체결 폴링 부활.
// 클라이언트(AskingPricePanel) 폴링 주기는 3초 이상으로 늘렸고,
// 여기서도 동일 종목 burst 호출을 막기 위해 짧은 TTL 의 서버 사이드
// 캐시를 둔다 — 한도/카톡 알림 폭주 방지.
//
// 응답 schema (이전 호출자 기대 형식 유지):
//   {
//     asking:    AskingPriceData | null,
//     executions: ExecutionTick[] | null,
//     disabled?:  boolean,   // 라우트 자체가 비활성 응답인 경우
//     reason?:    string,    // 디버그용 — null 응답 사유
//   }
// ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 2_500;
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
    const topicsKey = topicsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort()
      .join(",");
    const cacheKey = topicsKey ? `${code}|${topicsKey}` : code;

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

    // 호가 + 체결 병렬. 각각 graceful null (kisGet 내부에 retry/backoff 있음).
    const [asking, executions] = await Promise.all([
      fetchKrAskingPrice(code).catch(() => null),
      fetchKrExecutions(code, 30).catch(() => null),
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
