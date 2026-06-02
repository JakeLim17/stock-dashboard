import "server-only";
import type { AnalystReport } from "../types";

/**
 * Wisereport(`navercomp.wisereport.co.kr`) 의 "제공처별 투자의견 및 목표주가" 표를
 * 파싱해 증권사별 AnalystReport 리스트를 만든다.
 *
 * 데이터 자체가 국내 분석가 컨센서스 (KB/미래에셋/신한투자/SK증권/하나/메리츠/...) 라
 * 기본적으로 isDomestic=true 로 라벨링한다. 만에 하나 외국 증권사명이 들어오는 경우를
 * 위해 KR_BROKERS 화이트리스트로 보강 매칭한다.
 *
 * **주의**: 정규식 기반이므로 마크업이 바뀌면 작동하지 않는다.
 *           실측 표본 (2026-06-02): id="cTB24" 표가 모든 종목에 동일한 형태로 노출됨.
 */

// 표에서 등장하는 한국 증권사 표시명. wisereport 는 약어로 짧게 적는다.
// 일반 풀네임(미래에셋증권/SK증권/...)도 포함해 둔다.
const KR_BROKER_NAMES: ReadonlyArray<string> = [
  "KB",
  "KB증권",
  "미래에셋",
  "미래에셋증권",
  "한국투자",
  "한국투자증권",
  "삼성",
  "삼성증권",
  "NH투자",
  "NH투자증권",
  "키움",
  "키움증권",
  "SK",
  "SK증권",
  "신한투자",
  "신한투자증권",
  "대신",
  "대신증권",
  "하나",
  "하나증권",
  "유진투자",
  "유진투자증권",
  "메리츠",
  "메리츠증권",
  "교보",
  "교보증권",
  "DB",
  "DB금융",
  "DB금융투자",
  "유안타",
  "유안타증권",
  "이베스트",
  "이베스트투자증권",
  "현대차",
  "현대차증권",
  "iM",
  "iM증권",
  "다올투자",
  "다올투자증권",
  "케이프",
  "케이프투자증권",
  "리딩투자",
  "리딩투자증권",
  "BNK투자",
  "BNK투자증권",
  "IBK투자",
  "IBK투자증권",
  "유화",
  "유화증권",
  "한화투자",
  "한화투자증권",
  "DS투자",
  "DS투자증권",
  "흥국",
  "흥국증권",
  "토스",
  "토스증권",
  "카카오페이",
  "카카오페이증권",
  "신영",
  "신영증권",
  "부국",
  "부국증권",
  "유진",
  "한양",
];

export const KR_BROKERS = new Set<string>(KR_BROKER_NAMES);

export function isDomesticBroker(brokerName: string): boolean {
  if (KR_BROKERS.has(brokerName)) return true;
  // 부분 매칭 (`미래에셋증권` 같은 풀네임에 대비)
  for (const name of KR_BROKERS) {
    if (brokerName.includes(name)) return true;
  }
  return false;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const WISEREPORT_BASE =
  "https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx";

// "26/06/01" → epoch ms (2026-06-01)
//   2자리 연도는 wisereport 의 "yy/MM/dd" 표기. 50 미만이면 20yy, 50 이상이면 19yy 로 가정.
function parseShortDate(s: string): number | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const yy = Number(m[1]);
  const year = yy < 50 ? 2000 + yy : 1900 + yy;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ts = Date.UTC(year, month - 1, day);
  return Number.isFinite(ts) ? ts : null;
}

