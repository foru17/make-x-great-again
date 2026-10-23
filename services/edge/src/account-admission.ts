import type { FlightResult, FlightStore } from "./classification-flight";

export const ACCOUNT_FAILURE_COOLDOWN_MS = 60_000;
/** A separate identity gate: changing tweet/context cannot bypass a failure.
 * Successful verdicts remain evidence-specific in the normal flight cache. */
export class AccountAdmission {
  private readonly active = new Set<string>();
  constructor(private readonly store: FlightStore, private readonly now = Date.now) {}

  async run<T>(key: string, execute: () => Promise<FlightResult<T>>): Promise<FlightResult<T>> {
    if (this.active.has(key)) return { error: "classifier_busy" };
    this.store.prune(this.now());
    const previous = this.store.get(key);
    if (previous) return previous.state === "running"
      ? { error: "model_outcome_unknown" } : JSON.parse(previous.result!) as FlightResult<T>;
    if (this.store.count() >= 1000) return { error: "classifier_busy" };
    this.store.insert(key, Number.MAX_SAFE_INTEGER);
    this.active.add(key);
    try {
      const result = await execute().catch((): FlightResult<T> => ({ error: "model_outcome_unknown" }));
      const error = "error" in result ? result.error : null;
      const cooldown = error === "model_outcome_unknown" ? Number.MAX_SAFE_INTEGER
        : this.now() + (error?.startsWith("model_") ? ACCOUNT_FAILURE_COOLDOWN_MS : 0);
      this.store.finish(key, JSON.stringify(error ? { error } : {}), cooldown);
      return result;
    } finally { this.active.delete(key); }
  }
}
