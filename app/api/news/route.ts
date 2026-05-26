import { NextResponse } from "next/server";
import { recentNews } from "@/lib/db";
import { fetchAllNews } from "@/lib/providers";
import { saveNews } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    if (refresh) {
      const items = await fetchAllNews(30);
      saveNews(items);
      return NextResponse.json({ items });
    }
    return NextResponse.json({ items: recentNews(30) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
