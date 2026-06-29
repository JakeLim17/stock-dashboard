"use client";

import { useEffect, useRef } from "react";
import type { NewsItem, StockSnapshot } from "@/lib/types";
import { useIsMobile } from "@/hooks/useIsMobile";
import { StockDetailPanel } from "./StockDetailPanel";
import { X } from "lucide-react";

// 모바일(lg 미만) 전용 — 카드 탭 시 StockDetailPanel 을 바닥에서 슬라이드 업하는
// 풀-너비 sheet 모달로 노출한다.
//
//   - 데스크탑은 기존대로 카드 그리드 아래에 StockDetailPanel 이 고정 노출되므로,
//     본 컴포넌트는 자체적으로 `lg:hidden` 클래스를 걸어 lg+ 화면에선 절대 보이지 않게 한다.
//   - 닫기 트리거: 헤더 X 버튼 / 배경(backdrop) 클릭 / ESC 키.
//   - body 스크롤 잠금 — 열려 있을 때 `overflow: hidden` 적용. 닫히면 복원.
//   - 슬라이드 애니메이션은 CSS transform translate-y. framer-motion 같은 추가 의존성 X.
//   - 안에 들어가는 StockDetailPanel 은 동일 컴포넌트라 추가 props 없이 그대로 재사용.
export function MobileDetailSheet({
  open,
  onClose,
  snap,
  allNews,
  krwRate,
  kisActive,
  marketSemiHeat,
}: {
  open: boolean;
  onClose: () => void;
  snap: StockSnapshot | null;
  allNews: NewsItem[];
  krwRate?: number | null;
  kisActive?: boolean;
  marketSemiHeat?: number | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  // 시각 효과 + side-effect 발동 조건. 데스크탑에선 sheet 자체가 `lg:hidden` 이고
  // body lock·ESC 도 일어나면 안 된다 (카드 탭 → setSheetOpen(true) 가 부모에서 무조건
  // 호출되기 때문에).
  const active = open && isMobile;

  // ESC 키 닫기 — 활성(=모바일+열림) 상태일 때만 리스너 등록.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  // body 스크롤 잠금 — 모달 뒤 페이지가 같이 흔들리는 걸 방지. 활성 상태일 때만.
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  return (
    <div
      // 데스크탑(lg+)에서는 절대 노출 안 함.
      // 닫혀있을 땐 pointer-events 없애고 backdrop 투명, sheet 는 화면 아래로 밀어둠.
      className={`fixed inset-0 z-[60] lg:hidden ${
        active ? "pointer-events-auto" : "pointer-events-none"
      }`}
      aria-hidden={!active}
      role="dialog"
      aria-modal={active ? "true" : undefined}
    >
      {/* Backdrop — 클릭 시 닫힘 */}
      <button
        type="button"
        onClick={onClose}
        aria-label="배경 클릭으로 닫기"
        className={`absolute inset-0 bg-black/55 backdrop-blur-[1px] transition-opacity duration-200 ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Sheet 본체 — 바닥에서 슬라이드 업 */}
      <div
        ref={panelRef}
        className={`absolute inset-x-0 bottom-0 max-h-[92vh] flex flex-col rounded-t-2xl border-t border-x border-border bg-background shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          active ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* 헤더 — drag handle 시각 + 종목명 + 닫기 X */}
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-border">
          <div className="flex-1 min-w-0">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" />
            <div className="text-xs text-muted-foreground tabular">
              {snap?.meta.code ?? ""}
            </div>
            <div className="text-base font-semibold truncate">
              {snap?.meta.name ?? "종목"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full border border-border bg-card hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 본문 — 스크롤 가능 */}
        <div className="flex-1 overflow-y-auto p-3">
          <StockDetailPanel
            snap={snap}
            allNews={allNews}
            krwRate={krwRate}
            kisActive={kisActive}
            mobileSheet
            marketSemiHeat={marketSemiHeat}
          />
        </div>
      </div>
    </div>
  );
}
