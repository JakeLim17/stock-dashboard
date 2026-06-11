"use client";

import { useEffect, useState } from "react";

// 첫 방문 시 1회만 노출되는 면책 모달.
//
// 자본시장법 §49(투자권유 정의) / SEC IA Act §202 단정 표현 리스크 보강용 — verdict 단어와
// TP1/TP2/SL 숫자가 그대로 노출되는 도구이므로, "정보 제공용·본인 책임" 임을 사용자가
// 한 번은 명시적으로 인지하도록 한다.
//
// 동작:
//   - localStorage 키(DISCLAIMER_KEY) 가 있으면 절대 노출 안 함 (1회 표시 후 영구 skip).
//   - 동의 체크 + "확인" 클릭해야 닫힘. 닫히는 순간 localStorage 에 기록.
//   - "닫기" 버튼은 없음 (가볍게 dismiss 하면 면책의 의미가 약해짐).
//
// UX 결정:
//   - 모달 자체는 1회만. 두 번째 방문부터 사라짐.
//   - z-index 충분히 높게(z-[100]) — Sheet/Drawer 위에 떠야 의미가 있음.

const DISCLAIMER_KEY = "stock-dashboard.disclaimer-ack.v1";

export function DisclaimerModal() {
  // SSR-safe: 첫 paint 직후 localStorage 확인 후 결정.
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    try {
      const acked = window.localStorage.getItem(DISCLAIMER_KEY);
      if (!acked) setOpen(true);
    } catch {
      // localStorage 차단(시크릿 모드 등)이면 그냥 표시하지 않음 — 매번 띄우는 게 더 피곤.
    }
  }, []);

  if (!open) return null;

  const onConfirm = () => {
    try {
      window.localStorage.setItem(DISCLAIMER_KEY, String(Date.now()));
    } catch {
      // 저장 실패해도 일단 닫기 — 안 닫으면 사용자 불가.
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl p-5 space-y-4">
        <div className="space-y-1.5">
          <h2
            id="disclaimer-title"
            className="text-base font-bold leading-snug"
          >
            ⚠️ 이용 전 안내
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            본 도구는 <strong className="text-foreground">정보 제공용</strong>
            입니다. 화면의 모든 신호·예측·점수는 룰 기반 알고리즘 출력이며,
            <strong className="text-foreground"> 투자권유 또는 매매 추천이 아닙니다.</strong>
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            투자 결정과 그 결과 책임은 전적으로 사용자에게 있습니다.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border accent-accent"
          />
          <span className="leading-snug">
            위 내용을 이해했으며, 투자 결정은 본인 책임이라는 점에 동의합니다.
          </span>
        </label>

        <button
          type="button"
          onClick={onConfirm}
          disabled={!agreed}
          className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-colors ${
            agreed
              ? "bg-accent text-accent-foreground hover:opacity-90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          확인하고 시작
        </button>
      </div>
    </div>
  );
}
