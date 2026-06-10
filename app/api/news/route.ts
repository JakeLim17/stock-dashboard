import { NextResponse } from "next/server";
import { recentNews } from "@/lib/db";
import {
  fetchAllNews,
  fetchNewsForSymbols,
  reclassifyWithTitleKo,
} from "@/lib/providers";
import { saveNews } from "@/lib/db";
import { translateTitleToKo } from "@/lib/news/translation";
import type { NewsItem } from "@/lib/types";

export const dynamic = "force-dynamic";

// Round 4: 영문 헤드라인 → 한국어 번역(시간 예산 budgetMs). 직렬·throttle.
// translateTitleToKo 가 24h 캐시·1.1s 쓰로틀을 갖고 있어 캐시 히트면 즉시.
async function enrichTitleKoWithBudget(
  items: NewsItem[],
  budgetMs: number
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (const it of items) {
    if (Date.now() >= deadline) break;
    if (it.titleKo) continue;
    if (!it.title) continue;
    if (/[\uAC00-\uD7A3]/.test(it.title)) continue;
    try {
      const ko = await translateTitleToKo(it.title);
      if (ko && ko !== it.title) it.titleKo = ko;
    } catch {
      /* 개별 실패는 무시 */
    }
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const symbolsParam = url.searchParams.get("symbols");

  try {
    // 종목별 다중 소스 fetch — `?symbols=005930.KS,MU,TSLA` 와 같이 호출.
    // StockDetailPanel 의 NewsTab 등 종목 한정 뷰가 사용.
    if (symbolsParam) {
      const symbols = symbolsParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (symbols.length === 0) return NextResponse.json({ items: [], by: {} });
      const by = await fetchNewsForSymbols(symbols, { maxItems: 20 });
      const items = Object.values(by).flat();
      // 다중 소스 결과도 DB 에 캐싱 — 다음 대시보드 로딩 시 즉시 사용 가능.
      try {
        saveNews(items);
      } catch {
        // DB write 실패는 응답을 막지 않음.
      }
      return NextResponse.json({ items, by });
    }

    if (refresh) {
      const items = await fetchAllNews(60);
      // Round 4: 영문 헤드라인 → 한국어 번역(상위 30, 5s 예산) → sentiment 재분류.
      //   fetchAllNews 자체는 번역 안 함 → 분류기가 영문만 보고 neutral 폭발하던 문제 해결.
      await enrichTitleKoWithBudget(items.slice(0, 30), 5000);
      reclassifyWithTitleKo(items);
      saveNews(items);
      return NextResponse.json({ items });
    }
    return NextResponse.json({ items: recentNews(60) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
