/** OpenDART 보고서명 분류 — server-only 없이 테스트 가능 */

export type DartEventKind =
  | "dilution"
  | "earnings"
  | "ownership"
  | "merger"
  | "buyback"
  | "bonus"
  | "risk"
  | "other";

export function classifyDartReport(reportNm: string): {
  kind: DartEventKind;
  label: string;
} {
  const t = reportNm.replace(/\s+/g, "");
  if (/유상증자|전환사채|신주인수권|CB발행|BW발행|교환사채/.test(t)) {
    return { kind: "dilution", label: "유상·전환 공시" };
  }
  if (/무상증자/.test(t)) {
    return { kind: "bonus", label: "무상증자 공시" };
  }
  if (
    /자기주식.*(취득|매입|소각)|자사주매입|자사주소각|주주환원|배당결정|현금배당/.test(
      t
    )
  ) {
    return { kind: "buyback", label: "환원·자사주 공시" };
  }
  if (/합병|분할|영업양수|영업양도|포괄적주식교환|주식교환/.test(t)) {
    return { kind: "merger", label: "합병·분할 공시" };
  }
  if (
    /대량보유|임원ㆍ주요주주|임원·주요주주|특정증권등소유|주식등의대량보유/.test(
      t
    )
  ) {
    return { kind: "ownership", label: "지분변동 공시" };
  }
  if (
    /잠정|실적|분기보고서|반기보고서|사업보고서|연결재무제표|재무제표/.test(t)
  ) {
    return { kind: "earnings", label: "실적 공시" };
  }
  if (/횡령|배임|감사의견|제재|소송|영업정지|상장폐지|관리종목|거래정지/.test(t)) {
    return { kind: "risk", label: "리스크 공시" };
  }
  return { kind: "other", label: "주요 공시" };
}
