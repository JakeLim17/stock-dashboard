"use client";

import type { NewsItem } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { fmtRelative } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { RISK_KEYWORDS } from "@/lib/news/keywords";
import { POSITIVE_KEYWORDS } from "@/lib/news/positiveKeywords";

type FreshFilter = "24h" | "3d" | "7d" | "all";
type SentimentFilter = "all" | "positive" | "negative";

const H = 60 * 60 * 1000;
const D = 24 * H;

const FRESH_MS: Record<FreshFilter, number> = {
  "24h": 24 * H,
  "3d": 3 * D,
  "7d": 7 * D,
  all: Number.POSITIVE_INFINITY,
};

// 헤드라인 내 호재/악재 키워드를 색상 하이라이트.
//   - 악재(RISK): 빨강 (text-down)
//   - 호재(POSITIVE): 초록 (text-up)
// 같은 헤드라인에 둘 다 잡히면 각자 분리 매칭 (위치가 겹치면 weight 큰 쪽 우선).
function highlightKeywords(title: string): ReactNode {
  const matches: Array<{
    start: number;
    end: number;
    weight: number;
    kind: "risk" | "opp";
  }> = [];

  const collect = (
    sources: Array<{ pattern: RegExp; weight: number }>,
    kind: "risk" | "opp"
  ) => {
    for (const kw of sources) {
      const flags = kw.pattern.flags.includes("g")
        ? kw.pattern.flags
        : kw.pattern.flags + "g";
      const re = new RegExp(kw.pattern.source, flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(title)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          weight: kw.weight,
          kind,
        });
      }
    }
  };
  collect(RISK_KEYWORDS, "risk");
  collect(POSITIVE_KEYWORDS, "opp");

  if (matches.length === 0) return title;

  // start 오름차순 → 같은 시작이면 weight 큰 것 우선 → 그 다음 end 큰 것
  matches.sort(
    (a, b) => a.start - b.start || b.weight - a.weight || b.end - a.end
  );

  // 겹치는 매칭은 먼저 채택된 것 유지 (weight 우선이라 자연스럽게 무거운 쪽이 남음).
  const filtered: Array<{ start: number; end: number; kind: "risk" | "opp" }> =
    [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start < lastEnd) continue;
    filtered.push({ start: m.start, end: m.end, kind: m.kind });
    lastEnd = m.end;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  filtered.forEach((m, idx) => {
    if (cursor < m.start) parts.push(title.slice(cursor, m.start));
    const cls =
      m.kind === "risk"
        ? "bg-down/15 text-down rounded px-0.5 mx-0.5"
        : "bg-up/15 text-up rounded px-0.5 mx-0.5";
    parts.push(
      <mark key={`${m.kind}${idx}-${m.start}`} className={cls}>
        {title.slice(m.start, m.end)}
      </mark>
    );
    cursor = m.end;
  });
  if (cursor < title.length) parts.push(title.slice(cursor));
  return parts;
}

export function NewsPanel({
  items,
  selectedSymbol,
}: {
  items: NewsItem[];
  selectedSymbol?: { code: string; name: string } | null;
}) {
  const [sentiment, setSentiment] = useState<SentimentFilter>("all");
  const [fresh, setFresh] = useState<FreshFilter>("7d");
  const [onlySelected, setOnlySelected] = useState(false);

  // 선택 종목과 매칭되는 뉴스(헤드라인에 종목명 또는 symbol 일치)는 상단으로 끌어올리고
  // 좌측에 accent 보더로 시각 강조한다. matchSelected가 true인 항목이 우선 정렬 키.
  const isSelectedMatch = (n: NewsItem): boolean => {
    if (!selectedSymbol) return false;
    if (n.symbol === selectedSymbol.code) return true;
    return (n.title || "").includes(selectedSymbol.name);
  };

  const filtered = useMemo(() => {
    const now = Date.now();
    const span = FRESH_MS[fresh];
    return items
      .filter((n) => {
        if (sentiment !== "all" && n.sentiment !== sentiment) return false;
        if (now - n.publishedAt > span) return false;
        if (onlySelected && selectedSymbol) {
          const inTitle = (n.title || "").includes(selectedSymbol.name);
          const symbolHit = n.symbol === selectedSymbol.code;
          if (!inTitle && !symbolHit) return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => {
        // 1순위: 선택 종목 매칭 뉴스를 맨 위로
        const aMatch = isSelectedMatch(a);
        const bMatch = isSelectedMatch(b);
        if (aMatch !== bMatch) return aMatch ? -1 : 1;
        // 2순위: 24h 이내 뉴스 우선
        const aRecent = now - a.publishedAt < 24 * H;
        const bRecent = now - b.publishedAt < 24 * H;
        if (aRecent !== bRecent) return aRecent ? -1 : 1;
        return b.publishedAt - a.publishedAt;
      });
  }, [items, sentiment, fresh, onlySelected, selectedSymbol]);

  const now = Date.now();

  return (
    <Card>
      <CardHeader className="flex items-center justify-between flex-wrap gap-2">
        <CardTitle>실시간 뉴스</CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 신선도 탭 */}
          <div className="flex gap-1">
            {(["24h", "3d", "7d", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFresh(f)}
                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                  fresh === f
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
                title={
                  f === "24h"
                    ? "최근 24시간"
                    : f === "3d"
                      ? "최근 3일"
                      : f === "7d"
                        ? "최근 7일"
                        : "전체"
                }
              >
                {f === "all" ? "전체" : f}
              </button>
            ))}
          </div>
          {/* sentiment 탭 */}
          <div className="flex gap-1">
            {(["all", "positive", "negative"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setSentiment(f)}
                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                  sentiment === f
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {f === "all" ? "전체" : f === "positive" ? "호재" : "악재"}
              </button>
            ))}
          </div>
          {/* 종목 한정 */}
          {selectedSymbol && (
            <button
              onClick={() => setOnlySelected((v) => !v)}
              className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                onlySelected
                  ? "bg-accent/15 border-accent/40 text-accent"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
              title="현재 선택된 종목 관련 뉴스만 보기"
            >
              {selectedSymbol.name}만
            </button>
          )}
        </div>
      </CardHeader>
      <CardBody className="max-h-[520px] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">
            조건에 맞는 뉴스 없음
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((n) => {
              const isRecent = now - n.publishedAt < 24 * H;
              const isMatch = isSelectedMatch(n);
              return (
                <li
                  key={n.id}
                  className={`border-b border-border pb-3 last:border-0 flex items-start gap-2 ${
                    isMatch
                      ? "border-l-2 border-l-accent bg-accent/5 pl-2 -ml-2 rounded-r"
                      : ""
                  }`}
                >
                  {/* 24h 이내 빨강 점 마커 */}
                  <span
                    className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                      isRecent ? "bg-down" : "bg-transparent"
                    }`}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <a
                      href={n.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2"
                    >
                      <span className="flex-1 text-sm leading-snug group-hover:underline">
                        {highlightKeywords(n.title)}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </a>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {n.source}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        {fmtRelative(n.publishedAt)}
                      </span>
                      {n.sentiment === "positive" && (
                        <Badge variant="good">호재</Badge>
                      )}
                      {n.sentiment === "negative" && (
                        <Badge variant="bad">악재</Badge>
                      )}
                      {(n.keywords ?? []).slice(0, 2).map((k) => (
                        <Badge key={k} variant="neutral">
                          {k}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
