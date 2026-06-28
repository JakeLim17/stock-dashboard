"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { DashboardClient } from "./DashboardClient";
import { DashboardSkeleton } from "./skeletons/DashboardSkeleton";
import { toFriendlyErrorMessage } from "@/lib/utils";

// 페이지가 server 측 fetch 를 기다리지 않고 즉시 응답되도록 하는 client wrapper.
//   1) mount 즉시 DashboardSkeleton 표시
//   2) Phase A: /api/snapshot?lite=1 — 시세·지표만 (~1~3초) → DashboardClient 교체
//   3) Phase B: DashboardClient 가 full snapshot 을 백그라운드 fetch 후 merge
//   4) 이후 폴링·갱신은 DashboardClient 가 기존대로 담당

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

function buildSnapshotUrl(lite: boolean): string {
  const symbolsParam = readSavedSymbolsParam();
  const nightOn = readSavedNightFlag();
  const qs = new URLSearchParams();
  if (symbolsParam) qs.set("symbols", symbolsParam);
  if (nightOn) qs.set("night", "1");
  if (lite) qs.set("lite", "1");
  return qs.toString() ? `/api/snapshot?${qs.toString()}` : `/api/snapshot${lite ? "?lite=1" : ""}`;
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
        const r = await fetch(buildSnapshotUrl(true), {
          cache: "default",
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
        const j = (await r.json()) as DashboardSnapshot;
        if (mountedRef.current) setSnap(j);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        if (mountedRef.current) {
          setError(toFriendlyErrorMessage(e));
        }
      }
    })();
    return () => {
      mountedRef.current = false;
      ctrl.abort();
    };
  }, []);

  if (snap) return <DashboardClient initial={snap} />;

  return (
    <>
      <DashboardSkeleton phase="lite" />
      {error && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md rounded-lg border border-down/40 bg-down/10 px-4 py-2 text-sm text-down shadow-lg"
        >
          첫 로딩 실패 — {error} 새로고침 해 주세요.
        </div>
      )}
    </>
  );
}
