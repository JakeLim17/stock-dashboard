import "server-only";
import crypto from "node:crypto";
import type { NewsItem } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// 네이버 금융 종목 뉴스 스크래퍼
//
// 한국 종목(005930.KS 등) → finance.naver.com 의 종목 뉴스 iframe(`news_news.naver`)
// 을 직접 fetch 해 HTML 테이블에서 제목·언론사·시각·링크를 추출한다.
// 페이지 인코딩이 EUC-KR 이라 Buffer→TextDecoder('euc-kr') 로 디코드한다.
// (Node 빌트인 ICU 가 euc-kr 을 지원해서 별도 iconv-lite 가 필요 없다.)
//
// Google News RSS 가 24h 내 매칭이 1~2건만 잡히는 문제를 해결하기 위한 1순위 소스.
// 한 종목당 최대 20건 fetch (page=1 한 페이지 분량).
// ─────────────────────────────────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 6자리 한국 종목 코드 추출. "005930.KS" / "005930.KQ" / "005930" 모두 OK.
// 그 외(미국 티커, 지수)는 null.
export function extractKrCode(code: string): string | null {
  const m = code.match(/^(\d{6})(?:\.K[SQ])?$/);
  return m?.[1] ?? null;
}

interface NaverNewsRow {
  title: string;
  link: string;
  source: string;
  publishedAt: number; // epoch ms
}

// HTML 엔터티 디코드 — 네이버 뉴스 제목에 자주 등장하는 것만.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&rarr;/g, "→")
    .replace(/&larr;/g, "←")
    .replace(/&hellip;/g, "…")
    .replace(/&middot;/g, "·")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// "2026.06.11 01:00" (KST) → epoch ms.
// 네이버는 KST 기준 시각을 줘서 timezone 보정이 필요하다.
function parseKstDate(raw: string): number | null {
  const m = raw.trim().match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, yy, MM, dd, HH, mm] = m;
  // KST = UTC+9. Date.UTC() 후 9시간 빼서 epoch 산출.
  const utcMs = Date.UTC(
    Number(yy),
    Number(MM) - 1,
    Number(dd),
    Number(HH),
    Number(mm),
    0
  );
  return utcMs - 9 * 60 * 60 * 1000;
}

// HTML 태그 제거 + 공백 정리.
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// 한 페이지 HTML에서 뉴스 행 추출.
// 테이블 행마다 `<a href="..." class="tit">제목</a>`, `<td class="info">언론사</td>`,
// `<td class="date">YYYY.MM.DD HH:MM</td>` 이 들어 있다.
// href·class 의 순서가 anchor 마다 달라서, 두 단계로 분리해 추출한다.
function parseRows(html: string): NaverNewsRow[] {
  const rows: NaverNewsRow[] = [];
  // 행(`<tr ...>...</tr>`) 단위로 자른다. relation_lst 의 내부 table 도 함께 잡혀
  // 한 번에 더 많은 기사를 추출.
  const trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const tr of trMatches) {
    // 1) class에 "tit"이 포함된 anchor 전체를 잡는다 (href/class 순서 무관).
    const anchorMatch = tr.match(
      /<a\b[^>]*\bclass=["'][^"']*\btit\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!anchorMatch) continue;
    const anchorOuter = anchorMatch[0];
    const hrefMatch = anchorOuter.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];
    const title = decodeEntities(stripTags(anchorMatch[1]));
    if (!title) continue;

    const infoMatch = tr.match(/<td[^>]*class=["'][^"']*\binfo\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const dateMatch = tr.match(/<td[^>]*class=["'][^"']*\bdate\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const source = infoMatch ? decodeEntities(stripTags(infoMatch[1])) : "네이버 금융";
    const dateRaw = dateMatch ? stripTags(dateMatch[1]) : "";
    const publishedAt = parseKstDate(dateRaw) ?? Date.now();

    // 상대 경로 → 절대 경로. 네이버는 모바일 패스도 동일 도메인.
    const link = href.startsWith("http")
      ? href
      : `https://finance.naver.com${href.startsWith("/") ? "" : "/"}${href}`;

    rows.push({ title, link, source, publishedAt });
  }
  return rows;
}

// 네이버 금융 종목 뉴스 fetch — 최대 maxItems 건.
// 실패 시 빈 배열 반환 (호출자가 다음 소스로 폴백).
export async function fetchNaverFinanceNews(
  code: string,
  opts: { symbol?: string; maxItems?: number } = {}
): Promise<NewsItem[]> {
  const krCode = extractKrCode(code);
  if (!krCode) return [];

  const maxItems = opts.maxItems ?? 20;
  const url = `https://finance.naver.com/item/news_news.naver?code=${krCode}&page=1&clusterId=`;

  let html: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: `https://finance.naver.com/item/news.naver?code=${krCode}`,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const buf = Buffer.from(await res.arrayBuffer());
    // 우선 EUC-KR 로 디코드. 응답 헤더에 명시되어 있고 검증 완료.
    // 만약 UTF-8로 바뀐다 해도 ASCII·한글 깨짐 정도만 발생하는데, 동일 데이터에 대해
    // mojibake 가 보이면 fall through 가 자연스럽다.
    html = new TextDecoder("euc-kr").decode(buf);
  } catch {
    return [];
  }

  const rows = parseRows(html);
  if (rows.length === 0) return [];

  // 중복 제거 (link 기준) + 시간 역순 + 상위 maxItems.
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const r of rows.sort((a, b) => b.publishedAt - a.publishedAt)) {
    if (seen.has(r.link)) continue;
    seen.add(r.link);
    const id = crypto.createHash("md5").update(r.link || r.title).digest("hex");
    items.push({
      id,
      title: r.title,
      link: r.link,
      source: r.source,
      publishedAt: r.publishedAt,
      symbol: opts.symbol ?? null,
    });
    if (items.length >= maxItems) break;
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// 네이버 뉴스 검색 (search.naver.com) — 키워드(한국명) 기반.
// 미국 종목의 한국명 매칭(예: "테슬라", "엔비디아") 용 보조 소스.
//
// 검색 결과 페이지는 SPA 컴포넌트 기반이라 정적 HTML 파싱이 깨지기 쉽다.
// 따라서 "할 수 있는 만큼만" 추출 — 실패해도 빈 배열로 폴백, 안정성 우선.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchNaverNewsSearch(
  keyword: string,
  opts: { symbol?: string; maxItems?: number } = {}
): Promise<NewsItem[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const maxItems = opts.maxItems ?? 10;
  const url = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(kw)}&sm=tab_pge`;

  let html: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    // 응답 헤더는 UTF-8.
    html = await res.text();
  } catch {
    return [];
  }

  // 네이버 뉴스 검색 결과는 `<a ... href="https://n.news.naver.com/...">제목</a>` 형태로
  // 본문 anchor 가 들어간다. 같은 매체 상세 페이지 anchor 가 중복 잡힐 수 있어 dedup.
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href=["'](https:\/\/n\.news\.naver\.com\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const link = m[1];
    if (seen.has(link)) continue;
    const raw = stripTags(m[2]);
    const title = decodeEntities(raw);
    if (!title || title.length < 6) continue; // "원문보기" 같은 짧은 라벨 거름
    if (title === "기사 원문" || title === "원문보기") continue;
    seen.add(link);
    const id = crypto.createHash("md5").update(link).digest("hex");
    items.push({
      id,
      title,
      link,
      source: "네이버 뉴스",
      publishedAt: Date.now(),
      symbol: opts.symbol ?? null,
    });
    if (items.length >= maxItems) break;
  }
  return items;
}
