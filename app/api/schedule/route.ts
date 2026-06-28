import { NextRequest, NextResponse } from "next/server";
import { getMonthlySchedule } from "@/lib/monthly-schedule";

/** 월별 일정 — 6h CDN/브라우저 캐시 (Vercel 함수 호출 절감) */
export const revalidate = 21_600;

/** GET /api/schedule?year=2026&month=7 — 월별 주요 일정 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const now = new Date();
  const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

  if (!Number.isFinite(year) || year < 2020 || year > 2035) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "invalid month" }, { status: 400 });
  }

  const items = await getMonthlySchedule(year, month);
  return NextResponse.json(
    { year, month, items },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    }
  );
}
