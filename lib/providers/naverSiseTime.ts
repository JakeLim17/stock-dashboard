import "server-only";
import { isKrStock } from "./naver";

// 네이버 finance.naver.com sise_time 어댑터 — 정규장 6.5시간 풀 1분봉 확보용.
//
// endpoint: https://finance.naver.com/item/sise_time.naver?code=<6digit>&thistime=YYYYMMDDhhmmss&page=N
//
// 응답: EUC-KR 인코딩 HTML. 페이지당 ~10행, 시각 거꾸로(15:30 → 09:01).
//   <tr onMouseOver="mouseOver(this)" ...>
//     <td align="center"><span class="tah p10 gray03">15:30</span></td>  ← 시각
//     <td class="num"><span class="tah p11">302,500</span></td>          ← 체결가 (close)
//     <td class="num">...</td>                                            ← 전일대비
//     <td class="num"><span class="tah p11">302,500</span></td>           ← 매도호가
//     <td class="num"><span class="tah p11">302,000</span></td>           ← 매수호가
//     <td class="num"><span class="tah p11">26,153,675</span></td>        ← 누적거래량
//     <td class="num"><span class="tah p11">1,911,281</span></td>         ← 거래량(분)
//   </tr>
//
// OHLC 중 close 만 정확. sparkline 용도엔 충분 (high/low/open 은 close 로 통일).
//
// 정책
//   - 한국 종목(.KS / .KQ)에만 호출. 미국·지수·환율은 즉시 빈 배열.
//   - 캐시 TTL 60s (장중 1분 단위 새 봉. 마감 후엔 같은 데이터를 그대로 캐시 hit).
//   - 페이지 사이 50ms gap (Naver 부하 보호).
//   - 최대 60페이지 (≈600행, 정규장 390분 + 안전 여유).
//   - 모든 에러는 흡수 — 어댑터 안에서 try/catch 후 부분 결과 반환.

// 데스크톱 UA — 모바일 UA 시 finance.naver.com 가 빈 셀(&nbsp;)만 든 stub 페이지를 돌려준다.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TTL_MS = 60_000;
const PAGE_LIMIT = 60;
const PAGE_GAP_MS = 50;

export interface SiseTimeBar {
  time: number; // epoch ms (KST 기준 분봉의 시각)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CacheEntry {
  expiresAt: number;
  bars: SiseTimeBar[];
}
const cache = new Map<string, CacheEntry>();

function toNaverCode(code: string): string | null {
  const m = code.match(/^(\d{6})\.K[SQ]$/);
  return m ? m[1] : null;
}

// 한국 거래일 결정 — 가장 최근 평일·정규장 종료 시점.
//   토요일(6) → 금요일, 일요일(0) → 금요일, 평일은 그대로.
//   ★ 평일 09:00 KST 이전이면 직전 거래일로 후퇴
//     ← Naver sise_time 은 thistime 이 "오늘 미래" 면 모든 셀 &nbsp; 인 빈 페이지를 돌려준다.
//   공휴일은 모르므로 그대로 진행 (빈 응답이면 호출자가 폴백).
function recentTradingDayKst(now = Date.now()): {
  yyyymmdd: string;
  yyyy: number;
  mm: number;
  dd: number;
} {
  // KST = UTC+9. UTC ms 에 9h 더해 "KST 시점의 캘린더" 로 환산.
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0(일) ~ 6(토) — KST 기준
  const hour = kst.getUTCHours(); // KST 시
  let backDays = 0;
  if (day === 6) backDays = 1; // 토 → 금
  else if (day === 0) backDays = 2; // 일 → 금
  else if (hour < 9) backDays = 1; // 평일 09:00 이전 → 직전 영업일 (단순화: 어제)

  if (backDays > 0) {
    kst.setUTCDate(kst.getUTCDate() - backDays);
    // 후퇴 후 다시 토·일이면 한 번 더 후퇴 (월요일 새벽 → 직전 금요일)
    const day2 = kst.getUTCDay();
    if (day2 === 6) kst.setUTCDate(kst.getUTCDate() - 1);
    else if (day2 === 0) kst.setUTCDate(kst.getUTCDate() - 2);
  }
  const yyyy = kst.getUTCFullYear();
  const mm = kst.getUTCMonth() + 1;
  const dd = kst.getUTCDate();
  const yyyymmdd = `${yyyy}${String(mm).padStart(2, "0")}${String(dd).padStart(
    2,
    "0"
  )}`;
  return { yyyymmdd, yyyy, mm, dd };
}

// "HH:MM" + 거래일(yyyy/mm/dd KST) → epoch ms.
//   KST H:M 을 UTC 로 변환 → Date.UTC(y, m-1, d, h-9, m).
function hmToEpoch(
  hm: string,
  y: number,
  mo: number,
  d: number
): number | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return Date.UTC(y, mo - 1, d, h - 9, mi);
}

