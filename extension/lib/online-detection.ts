import { type Cached, cacheSet, signalsHash } from "./cache";
import type { BgRequest, BgResponse, Signals, Verdict } from "./types";

/** A route can surface hundreds of virtualized rows. Keep the client-side
 * cost boundary explicit even though the edge also enforces an hourly cap. */
export const MAX_AUTO_CLASSIFICATIONS_PER_PAGE = 40;

/** Small FIFO limiter so a timeline full of unknown authors cannot turn the
 * page scan into a burst of simultaneous edge/LLM requests. */
export class OnlineClassificationLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit = 3) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    // A released slot is handed directly to this waiter. `active` stays at
    // the limit so a newly arriving task cannot overtake the FIFO queue.
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

export function shouldAutoClassify(input: {
  authenticated: boolean;
  localResult: "known" | "unknown";
  requestsStarted: number;
}): boolean {
  return (
    input.authenticated &&
    input.localResult === "unknown" &&
    input.requestsStarted < MAX_AUTO_CLASSIFICATIONS_PER_PAGE
  );
}

interface ClassificationBody {
  cached?: boolean;
  record?: {
    verdict?: unknown;
    model?: unknown;
    status?: unknown;
  };
}

export type OnlineDetectionResult =
  | { status: "classified"; verdict: Verdict; cached: boolean; reviewStatus?: string }
  | { status: "unauthenticated" }
  | { status: "failed"; httpStatus?: number };

interface ClassifyDeps {
  send?: (message: BgRequest) => Promise<BgResponse>;
  writeCache?: (key: string, entry: Cached) => Promise<void>;
  now?: () => number;
}

const LABELS = new Set<Verdict["label"]>([
  "spam",
  "porn_bot",
  "likely_spam",
  "uncertain",
  "legit",
]);

function asVerdict(value: unknown): Verdict | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Verdict>;
  if (!v.label || !LABELS.has(v.label)) return null;
  if (typeof v.confidence !== "number" || !Number.isFinite(v.confidence)) return null;
  if (!Array.isArray(v.reasons) || !v.reasons.every((reason) => typeof reason === "string")) {
    return null;
  }
  return { label: v.label, confidence: v.confidence, reasons: v.reasons };
}

/** Content-script seam: submit exactly one classification request, validate
 * the edge response, then persist an account-level verdict for future pages. */
export async function classifyAndCache(
  key: string,
  sig: Signals,
  deps: ClassifyDeps = {},
): Promise<OnlineDetectionResult> {
  const send =
    deps.send ??
    ((message: BgRequest) => chrome.runtime.sendMessage(message) as Promise<BgResponse>);
  const writeCache = deps.writeCache ?? cacheSet;
  const now = deps.now ?? Date.now;

  let response: BgResponse;
  try {
    response = await send({ type: "classify", sig });
  } catch {
    return { status: "failed" };
  }
  if (!response.ok) {
    return response.error === "no_token"
      ? { status: "unauthenticated" }
      : { status: "failed" };
  }

  const data = response.data as { status?: unknown; body?: ClassificationBody } | undefined;
  const httpStatus = typeof data?.status === "number" ? data.status : 0;
  if (httpStatus === 401) return { status: "unauthenticated" };
  if (httpStatus < 200 || httpStatus >= 300) return { status: "failed", httpStatus };

  const verdict = asVerdict(data?.body?.record?.verdict);
  if (!verdict) return { status: "failed", httpStatus };
  const reviewStatus =
    typeof data?.body?.record?.status === "string" ? data.body.record.status : undefined;
  const model =
    typeof data?.body?.record?.model === "string" ? data.body.record.model : "edge";
  await writeCache(key, {
    verdict,
    signalsHash: signalsHash(sig),
    model,
    ts: now(),
    handle: sig.handle,
    displayName: sig.displayName,
    ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
  });
  return {
    status: "classified",
    verdict,
    cached: data?.body?.cached === true,
    ...(reviewStatus ? { reviewStatus } : {}),
  };
}

/** Background seam: keep the GitHub token out of the content script and post
 * the rendered public account signals from the extension origin. */
export async function postOnlineClassification(input: {
  base: string;
  token: string | null;
  sig: Signals;
  fetcher?: typeof fetch;
}): Promise<BgResponse> {
  if (!input.token) return { ok: false, error: "no_token" };
  const fetcher = input.fetcher ?? fetch;
  const base = input.base.replace(/\/+$/, "");
  const response = await fetcher(`${base}/v1/classify`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input.sig),
  });
  let body: unknown = {};
  try {
    body = await response.json();
  } catch {
    /* non-JSON error page */
  }
  return { ok: true, data: { status: response.status, body } };
}
