// Port of internal/sources/util.go.

const RETRY_DELAYS_MS = [250, 750];
// 429s usually need a longer pause than a transient 5xx; Retry-After wins
// when the upstream provides one.
const RATE_LIMIT_RETRY_DELAYS_MS = [1_000, 3_000];
const MAX_RETRY_AFTER_MS = 5_000;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_HTTP_ERROR_DETAIL = 200;
const DEFAULT_SOURCE_USER_AGENT =
  "feedreader/0.1 (+https://reader.boringcode.dev)";
const DEFAULT_SOURCE_ACCEPT =
  "application/json, text/html;q=0.9, */*;q=0.8";

export class HttpError extends Error {
  readonly statusCode: number;
  readonly body: string;

  constructor(statusCode: number, body: string) {
    super(
      body
        ? `unexpected status ${statusCode}: ${body}`
        : `unexpected status ${statusCode}`,
    );
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

function retryDelayMs(response: Response | null, attemptIndex: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) {
      return Math.min(Math.max(at - Date.now(), 0), MAX_RETRY_AFTER_MS);
    }
  }

  const base =
    response?.status === 429
      ? (RATE_LIMIT_RETRY_DELAYS_MS[attemptIndex] ?? 0)
      : (RETRY_DELAYS_MS[attemptIndex] ?? 0);
  return base + Math.floor(Math.random() * 200);
}

/** Mirrors getWithRetry: up to 2 retries on 408/425/429/5xx. Source requests
 * carry a descriptive user agent instead of the Worker default so upstream
 * bot protection can identify the client. */
export async function getWithRetry(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) {
    headers.set("User-Agent", DEFAULT_SOURCE_USER_AGENT);
  }
  if (!headers.has("accept")) {
    headers.set("Accept", DEFAULT_SOURCE_ACCEPT);
  }
  const requestInit: RequestInit = { ...init, headers };

  const attempts = RETRY_DELAYS_MS.length + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let delay = 0;
    try {
      const response = await fetch(url, requestInit);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === attempts) {
        return response;
      }
      await response.body?.cancel().catch(() => {});
      delay = retryDelayMs(response, attempt - 1);
    } catch (error) {
      if (init.signal?.aborted || attempt === attempts) throw error;
      lastError = error;
      delay = retryDelayMs(null, attempt - 1);
    }
    await sleep(delay, init.signal ?? undefined);
  }
  throw lastError ?? new Error(`upstream retry loop exhausted for ${url}`);
}

/** Reads at most `limit` bytes from the response body and decodes them as
 * UTF-8. Error pages can be large (the old Hugging Face HTML path returned a
 * 1.4 MB challenge page), and only a short diagnostic prefix is needed. */
export async function readLimitedText(
  response: Response,
  limit: number,
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    return text.slice(0, limit);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let out = "";
  try {
    while (bytesRead < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = limit - bytesRead;
      const chunk =
        value.byteLength > remaining ? value.subarray(0, remaining) : value;
      bytesRead += chunk.byteLength;
      out += decoder.decode(chunk, { stream: true });
      if (value.byteLength > remaining) break;
    }
    out += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}

/** Returns a short, safe error detail. HTML challenge/error pages are
 * replaced with a fixed message so their markup never reaches /healthz, the
 * UI error banner, or D1's last_error column. */
export async function readHttpErrorDetail(
  response: Response,
  limit = MAX_HTTP_ERROR_DETAIL,
): Promise<string> {
  const text = await readLimitedText(response, Math.max(limit, 512));
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    contentType.includes("text/html") ||
    /<(?:!doctype|html|head|body)\b/i.test(text)
  ) {
    return "upstream returned an HTML error page";
  }
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function extractInt(value: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(value);
  if (!match || match.length < 2) return undefined;
  const cleaned = match[1]!.replace(/,/g, "");
  if (cleaned === "") return undefined;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Strips every non-digit character, then parses what's left — used for
 * "2,142" (stargazers count) style text nodes. */
export function parseDigits(value: string): number | undefined {
  const cleaned = value.replace(/[^\d]/g, "");
  if (cleaned === "") return undefined;
  return extractInt(cleaned, /(\d+)/);
}

export function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value.trim() !== "") return value;
  }
  return "";
}

export function cleanString(
  value: string | undefined | null,
): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** Decodes the common HTML entities found in upstream feed text. Not a full
 * HTML5 named-character-reference table — covers what real-world titles and
 * summaries from these sources actually use. */
export function unescapeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, body: string) => {
      if (body[0] === "#") {
        const codePoint =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        return Number.isNaN(codePoint)
          ? match
          : String.fromCodePoint(codePoint);
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}
