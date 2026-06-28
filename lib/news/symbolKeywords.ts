// 뉴스 제목에서 종목을 매칭할 때 쓰는 키워드 사전.
// server-only 인 `lib/providers/news.ts` 와 클라이언트인 `components/StockDetailPanel.tsx`
// (뉴스 탭) 둘 다 이 파일을 참조한다. 따라서 server import 를 두지 말 것.

export interface SymbolKeyword {
  kw: string;
  code: string;
}

// 키 = 종목 코드 (Yahoo 표기), 값 = 매칭에 쓰는 한·영 키워드 배열.
// 뉴스 탭에서 "마이크론 관련 뉴스" 클릭 시 한국어 회사명만으로는 영어 헤드라인을
// 못 잡으므로 영어 별칭(예: "Micron", "MU HBM")까지 함께 검사한다.
export const NEWS_SYMBOL_KEYWORDS: SymbolKeyword[] = [
  // ── 한국 종목 ─────────────────────────────────────────────
  { kw: "삼성전자", code: "005930.KS" },
  { kw: "Samsung Electronics", code: "005930.KS" },
  { kw: "SK하이닉스", code: "000660.KS" },
  { kw: "SK Hynix", code: "000660.KS" },
  { kw: "hynix", code: "000660.KS" },
  { kw: "SK스퀘어", code: "402340.KS" },
  { kw: "SK Square", code: "402340.KS" },
  { kw: "SK지주", code: "034730.KS" },
  { kw: "SK Holdings", code: "034730.KS" },
  { kw: "에스케이", code: "034730.KS" },
  { kw: "삼성전기", code: "009150.KS" },
  { kw: "Samsung Electro", code: "009150.KS" },
  { kw: "LG전자", code: "066570.KS" },
  { kw: "LG Electronics", code: "066570.KS" },
  { kw: "현대차", code: "005380.KS" },
  { kw: "Hyundai Motor", code: "005380.KS" },
  { kw: "기아", code: "000270.KS" },
  { kw: "Kia Motors", code: "000270.KS" },
  { kw: "LG에너지솔루션", code: "373220.KS" },
  { kw: "LG Energy Solution", code: "373220.KS" },
  { kw: "네이버", code: "035420.KS" },
  { kw: "NAVER", code: "035420.KS" },
  { kw: "카카오", code: "035720.KS" },
  { kw: "Kakao", code: "035720.KS" },
  { kw: "한화에어로스페이스", code: "012450.KS" },
  { kw: "Hanwha Aerospace", code: "012450.KS" },
  { kw: "한국항공우주", code: "047810.KS" },
  { kw: "Korea Aerospace", code: "047810.KS" },
  { kw: "KAI", code: "047810.KS" },
  { kw: "두산에너빌리티", code: "034020.KS" },
  { kw: "Doosan Enerbility", code: "034020.KS" },
  { kw: "대한항공", code: "003490.KS" },
  { kw: "Korean Air", code: "003490.KS" },
  { kw: "삼성바이오로직스", code: "207940.KS" },
  { kw: "Samsung Biologics", code: "207940.KS" },
  { kw: "두산로보틱스", code: "454910.KS" },
  { kw: "Doosan Robotics", code: "454910.KS" },
  { kw: "씨에스윈드", code: "112610.KS" },
  { kw: "CS Wind", code: "112610.KS" },
  { kw: "휴젤", code: "145020.KQ" },
  { kw: "Hugel", code: "145020.KQ" },
  { kw: "LG생활건강", code: "051900.KS" },
  { kw: "LG H&H", code: "051900.KS" },
  { kw: "삼양식품", code: "003230.KS" },
  { kw: "Samyang Foods", code: "003230.KS" },
  { kw: "스튜디오드래곤", code: "253450.KQ" },
  { kw: "Studio Dragon", code: "253450.KQ" },
  { kw: "현대건설", code: "000720.KS" },
  { kw: "Hyundai E&C", code: "000720.KS" },
  { kw: "더존비즈온", code: "012510.KS" },
  { kw: "Douzone", code: "012510.KS" },
  { kw: "LG디스플레이", code: "034220.KS" },
  { kw: "LG Display", code: "034220.KS" },
  { kw: "CJ대한통운", code: "000120.KS" },
  { kw: "CJ Logistics", code: "000120.KS" },

  // ── 미국 빅테크 (한·영) ──────────────────────────────────
  { kw: "엔비디아", code: "NVDA" },
  { kw: "Nvidia", code: "NVDA" },
  { kw: "NVDA", code: "NVDA" },
  { kw: "애플", code: "AAPL" },
  { kw: "Apple", code: "AAPL" },
  { kw: "AAPL", code: "AAPL" },
  { kw: "마이크로소프트", code: "MSFT" },
  { kw: "Microsoft", code: "MSFT" },
  { kw: "MSFT", code: "MSFT" },
  { kw: "알파벳", code: "GOOGL" },
  { kw: "Alphabet", code: "GOOGL" },
  { kw: "구글", code: "GOOGL" },
  { kw: "Google", code: "GOOGL" },
  { kw: "GOOGL", code: "GOOGL" },
  { kw: "메타", code: "META" },
  { kw: "Meta Platforms", code: "META" },
  { kw: "Meta ", code: "META" },
  { kw: "아마존", code: "AMZN" },
  { kw: "Amazon", code: "AMZN" },
  { kw: "AMZN", code: "AMZN" },
  { kw: "테슬라", code: "TSLA" },
  { kw: "Tesla", code: "TSLA" },
  { kw: "TSLA", code: "TSLA" },
  { kw: "TSMC", code: "TSM" },
  { kw: "팔란티어", code: "PLTR" },
  { kw: "Palantir", code: "PLTR" },
  { kw: "PLTR", code: "PLTR" },

  // ── 미국 카탈로그 확장 ───────────────────────────────────
  { kw: "브로드컴", code: "AVGO" },
  { kw: "Broadcom", code: "AVGO" },
  { kw: "AVGO", code: "AVGO" },
  { kw: "퀄컴", code: "QCOM" },
  { kw: "Qualcomm", code: "QCOM" },
  { kw: "QCOM", code: "QCOM" },
  { kw: "마이크론", code: "MU" },
  { kw: "Micron", code: "MU" },
  // \"MU\" 단독은 다른 단어에 끼어들 위험이 적은 케이스만 매칭하도록 word-boundary 처리는 matcher 에서.
  { kw: "MU ", code: "MU" },
  { kw: " MU,", code: "MU" },
  { kw: " MU:", code: "MU" },
  { kw: "ARM Holdings", code: "ARM" },
  { kw: "ARM chip", code: "ARM" },
  { kw: "마벨", code: "MRVL" },
  { kw: "Marvell", code: "MRVL" },
  { kw: "MRVL", code: "MRVL" },
  { kw: "슈퍼마이크로", code: "SMCI" },
  { kw: "Super Micro", code: "SMCI" },
  { kw: "SMCI", code: "SMCI" },
  { kw: "오라클", code: "ORCL" },
  { kw: "Oracle", code: "ORCL" },
  { kw: "ORCL", code: "ORCL" },
  { kw: "세일즈포스", code: "CRM" },
  { kw: "Salesforce", code: "CRM" },
  { kw: "서비스나우", code: "NOW" },
  { kw: "ServiceNow", code: "NOW" },
  { kw: "어도비", code: "ADBE" },
  { kw: "Adobe", code: "ADBE" },
  { kw: "ADBE", code: "ADBE" },
  { kw: "일라이릴리", code: "LLY" },
  { kw: "Eli Lilly", code: "LLY" },
  { kw: "유나이티드헬스", code: "UNH" },
  { kw: "UnitedHealth", code: "UNH" },
  { kw: "비자카드", code: "V" },
  { kw: "마스터카드", code: "MA" },
  { kw: "Mastercard", code: "MA" },
  { kw: "코스트코", code: "COST" },
  { kw: "Costco", code: "COST" },
  { kw: "월마트", code: "WMT" },
  { kw: "Walmart", code: "WMT" },
  { kw: "홈디포", code: "HD" },
  { kw: "Home Depot", code: "HD" },
  { kw: "알리바바", code: "BABA" },
  { kw: "Alibaba", code: "BABA" },
  { kw: "테무", code: "PDD" },
  { kw: "PDD Holdings", code: "PDD" },
  { kw: "Pinduoduo", code: "PDD" },
  { kw: "엑손모빌", code: "XOM" },
  { kw: "Exxon", code: "XOM" },
  { kw: "셰브론", code: "CVX" },
  { kw: "Chevron", code: "CVX" },
  { kw: "마이크로스트래티지", code: "MSTR" },
  { kw: "MicroStrategy", code: "MSTR" },
  { kw: "MSTR", code: "MSTR" },
  { kw: "코인베이스", code: "COIN" },
  { kw: "Coinbase", code: "COIN" },
];

