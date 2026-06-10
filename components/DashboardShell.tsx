"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { DashboardClient } from "./DashboardClient";
import { DashboardSkeleton } from "./skeletons/DashboardSkeleton";

// 페이지가 server 측 fetch 를 기다리지 않고 즉시 응답되도록 하는 client wrapper.
//   1) mount 즉시 DashboardSkeleton 표시 (헤더 + SummaryBar + 카드 그리드 자리)
//   2) /api/snapshot 을 한 번 fetch 해서 데이터 도착 시 DashboardClient 로 교체
//   3) 이후 폴링·갱신은 DashboardClient 가 기존대로 담당
//
// 이전 구조(server Suspense + DashboardLoader → WatchlistLoader)는 page.tsx 가
// snapshot 완료까지 응답을 보류해 첫 진입이 수십초 hang 되는 사고가 있었다.
// 이 wrapper 로 페이지 진입 자체를 ~즉시(<200ms) 로 만든다.

// localStorage 의 워치리스트를 읽어 첫 fetch URL 에 ?symbols=... 로 동봉.
// 이 단계가 없으면 서버는 PRIMARY_SYMBOLS(KR 3종)만 응답해 미국 종목 카드가
// "처음엔 안 보이다가 폴링 한 사이클 뒤에 등장"하는 깜빡임이 생긴다.
// SSR 안전을 위해 typeof window 가드 + try/catch 로 감싼다.
const STORAGE_KEY = "watchlist.codes.v1";
const NIGHT_STORAGE_KEY = "watchlist.overseasNight.v1";

function readSavedSymbolsParam(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return "";
    const codes = parsed
      .filter((c): c is string => typeof c === "string" && c.length > 0)
      .slice(0, 8);
    return codes.length > 0 ? codes.join(",") : "";
  } catch {
    return "";
  }
}

function readSavedNightFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NIGHT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function DashboardShell() {
  const [snap, setSnap] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const ctrl = new AbortController();
    (async () => {
      try {
        const symbolsParam = readSavedSymbolsParam();
        const nightOn = readSavedNightFlag();
        const qs = new URLSearchParams();
        if (symbolsParam) qs.set("symbols", symbolsParam);
        if (nightOn) qs.set("night", "1");
        const url = qs.toString()
          ? `/api/snapshot?${qs.toString()}`
          : "/api/snapshot";
        const r = await fetch(url, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
        const j = (await r.json()) as DashboardSnapshot;
        if (mountedRef.current) setSnap(j);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      mountedRef.current = false;
      ctrl.abort();
    };
  }, []);

  if (snap) return <DashboardClient initial={snap} />;

  // 첫 fetch 실패 시에도 일단 skeleton 위에 작은 안내. 사용자가 새로고침으로 재시도 가능.
  return (
    <>
      <DashboardSkeleton />
      {error && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md rounded-lg border border-down/40 bg-down/10 px-4 py-2 text-sm text-down shadow-lg"
        >
          첫 로딩 실패 — {error}. 새로고침 해 주세요.
        </div>
      )}
    </>
  );
}
