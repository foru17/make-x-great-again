export const PROVIDER_FAILURE_WINDOW_MS = 30_000;
export const PROVIDER_OPEN_MS = 60_000;
export const PROVIDER_FAILURE_THRESHOLD = 5;
export const PROVIDER_MAX_IN_FLIGHT = 4;
const LEASE_MS = 60_000; // exceeds provider's 45s fetch deadline
interface Lease { expires: number; generation: number; probe: boolean }
export interface CircuitState {
  failures: number; windowStart: number; openUntil: number; generation: number;
  leases: Record<string, Lease>;
}
export interface CircuitStore { get(): CircuitState | undefined; put(value: CircuitState): void }
export type ProviderPermit = { id: string } | { error: "model_circuit_open" | "classifier_busy" };

/** Single provider-wide persistent admission point, not one circuit per user
 * or per batch. No provider network I/O occurs inside this object. */
export class ProviderCircuit {
  constructor(private readonly store: CircuitStore, private readonly now = Date.now) {}
  private read(): CircuitState {
    const state = this.store.get() ?? { failures: 0, windowStart: this.now(), openUntil: 0, generation: 0, leases: {} };
    for (const [id, lease] of Object.entries(state.leases)) if (lease.expires <= this.now()) delete state.leases[id];
    return state;
  }
  begin(): ProviderPermit {
    const state = this.read();
    if (state.openUntil > this.now()) return { error: "model_circuit_open" };
    const probe = state.openUntil > 0;
    if (probe && Object.values(state.leases).some(x => x.probe)) return { error: "model_circuit_open" };
    if (Object.keys(state.leases).length >= PROVIDER_MAX_IN_FLIGHT) return { error: "classifier_busy" };
    const id = crypto.randomUUID();
    state.leases[id] = { expires: this.now() + LEASE_MS, generation: state.generation, probe };
    this.store.put(state);
    return { id };
  }
  finish(id: string, outcome: "success" | "failure" | "cancel"): void {
    const state = this.read();
    const lease = state.leases[id];
    if (!lease) return;
    delete state.leases[id];
    if (lease.generation !== state.generation) { this.store.put(state); return; }
    if (lease.probe) {
      state.generation++;
      state.openUntil = outcome === "success" ? 0 : this.now() + PROVIDER_OPEN_MS;
      state.failures = 0; state.windowStart = this.now();
      console.log(JSON.stringify({ event: "model.circuit", outcome: outcome === "success" ? "closed" : "reopened" }));
    } else if (outcome === "failure") {
      if (this.now() - state.windowStart >= PROVIDER_FAILURE_WINDOW_MS) {
        state.failures = 0; state.windowStart = this.now();
      }
      if (++state.failures >= PROVIDER_FAILURE_THRESHOLD) {
        state.generation++; state.openUntil = this.now() + PROVIDER_OPEN_MS;
        console.log(JSON.stringify({ event: "model.circuit", outcome: "opened", failures: state.failures }));
      }
    }
    this.store.put(state);
  }
}
