/** Persistent single-flight state. Only waiters live in memory; a restarted
 * owner never automatically re-submits a provider operation left running. */
export type FlightResult<T> = { value: T } | { error: string };
export interface FlightStore {
  get(key: string): { state: string; result: string | null; expires: number } | undefined;
  insert(key: string, expires: number): void;
  finish(key: string, result: string, expires: number): void;
  prune(now: number): void;
  count(): number;
}

export class ClassificationFlight<T> {
  private readonly pending = new Map<string, { promise: Promise<FlightResult<T>>; waiters: number }>();
  constructor(private readonly store: FlightStore, private readonly now = Date.now) {}

  async run(key: string, execute: () => Promise<FlightResult<T>>): Promise<FlightResult<T>> {
    const existing = this.pending.get(key);
    if (existing) {
      if (existing.waiters >= 100) return { error: "classifier_busy" };
      existing.waiters++;
      try { return await existing.promise; } finally { existing.waiters--; }
    }
    this.store.prune(this.now());
    const saved = this.store.get(key);
    if (saved?.state === "done" && saved.result) return JSON.parse(saved.result) as FlightResult<T>;
    if (saved) return { error: "model_outcome_unknown" };
    if (this.store.count() >= 1000 || this.pending.size >= 100) return { error: "classifier_busy" };
    // Synchronous durable insertion MUST precede provider I/O and waiter setup.
    this.store.insert(key, Number.MAX_SAFE_INTEGER);
    const promise = Promise.resolve().then(execute).catch((): FlightResult<T> => ({ error: "model_outcome_unknown" }))
      .then((result) => {
        const expires = "error" in result && result.error === "model_outcome_unknown"
          ? Number.MAX_SAFE_INTEGER : this.now() + ("value" in result ? 60_000 : 1000);
        this.store.finish(key, JSON.stringify(result), expires);
        return result;
      });
    this.pending.set(key, { promise, waiters: 1 });
    try { return await promise; } finally { this.pending.delete(key); }
  }
}

export async function classificationKey(parts: string[]): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, "0")).join("");
}
