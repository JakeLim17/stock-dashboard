import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtNumber(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPercent(rate: number | null | undefined, digits = 2): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  const sign = rate > 0 ? "+" : "";
  return `${sign}${(rate * 100).toFixed(digits)}%`;
}

export function fmtSigned(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString("ko-KR")}`;
}

// 한국 주식은 빨강이 상승, 미국식은 초록이 상승. 대시보드는 한국식.
export function changeColor(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate) || rate === 0) return "text-muted-foreground";
  return rate > 0 ? "text-up" : "text-down";
}

export function fmtTime(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export function fmtRelative(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

// Yahoo marketState 한국어 라벨
// 한국 사용자 관점: "지금 보이는 가격이 정규장 종가인지 장중 실시간인지"가 핵심.
export function marketStateLabel(state?: string): {
  label: string;
  variant: "good" | "neutral" | "warn";
  hint?: string;
} {
  switch ((state ?? "").toUpperCase()) {
    case "REGULAR":
      return { label: "장중", variant: "good", hint: "실시간" };
    case "PRE":
      return {
        label: "장전 단일가",
        variant: "neutral",
        hint: "한국장 시간외·앱장은 미반영",
      };
    case "PREPRE":
      // 한국 새벽 시각이 대부분 여기. 표시는 종가 기준.
      return {
        label: "정규장 종가",
        variant: "warn",
        hint: "시간외·앱장 미반영",
      };
    case "POST":
      return {
        label: "장후 단일가",
        variant: "neutral",
        hint: "한국 시간외·앱장은 미반영",
      };
    case "POSTPOST":
      return {
        label: "정규장 종가",
        variant: "warn",
        hint: "시간외·앱장 미반영",
      };
    case "CLOSED":
      return {
        label: "장 마감",
        variant: "warn",
        hint: "시간외·앱장 미반영",
      };
    default:
      return { label: "—", variant: "neutral" };
  }
}

// 가격이 마지막으로 갱신된 시각을 사람이 읽는 형태로
export function priceTimeLabel(priceTime?: number | null): string {
  if (!priceTime) return "";
  const d = new Date(priceTime);
  return `${d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })} ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

// 안전한 fetch with timeout
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
