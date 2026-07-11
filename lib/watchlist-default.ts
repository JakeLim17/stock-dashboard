import { PRIMARY_SYMBOLS } from "./symbols";

/** localStorage — 사용자가 저장한 기본 관심종목 */
export const DEFAULT_WATCHLIST_STORAGE_KEY = "stock-dashboard:default-watchlist";

export function primaryWatchCodes(): string[] {
  return PRIMARY_SYMBOLS.map((s) => s.code);
}

export function loadDefaultWatchlist(): string[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(DEFAULT_WATCHLIST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as string[]).filter((c) => typeof c === "string")
      : null;
  } catch {
    return null;
  }
}

export function saveDefaultWatchlist(codes: string[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DEFAULT_WATCHLIST_STORAGE_KEY, JSON.stringify(codes));
}

export function hasSavedDefaultWatchlist(): boolean {
  return loadDefaultWatchlist() != null;
}
