// Port of internal/sources/util.go.

const RETRY_DELAYS_MS = [250, 750];
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  readonly statusCode: number;
  readonly body: string;

  constructor(statusCode: number, body: string) {
    super(body ? `unexpected status ${statusCode}: ${body}` : `unexpected status ${statusCode}`);
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

/** Mirrors getWithRetry: up to 2 retries (250ms, 750ms backoff) on 408/425/429/5xx. */
export async function getWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  const attempts = RETRY_DELAYS_MS.length + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === attempts) {
        return response;
      }
      await response.body?.cancel();
    } catch (error) {
      if (init.signal?.aborted || attempt === attempts) throw error;
      lastError = error;
    }
    await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 0, init.signal ?? undefined);
  }
  throw lastError ?? new Error(`upstream retry loop exhausted for ${url}`);
}

export async function readLimitedText(response: Response, limit: number): Promise<string> {
  const text = await response.text();
  return text.slice(0, limit);
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

export function cleanString(value: string | undefined | null): string | undefined {
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
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}