// reverse lookup: 종목 코드 → 매칭 키워드 배열.
const KEYWORDS_BY_CODE: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const { kw, code } of NEWS_SYMBOL_KEYWORDS) {
    const list = m.get(code) ?? [];
    list.push(kw);
    m.set(code, list);
  }
  return m;
})();

// 종목 카드의 뉴스 탭에서 사용하는 매처.
// 종목 코드와 회사명(한글)이 들어왔을 때 해당 종목에 매칭되는 뉴스 1건인지 판정한다.
//
// 매칭 룰 (OR):
//   1) item.symbol === code                                  ← Google News fetch 단계에서 미리 라우팅된 경우
//   2) title 에 SYMBOL_KEYWORDS[code] 중 하나가 포함          ← 영어/한국어 별칭 매칭
//   3) title 에 한글 회사명(name)이 포함                       ← 폴백 (네이버 한국어 헤드라인)
//
// MU 같은 짧은 티커는 인접 문자 가드를 별도로 처리 (M, U 단독 매칭은 위험)했지만,
// 데이터에 " MU ", " MU,", " MU:" 같은 공백/구두점 포함 키워드를 미리 등록해 회피한다.
export function isNewsRelated(
  item: { symbol?: string | null; title?: string | null },
  code: string,
  name: string
): boolean {
  if (item.symbol === code) return true;
  const title = item.title ?? "";
  if (!title) return false;
  if (name && title.includes(name)) return true;
  const kws = KEYWORDS_BY_CODE.get(code);
  if (!kws) return false;
  const lowered = title.toLowerCase();
  for (const kw of kws) {
    if (title.includes(kw)) return true;
    // 영문 키워드는 대소문자 무관하게도 매칭
    if (/[A-Za-z]/.test(kw) && lowered.includes(kw.toLowerCase())) return true;
  }
  return false;
}
