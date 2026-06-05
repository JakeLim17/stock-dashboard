import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Quote } from "./types";

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

// 가격 데이터 신선도 — 표시용 라벨 + stale 플래그.
//   stale 기준: 5분 이상 갱신이 없으면 매매 판단에 영향이 큼.
//   야후 미국 종목은 정규장 마감 + 시간외 데이터 없는 시점부터 stale로 보임.
//   지수(^IXIC/^SOX/^VIX)는 정규장 마감 후엔 데이터 한계로 stale 불가피 → 라벨로 사용자에게 명시.
export function priceFreshness(epochMs?: number | null): {
  label: string;
  stale: boolean;
  ageMinutes: number;
} | null {
  if (!epochMs) return null;
  const diffMs = Date.now() - epochMs;
  if (diffMs < 0) return { label: "방금", stale: false, ageMinutes: 0 };
  const min = Math.floor(diffMs / 60000);
  let label: string;
  if (min < 1) label = "방금";
  else if (min < 60) label = `${min}분 전`;
  else {
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    label = remMin > 0 ? `${hr}시간 ${remMin}분 전` : `${hr}시간 전`;
  }
  return {
    label,
    stale: min >= 5,
    ageMinutes: min,
  };
}

// 시간외/프리/애프터마켓 세션 라벨
export function extendedSessionLabel(session: string): string {
  switch (session) {
    case "pre":
      return "프리마켓";
    case "post":
      return "애프터마켓";
    case "kr-before":
      return "장전 시간외";
    case "kr-after":
      return "시간외 단일가";
    default:
      return "시간외";
  }
}

// 카드 헤더용 통합 시장 상태 라벨.
// 시간외 거래가 활성이면 marketState가 CLOSED여도 "장외 거래중"으로 덮어쓴다.
// 카드의 메인 가격은 항상 정규장 종가이므로, 사용자가 헤더만 보고
// "지금은 장이 닫혀 시간외만 돈다"는 사실을 즉시 알 수 있게 한다.
export function marketDisplayLabel(quote: {
  marketState?: string;
  extendedHours?: { active?: boolean; session: string } | null;
}): {
  label: string;
  variant: "good" | "neutral" | "warn";
  hint?: string;
} {
  // 정규장이 OPEN 이면 정규장 라벨이 항상 우선 — 데이터 소스가 시간외 정보를
  // 같이 보내더라도 무시한다.
  const isRegular = (quote.marketState ?? "").toUpperCase() === "REGULAR";
  if (isRegular) return marketStateLabel(quote.marketState);

  const ext = quote.extendedHours;
  if (ext?.active) {
    return {
      label: "장외 거래중",
      variant: "good",
      hint: extendedSessionLabel(ext.session),
    };
  }
  return marketStateLabel(quote.marketState);
}

// 카드 메인 가격으로 무엇을 보여줄지 결정.
// "지금 사용자가 가장 보고 싶은 가격"을 메인으로 올리는 게 핵심:
//   - 정규장 OPEN  → 메인=정규장(실시간), 부연 없음
//   - 정규장 마감 + 시간외 거래중 → 메인=시간외(라이브), 부연=정규장 종가
//   - 정규장 마감 + 시간외 종료 → 메인=정규장 종가, 부연=시간외 마감가
//   - 정규장 마감 + 시간외 데이터 없음 → 메인=정규장 종가, 부연 없음
export interface PrimaryQuoteView {
  price: number;
  changeRate: number;
  changeAbs: number;
  // epoch ms (없으면 null)
  time: number | null;
  // 메인 위치에 표시되는 가격이 시간외 가격인지
  isExtended: boolean;
  // "지금 진행 중인 거래"인지 — 라이브 표시(펄스 등)에 사용
  isLive: boolean;
  // "정규장" / "시간외 단일가" 등 한글 세션 이름
  sessionLabel: string;
}

export interface SecondaryQuoteView {
  price: number;
  changeRate: number;
  changeAbs: number;
  time: number | null;
  // 좌측 배지 텍스트 (예: "정규장 종가", "시간외 단일가")
  label: string;
  // 거래중 배지 표시 여부
  active: boolean;
  // 부연 위치에 표시되는 가격이 시간외인지 (false면 정규장 종가)
  isExtended: boolean;
  // 시간외일 때 누적 거래량 (있는 경우만)
  volume?: number | null;
}

export function pickPrimaryQuote(quote: Quote): {
  primary: PrimaryQuoteView;
  secondary: SecondaryQuoteView | null;
} {
  const isRegular = (quote.marketState ?? "").toUpperCase() === "REGULAR";
  const ext = quote.extendedHours ?? null;

  if (isRegular) {
    return {
      primary: {
        price: quote.price,
        changeRate: quote.changeRate,
        changeAbs: quote.changeAbs,
        time: quote.priceTime ?? null,
        isExtended: false,
        isLive: true,
        sessionLabel: "정규장",
      },
      secondary: null,
    };
  }

  if (ext?.active === true) {
    return {
      primary: {
        price: ext.price,
        changeRate: ext.changeRate,
        changeAbs: ext.changeAbs,
        time: ext.time ?? null,
        isExtended: true,
        isLive: true,
        sessionLabel: extendedSessionLabel(ext.session),
      },
      secondary: {
        price: quote.price,
        changeRate: quote.changeRate,
        changeAbs: quote.changeAbs,
        time: quote.priceTime ?? null,
        label: "정규장 종가",
        active: false,
        isExtended: false,
      },
    };
  }

  if (ext) {
    return {
      primary: {
        price: quote.price,
        changeRate: quote.changeRate,
        changeAbs: quote.changeAbs,
        time: quote.priceTime ?? null,
        isExtended: false,
        isLive: false,
        sessionLabel: "정규장 종가",
      },
      secondary: {
        price: ext.price,
        changeRate: ext.changeRate,
        changeAbs: ext.changeAbs,
        time: ext.time ?? null,
        label: extendedSessionLabel(ext.session),
        active: !!ext.active,
        isExtended: true,
        volume: ext.volume ?? null,
      },
    };
  }

  return {
    primary: {
      price: quote.price,
      changeRate: quote.changeRate,
      changeAbs: quote.changeAbs,
      time: quote.priceTime ?? null,
      isExtended: false,
      isLive: false,
      sessionLabel: "정규장 종가",
    },
    secondary: null,
  };
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
