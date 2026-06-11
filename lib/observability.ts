// 에러 캡처 hook stub — 향후 Sentry 등 외부 관찰성 SDK 도입을 위한 진입점.
//
// 사용 정책
//  - 새 패키지(@sentry/nextjs 등) 의존성은 사용자 동의 없이 추가하지 않는다.
//  - 현재는 console.error 만 호출. SENTRY_DSN(또는 동등 env)이 채워져 있고
//    런타임에 Sentry SDK 가 init 되어 있다면 globalThis 로 노출된 hook 을 호출한다.
//  - 도입 절차(향후):
//      1) `npm install @sentry/nextjs`
//      2) `sentry.client.config.ts` / `sentry.server.config.ts` 추가 후 init
//      3) 본 파일의 captureError 가 자동으로 Sentry.captureException 으로 위임됨
//        (전역에 등록된 capture function 을 우선 호출하도록 설계)

type ObsCaptureFn = (err: unknown, ctx?: Record<string, unknown>) => void;

declare global {
  // 외부 SDK 가 초기화 시 등록 — 없으면 console.error 로 폴백.
  // eslint-disable-next-line no-var
  var __OBS_CAPTURE_ERROR__: ObsCaptureFn | undefined;
}

function hasDsn(): boolean {
  return Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
}

export function captureError(
  err: unknown,
  ctx?: Record<string, unknown>
): void {
  try {
    const external = globalThis.__OBS_CAPTURE_ERROR__;
    if (typeof external === "function") {
      external(err, ctx);
      return;
    }
  } catch {
    // 외부 hook 자체가 throw 해도 본 함수는 절대 throw 하지 않는다.
  }

  // DSN 만 있고 SDK 미초기화 상태 — 일단 콘솔에만 흘려보낸다.
  // 메시지에 dsn-present 표식을 남겨 로그에서 식별 가능.
  if (hasDsn()) {
    console.error("[obs:dsn-present]", err, ctx ?? {});
    return;
  }
  console.error("[obs]", err, ctx ?? {});
}

// 외부에서 hook 등록 — Sentry init 코드에서 호출.
export function registerCaptureError(fn: ObsCaptureFn): void {
  globalThis.__OBS_CAPTURE_ERROR__ = fn;
}
