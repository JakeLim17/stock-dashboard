import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// 영어 → 한국어 제목 번역 (MyMemory Translation API)
//
// - endpoint: https://api.mymemory.translated.net/get
//   파라미터: q=<문구>&langpair=en|ko&de=<contact email>
//   응답: { responseData: { translatedText: string }, responseStatus: 200 }
// - 무료 anonymous 일일 5000 words 제한. de=contact 명시 시 더 여유.
// - 메모리 Map 캐시 + 24h TTL → 같은 제목은 한 번만 번역.
// - 1초 1회 throttle 로 burst 차단.
// - 8s 타임아웃, 200 외 응답·에러 시 원문 반환 (graceful).
//
// 본문은 번역하지 않는다. 제목만이라도 한글로 보이면 UX 가 크게 개선되고,
// MyMemory 한도 안에 들어온다.
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = "https://api.mymemory.translated.net/get";
const CONTACT = "stock-dashboard@example.com";
const TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const THROTTLE_GAP_MS = 1100; // 1초 1회 + 약간의 여유

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// 최근 요청 시각(epoch ms). 다음 요청은 lastRequestAt + THROTTLE_GAP_MS 까지 대기.
let lastRequestAt = 0;

function isLikelyEnglish(s: string): boolean {
  // ASCII 알파벳 비율이 60% 이상이면 영어로 간주. 숫자·공백·구두점은 분모 제외.
  const letters = s.match(/[A-Za-z]/g)?.length ?? 0;
  const meaningful = s.replace(/[\d\s.,!?'"()\-:;&%$/]/g, "").length || 1;
  return letters / meaningful >= 0.6;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + THROTTLE_GAP_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

// 단일 제목 번역. 실패 시 원문 반환.
export async function translateTitleToKo(text: string): Promise<string> {
  const original = (text ?? "").trim();
  if (!original) return original;
  if (!isLikelyEnglish(original)) return original;

  const key = normalizeKey(original);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  await throttle();

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const url =
      `${ENDPOINT}?q=${encodeURIComponent(original)}` +
      `&langpair=en|ko&de=${encodeURIComponent(CONTACT)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return original;
    const json = (await res.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number | string;
    };
    const status = Number(json.responseStatus ?? 0);
    const translated = json.responseData?.translatedText?.trim() ?? "";
    if (status !== 200 || !translated) return original;
    // 결과가 원문과 동일하면 의미 없는 번역이므로 캐시는 하되 변환은 없음.
    cache.set(key, { value: translated, expiresAt: Date.now() + TTL_MS });
    return translated;
  } catch {
    return original;
  }
}

// 여러 제목을 순차 번역. throttle 이 1초 1회라 Promise.all 로 묶어봐야
// 어차피 직렬 효과 — 명시적으로 직렬 실행해 race 방지.
export async function translateTitlesToKo(titles: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const t of titles) {
    out.push(await translateTitleToKo(t));
  }
  return out;
}

// 테스트·디버그용
export function _resetTranslationCache(): void {
  cache.clear();
  lastRequestAt = 0;
}
