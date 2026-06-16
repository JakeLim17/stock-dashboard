// /api/realtime/health — 실시간 사용 가능 여부 사전 점검 endpoint.
//
// 이유:
//   /api/realtime/stream 은 운영(NODE_ENV=production)에서 KIS_WS_RELAY_URL 가 없으면
//   503 + SSE-style body 로 응답한다. EventSource 는 200 + text/event-stream 만
//   SSE 로 파싱하므로 503 body 의 reason 정보가 클라이언트에 전달되지 않고
//   `onerror` 만 발생 → backoff 재연결 무한 루프 → Vercel 로그 폭주.
//
// 해결:
//   useRealtime hook 이 EventSource 를 열기 전에 이 endpoint 를 한 번 호출.
//   503 이면 이번 페이지 lifetime 동안 영구 disabled 처리하고 EventSource 자체를 안 연다.
//   200 이면 정상 진행.
//
// 노출 정보는 enabled boolean 만 — 시크릿 없음.
// middleware PUBLIC_PATHS 에 등록되어 인증 우회.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isRealtimeEnabled(): boolean {
  // /api/realtime/stream 의 503 분기와 동일 조건:
  //   - relay URL 이 있으면 OK (운영 권장 경로)
  //   - 아니면 비운영(개발) 일 때만 direct WS 시도 허용
  return (
    !!process.env.KIS_WS_RELAY_URL || process.env.NODE_ENV !== "production"
  );
}

export async function GET() {
  const enabled = isRealtimeEnabled();
  return new Response(JSON.stringify({ enabled }), {
    status: enabled ? 200 : 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function HEAD() {
  const enabled = isRealtimeEnabled();
  return new Response(null, {
    status: enabled ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
