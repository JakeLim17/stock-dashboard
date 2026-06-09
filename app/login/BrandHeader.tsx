import { Activity } from "lucide-react";

// 로그인 카드 상단 — 브랜드 + 라이브 dot + 정적 ticker line.
// ticker 값은 디자인 요소(데모용)로 하드코딩. 실제 시세 연동 X — 로그인 전이라 데이터 의존 X.
const TICKER_ITEMS = [
  { label: "KOSPI", value: "2,580.40", up: false },
  { label: "NASDAQ", value: "21,402.18", up: true },
  { label: "NVDA", value: "1,250.32", up: true },
] as const;

export function BrandHeader() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Activity className="h-6 w-6 text-accent" strokeWidth={2.25} />
            <div
              aria-hidden
              className="absolute inset-0 blur-md opacity-60 -z-10"
              style={{ color: "var(--accent)" }}
            >
              <Activity className="h-6 w-6" strokeWidth={2.25} />
            </div>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            실시간 주식 대시보드
          </h1>
        </div>

        <LiveDot />
      </div>

      {/* 정적 ticker line — 모노스페이스, 살짝 흐릿하게 */}
      <div className="font-mono text-[11px] text-muted-foreground/80 tabular flex flex-wrap gap-x-3 gap-y-1">
        {TICKER_ITEMS.map((it, i) => (
          <span key={it.label} className="inline-flex items-center gap-1.5">
            <span className="opacity-70">{it.label}</span>
            <span className="text-foreground/80">{it.value}</span>
            <span className={it.up ? "text-up" : "text-down"}>
              {it.up ? "▲" : "▼"}
            </span>
            {i < TICKER_ITEMS.length - 1 && (
              <span className="opacity-40 ml-1">·</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function LiveDot() {
  return (
    <div className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      <span className="text-emerald-400/90">LIVE</span>
    </div>
  );
}