// 페이지 HTML 1장 → 행 배열 추출. 시각·체결가만 사용 (open/high/low 는 close 로 통일).
//   tr onMouseOver 가 마커. 첫 td 의 시각 + 두 번째 td 의 체결가.
//   정규식 한 번에 매칭 — 이후 td 셀(전일대비/호가/거래량) 은 매칭 안 함 (close 만 필요).
function parseSiseTimePage(
  html: string,
  y: number,
  mo: number,
  d: number
): SiseTimeBar[] {
  const out: SiseTimeBar[] = [];
  // tr 행 단위로 잘라 시각 + 체결가만 추출.
  // - 시각: <td align="center"><span class="tah p10 gray03">HH:MM</span></td>
  // - 체결가: 같은 tr 안 두 번째 num td 의 <span class="tah p11">숫자,콤마</span>
  // 거래량: 마지막 num td 의 숫자(콤마 포함). 추출 안 해도 sparkline 작동.
  const rowRe =
    /<tr\s+onMouseOver[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html)) !== null) {
    const row = match[1];
    const timeMatch = row.match(
      /<td[^>]*align="center"[^>]*>\s*<span[^>]*>\s*(\d{1,2}:\d{2})\s*<\/span>/i
    );
    if (!timeMatch) continue;
    // 첫 번째 num td (체결가).
    const priceMatch = row.match(
      /<td[^>]*class="num"[^>]*>\s*<span[^>]*>\s*([\d,]+)\s*<\/span>/i
    );
    if (!priceMatch) continue;

    const epoch = hmToEpoch(timeMatch[1], y, mo, d);
    const close = Number(priceMatch[1].replace(/,/g, ""));
    if (!epoch || !Number.isFinite(close) || close <= 0) continue;

    out.push({
      time: epoch,
      open: close,
      high: close,
      low: close,
      close,
      volume: 0,
    });
  }
  return out;
}

// 메인 — 페이지 1..N 순회 + dedup.
// 빈 페이지 또는 09:00 이전 시각 도달 시 조기 중단.
export async function fetchNaverSiseTimeBars(
  code: string
): Promise<SiseTimeBar[]> {
  if (!isKrStock(code)) return [];
  const naverCode = toNaverCode(code);
  if (!naverCode) return [];

  const now = Date.now();
  const cached = cache.get(code);
  if (cached && cached.expiresAt > now) return cached.bars;

  const { yyyymmdd, yyyy, mm, dd } = recentTradingDayKst(now);
  // thistime 은 마감 시각(15:30:00). 장 마감 후엔 그대로 풀 데이를 받고,
  // 장중에도 미래 시각을 넣어도 가까운 과거(현재 진행분 포함)를 돌려준다.
  const thistime = `${yyyymmdd}153000`;

  const map = new Map<number, SiseTimeBar>();
  let stopped = false;

  for (let page = 1; page <= PAGE_LIMIT; page++) {
    if (stopped) break;
    try {
      const url = `https://finance.naver.com/item/sise_time.naver?code=${naverCode}&thistime=${thistime}&page=${page}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: `https://finance.naver.com/item/sise_time.naver?code=${naverCode}`,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
        cache: "no-store",
      });
      if (!res.ok) break;
      const buf = Buffer.from(await res.arrayBuffer());
      const html = new TextDecoder("euc-kr").decode(buf);
      if (!html) break;

      const rows = parseSiseTimePage(html, yyyy, mm, dd);
      if (rows.length === 0) {
        // 빈 페이지 — 더 이상 데이터 없음.
        break;
      }

      let allDuplicates = true;
      for (const r of rows) {
        if (!map.has(r.time)) {
          map.set(r.time, r);
          allDuplicates = false;
        }
      }
      // 모든 행이 중복이면 더 진행해도 의미 없음 (페이지 경계 안정 보호).
      if (allDuplicates) break;

      // 가장 빠른 시각이 09:00 이하면 정규장 시작 도달.
      let earliest = Number.POSITIVE_INFINITY;
      for (const r of rows) if (r.time < earliest) earliest = r.time;
      const earliestKst = new Date(earliest + 9 * 60 * 60 * 1000);
      const earliestH = earliestKst.getUTCHours();
      const earliestM = earliestKst.getUTCMinutes();
      if (earliestH < 9 || (earliestH === 9 && earliestM === 0)) {
        stopped = true;
      }
    } catch {
      // 단일 페이지 실패는 흡수 — 부분 결과 그대로 반환.
      break;
    }
    if (page < PAGE_LIMIT && !stopped) {
      await sleep(PAGE_GAP_MS);
    }
  }

  const bars = Array.from(map.values()).sort((a, b) => a.time - b.time);
  cache.set(code, { expiresAt: now + TTL_MS, bars });
  return bars;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
