/** 간단한 메모리 TTL 캐시 + in-flight 디듀프 (공시·감성 등 외부 API용) */

interface Entry<T> {
  data: T;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ttlCaches: Map<string, Map<string, Entry<unknown>>> | undefined;
  // eslint-disable-next-line no-var
  var __ttlFlights: Map<string, Map<string, Promise<unknown>>> | undefined;
}

function getStore(ns: string): Map<string, Entry<unknown>> {
  if (!global.__ttlCaches) global.__ttlCaches = new Map();
  let m = global.__ttlCaches.get(ns);
  if (!m) {
    m = new Map();
    global.__ttlCaches.set(ns, m);
  }
  return m;
}

function getFlight(ns: string): Map<string, Promise<unknown>> {
  if (!global.__ttlFlights) global.__ttlFlights = new Map();
  let m = global.__ttlFlights.get(ns);
  if (!m) {
    m = new Map();
    global.__ttlFlights.set(ns, m);
  }
  return m;
}

export async function getOrFetchTtl<T>(opts: {
  ns: string;
  key: string;
  ttlMs: number;
  fetch: () => Promise<T>;
}): Promise<T> {
  const store = getStore(opts.ns);
  const flight = getFlight(opts.ns);
  const now = Date.now();
  const hit = store.get(opts.key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.data;

  const inflight = flight.get(opts.key) as Promise<T> | undefined;
  if (inflight) return inflight;

  const p = opts
    .fetch()
    .then((data) => {
      store.set(opts.key, { data, expiresAt: Date.now() + opts.ttlMs });
      flight.delete(opts.key);
      return data;
    })
    .catch((err) => {
      flight.delete(opts.key);
      throw err;
    });
  flight.set(opts.key, p);
  return p;
}

/** 프로세스 내 간단한 token-bucket 스타일 rate limit (초당 N회) */
const buckets = new Map<string, { tokens: number; last: number }>();

export function takeRateToken(
  scope: string,
  maxPerSec: number
): boolean {
  const now = Date.now();
  let b = buckets.get(scope);
  if (!b) {
    b = { tokens: maxPerSec, last: now };
    buckets.set(scope, b);
  }
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(maxPerSec, b.tokens + elapsed * maxPerSec);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