function parseAmount(s: string): number | null {
  const cleaned = s.replace(/[,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 6자리 KRX 코드(005930) 또는 Yahoo 코드(005930.KS) 모두 받는다.
function toKrxCode(code: string): string | null {
  if (/^\d{6}$/.test(code)) return code;
  const m = code.match(/^(\d{6})\.K[SQ]$/);
  return m ? m[1] : null;
}

/**
 * 증권사별 투자의견·목표주가 리스트 + 국내 평균 통계.
 *
 *   reports        : 발행일 최신순으로 정렬된 전체 리포트 (보통 18~25개)
 *   domestic*      : 국내 증권사만 추린 평균/최고/최저/카운트
 *
 * 같은 증권사가 여러 번 등장할 수 있어 "국내 평균"은 증권사별 최신 1건만 사용해 산정한다.
 * 이래야 wisereport 의 priceTargetMean 로직에 가까워진다.
 *
 * 실패 시 null.
 */
export async function fetchWisereportAnalystReports(code: string): Promise<{
  reports: AnalystReport[];
  domesticMean: number | null;
  domesticHigh: number | null;
  domesticLow: number | null;
  domesticCount: number;
} | null> {
  const krxCode = toKrxCode(code);
  if (!krxCode) return null;

  try {
    const res = await fetch(`${WISEREPORT_BASE}?cmp_cd=${krxCode}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://finance.naver.com/",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html) return null;

    // cTB24 표 본문만 추출 — 다른 표(실적 컨센서스 등)에 같은 패턴이 있어 범위 한정 필요.
    const tableMatch = html.match(
      /<table[^>]*id="cTB24"[\s\S]*?<\/table>/i
    );
    const scope = tableMatch ? tableMatch[0] : html;

    // 각 행: <tr> ... <td class="line txt" scope="row">증권사</td> <td class="line center">26/06/01</td>
    //         <td class="line num">2,200,000</td> <td class="line num">1,300,000</td>
    //         <td class="line num"><span ...>변동률</span></td>
    //         <td class="line center" title="BUY">BUY</td>
    //         <td class="noline-right ... " title="BUY">BUY</td>
    const rowRe =
      /<tr[^>]*>\s*<td[^>]*class="line txt"[^>]*scope="row"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="line center"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="line num"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="line num"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="line num"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="line center"[^>]*?(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="noline-right[^"]*"[^>]*?(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/td>/g;

    const stripTags = (s: string) =>
      s
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim();

    const reports: AnalystReport[] = [];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(scope)) !== null) {
      const broker = stripTags(m[1]);
      if (!broker) continue;
      const dateStr = stripTags(m[2]);
      const targetStr = stripTags(m[3]);
      const prevTargetStr = stripTags(m[4]);
      const opinionTitle = m[6];
      const opinionBody = stripTags(m[7]);
      const prevOpinionTitle = m[8];
      const prevOpinionBody = stripTags(m[9]);

      const targetPrice = parseAmount(targetStr);
      if (targetPrice == null) continue;
      const previousTarget = parseAmount(prevTargetStr);
      const publishDate = parseShortDate(dateStr) ?? undefined;
      const opinion = opinionTitle || opinionBody || undefined;
      const previousOpinion =
        prevOpinionTitle || prevOpinionBody || null;

      reports.push({
        brokerName: broker,
        targetPrice,
        opinion,
        publishDate,
        previousTarget: previousTarget ?? null,
        previousOpinion,
        isDomestic: isDomesticBroker(broker),
      });
    }

    // 발행일 최신순 → 같은 일자면 표에 등장한 순서 유지
    reports.sort((a, b) => {
      const ad = a.publishDate ?? 0;
      const bd = b.publishDate ?? 0;
      return bd - ad;
    });

    // 국내 평균: 증권사별 최신 1건만 사용 (중복 발행 종목 보정)
    const latestPerBroker = new Map<string, AnalystReport>();
    for (const r of reports) {
      if (!r.isDomestic) continue;
      const existing = latestPerBroker.get(r.brokerName);
      if (
        !existing ||
        (r.publishDate ?? 0) > (existing.publishDate ?? 0)
      ) {
        latestPerBroker.set(r.brokerName, r);
      }
    }
    const domesticTargets = Array.from(latestPerBroker.values()).map(
      (r) => r.targetPrice
    );

    const domesticCount = domesticTargets.length;
    const domesticMean =
      domesticCount > 0
        ? domesticTargets.reduce((a, b) => a + b, 0) / domesticCount
        : null;
    const domesticHigh =
      domesticCount > 0 ? Math.max(...domesticTargets) : null;
    const domesticLow =
      domesticCount > 0 ? Math.min(...domesticTargets) : null;

    return {
      reports,
      domesticMean,
      domesticHigh,
      domesticLow,
      domesticCount,
    };
  } catch {
    return null;
  }
}
