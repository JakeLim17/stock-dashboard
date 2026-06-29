"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { RecommendationsResponse } from "@/lib/types";
import { toFriendlyErrorMessage } from "@/lib/utils";

/** 서버 인메모리 TTL과 동일 — 클라이언트 모듈 캐시 */
const TTL_MS = 30 * 60 * 1000;

type Snapshot = {
  data: RecommendationsResponse | null;
  loading: boolean;
  error: string | null;
};

let cached: { data: RecommendationsResponse; expiresAt: number } | null = null;
let inFlight: Promise<RecommendationsResponse | null> | null = null;
let abortCtrl: AbortController | null = null;

let snapshot: Snapshot = { data: null, loading: false, error: null };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setSnapshot(next: Snapshot) {
  snapshot = next;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

async function loadRecommendations(
  refresh = false
): Promise<RecommendationsResponse | null> {
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    setSnapshot({ data: cached.data, loading: false, error: null });
    return cached.data;
  }

  if (inFlight && !refresh) {
    return inFlight;
  }

  if (abortCtrl) abortCtrl.abort();
  const ctrl = new AbortController();
  abortCtrl = ctrl;

  setSnapshot({
    data: refresh ? null : snapshot.data,
    loading: true,
    error: null,
  });

  const promise = (async () => {
    try {
      const r = await fetch(
        `/api/recommendations${refresh ? "?refresh=1" : ""}`,
        { cache: "no-store", signal: ctrl.signal }
      );
      if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
      const j = (await r.json()) as RecommendationsResponse;
      cached = { data: j, expiresAt: Date.now() + TTL_MS };
      setSnapshot({ data: j, loading: false, error: null });
      return j;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      setSnapshot({
        data: snapshot.data,
        loading: false,
        error: toFriendlyErrorMessage(e),
      });
      return null;
    } finally {
      if (abortCtrl === ctrl) abortCtrl = null;
      inFlight = null;
    }
  })();

  inFlight = promise;
  return promise;
}

/**
 * 추천 API 공유 훅 — RecommendationsPanel·ThemeGroupView가 동일 캐시/in-flight 사용.
 * enabled=true(패널 첫 펼침)일 때만 lazy fetch. 두 번째 패널 = 0 fetch.
 */
export function useRecommendations(enabled: boolean) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    void loadRecommendations(false);
  }, [enabled]);

  const refresh = useCallback(() => loadRecommendations(true), []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    refresh,
  };
}
