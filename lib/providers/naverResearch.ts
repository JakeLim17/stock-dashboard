import "server-only";
import type { NaverResearchReport } from "../types";

/**
 * 네이버 금융 리서치(`finance.naver.com/research`) 의 종목별 리포트 목록을 파싱한다.
 *
 * 엔드포인트: `finance.naver.com/research/company_list.naver?searchType=itemCode&itemCode={6자리}`
 *
 * 응답은 EUC-KR 인코딩 HTML (다른 finance.naver.com 페이지와 동일). Node 18+ 의
 * `TextDecoder('euc-kr')` 으로 디코딩 후 정규식으로 표 행을 추출한다.
 *
 * 각 행은 6개 td로 구성:
 *   1) 종목명 (a 태그)
 *   2) 제목 (a href="company_read.naver?nid=...")
 *   3) 증권사명 (텍스트)
 *   4) PDF 첨부 (a href="https://stock.pstatic.net/...pdf", 없을 수도 있음)
 *   5) 작성일 (yy.MM.dd, td class="date")
 *   6) 조회수
 *
 * 실패/타임아웃 시 빈 배열 반환 (snapshot 빌드 전체를 막지 않음).
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const RESEARCH_BASE = "https://finance.naver.com/research/company_list.naver";

// 6자리 KRX 코드(005930) 또는 Yahoo 코드(005930.KS) → 6자리만 추출.
function toKrxCode(code: string): string | null {
  if (/^\d{6}$/.test(code)) return code;
  const m = code.match(/^(\d{6})\.K[SQ]$/);
  return m ? m[1] : null;
}

// "26.06.01" → epoch ms. 2자리 연도는 50 미만이면 20yy, 50 이상이면 19yy.
function parseShortDate(s: string): number | null {
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const yy = Number(m[1]);
  const year = yy < 50 ? 2000 + yy : 1900 + yy;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ts = Date.UTC(year, month - 1, day);
  return Number.isFinite(ts) ? ts : null;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 최근 N건의 네이버 리서치 리포트를 반환한다.
 *
 * @param code   "005930.KS" 또는 "005930"
 * @param limit  최대 반환 건수 (기본 15)
 */
export async function fetchNaverResearchReports(
  code: string,
  limit = 15
): Promise<NaverResearchReport[]> {
  const krxCode = toKrxCode(code);
  if (!krxCode) return [];

  try {
    const url = `${RESEARCH_BASE}?searchType=itemCode&itemCode=${krxCode}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://finance.naver.com/",
        Accept: "text/html,application/xhtml+xml",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];

    // finance.naver.com 은 EUC-KR. res.text() 는 UTF-8 가정이라 mojibake가 발생.
    const buf = Buffer.from(await res.arrayBuffer());
    const html = new TextDecoder("euc-kr").decode(buf);
    if (!html) return [];

    // "type_1" 표만 떼서 범위를 좁힌다 — 다른 표(인기 종목 등)에 같은 패턴 끼는 것 방지.
    const tableMatch = html.match(
      /<table[^>]*class="[^"]*type_1[^"]*"[\s\S]*?<\/table>/i
    );
    const scope = tableMatch ? tableMatch[0] : html;

    // 종목명 → 제목(+상세 URL) → 증권사 → PDF(있을 수도 없을 수도) → 작성일.
    // PDF 셀은 <td class="file"> 로, a 태그가 없으면 공백. 정규식은 a href 캡쳐 그룹을 옵셔널.
    const rowRe =
      /<tr>\s*<td[^>]*>\s*<a[^>]*class="stock_item"[^>]*>[\s\S]*?<\/a>\s*<\/td>\s*<td[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="file"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="date"[^>]*>([\s\S]*?)<\/td>/gi;

    const out: NaverResearchReport[] = [];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(scope)) !== null) {
      const relUrl = m[1];
      const title = stripTags(m[2]);
      const brokerName = stripTags(m[3]);
      const fileCell = m[4];
      const dateStr = stripTags(m[5]);

      if (!title || !brokerName) continue;
      const publishDate = parseShortDate(dateStr);
      if (publishDate == null) continue;

      // PDF a href 추출 — 없으면 undefined
      const pdfMatch = fileCell.match(/<a[^>]*href="([^"]+\.pdf)"/i);
      const pdfUrl = pdfMatch ? pdfMatch[1] : undefined;

      // reportUrl 은 상대 경로 ("company_read.naver?nid=...") 라 절대 경로로 변환
      const reportUrl = relUrl.startsWith("http")
        ? relUrl
        : `https://finance.naver.com/research/${relUrl}`;

      out.push({
        title,
        brokerName,
        publishDate,
        reportUrl,
        pdfUrl,
      });
      if (out.length >= limit) break;
    }

    return out;
  } catch {
    return [];
  }
}
