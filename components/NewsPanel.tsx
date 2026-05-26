"use client";

import type { NewsItem } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { fmtRelative } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import { useState } from "react";

export function NewsPanel({ items }: { items: NewsItem[] }) {
  const [filter, setFilter] = useState<"all" | "positive" | "negative">("all");
  const filtered = items.filter((n) => filter === "all" || n.sentiment === filter);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>실시간 뉴스</CardTitle>
        <div className="flex gap-1">
          {(["all", "positive", "negative"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                filter === f
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f === "all" ? "전체" : f === "positive" ? "호재" : "악재"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardBody className="max-h-[520px] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">뉴스 없음</div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((n) => (
              <li key={n.id} className="border-b border-border pb-3 last:border-0">
                <a
                  href={n.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2"
                >
                  <span className="flex-1 text-sm leading-snug group-hover:underline">
                    {n.title}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </a>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-xs text-muted-foreground">{n.source}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{fmtRelative(n.publishedAt)}</span>
                  {n.sentiment === "positive" && <Badge variant="good">호재</Badge>}
                  {n.sentiment === "negative" && <Badge variant="bad">악재</Badge>}
                  {(n.keywords ?? []).slice(0, 2).map((k) => (
                    <Badge key={k} variant="neutral">
                      {k}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
