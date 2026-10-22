import type { FlightResult } from "./classification-flight";

export const CLASSIFY_BATCH_SIZE = 10;
export const CLASSIFY_BATCH_WAIT_MS = 2000;
interface BatchClock {
  set(callback: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}
const clock: BatchClock = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** Only unique admitted jobs enter this bounded micro-batcher. The deadline
 * starts with the FIRST item, never slides, and includes no provider latency. */
export class ClassificationBatch<Input, Output> {
  private queue: Array<{ input: Input; resolve: (result: FlightResult<Output>) => void }> = [];
  private timer: unknown;
  private active = 0;
  constructor(
    private readonly process: (items: Input[]) => Promise<FlightResult<Output>[]>,
    private readonly scheduler: BatchClock = clock,
  ) {}

  add(input: Input): Promise<FlightResult<Output>> {
    if (this.active >= 4) return Promise.resolve({ error: "classifier_busy" });
    return new Promise(resolve => {
      this.queue.push({ input, resolve });
      if (this.queue.length === 1) this.timer = this.scheduler.set(() => this.flush(), CLASSIFY_BATCH_WAIT_MS);
      if (this.queue.length >= CLASSIFY_BATCH_SIZE) this.flush();
    });
  }

  private flush(): void {
    if (!this.queue.length) return;
    this.scheduler.clear(this.timer);
    const entries = this.queue;
    this.queue = [];
    if (this.active >= 4) {
      for (const item of entries) item.resolve({ error: "classifier_busy" });
      return;
    }
    this.active++;
    void this.process(entries.map(x => x.input)).then(results => {
      for (const [i,item] of entries.entries()) item.resolve(results[i] ?? { error: "model_response_invalid" });
    }, () => {
      for (const item of entries) item.resolve({ error: "model_outcome_unknown" });
    }).finally(() => { this.active--; });
  }
}
