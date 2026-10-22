import { DurableObject } from "cloudflare:workers";
import { ClassificationFlight, type FlightStore, type FlightResult } from "./classification-flight";
import { ModelCallError } from "./model-usage";
import { ClassificationBatch } from "./classification-batch";
import { classifyBatch, classifyForEval, reserveModelQuota, recordContribActive, type ClassifierBindings, type ClassifySignals, type ClassifyVerdict } from "./index";

export interface ClassificationJob {
  key: string;
  signals: ClassifySignals;
  rateFp: string;
  kind: "classify" | "classify_anon";
}

export class ClassificationCoordinator extends DurableObject<ClassifierBindings> {
  private readonly flight: ClassificationFlight<ClassifyVerdict>;
  private readonly batch: ClassificationBatch<{ id: string; signals: ClassifySignals }, ClassifyVerdict>;
  constructor(ctx: DurableObjectState, env: ClassifierBindings) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS flights (
      key TEXT PRIMARY KEY, state TEXT NOT NULL, result TEXT, expires INTEGER NOT NULL
    )`);
    const store: FlightStore = {
      get: key => sql.exec<{ state: string; result: string | null; expires: number }>("SELECT state,result,expires FROM flights WHERE key=?", key).toArray()[0],
      insert: (key, expires) => { sql.exec("INSERT INTO flights VALUES (?,'running',NULL,?)", key, expires); },
      finish: (key, result, expires) => { sql.exec("UPDATE flights SET state='done',result=?,expires=? WHERE key=?", result, expires, key); },
      prune: now => { sql.exec("DELETE FROM flights WHERE key IN (SELECT key FROM flights WHERE expires<=? LIMIT 1000)", now); },
      count: () => sql.exec<{ n: number }>("SELECT COUNT(*) n FROM flights").one().n,
    };
    this.flight = new ClassificationFlight(store);
    this.batch = new ClassificationBatch(items => classifyBatch(this.env, items));
  }

  async classify(job: ClassificationJob): Promise<FlightResult<ClassifyVerdict>> {
    return this.flight.run(job.key, async () => {
      const error = await reserveModelQuota(this.env, job.rateFp, Date.now());
      if (error) return { error };
      await recordContribActive(this.env, job.kind, job.rateFp, Date.now());
      try {
        if (this.env.AI_BATCH_ENABLED === "1") return await this.batch.add({ id: crypto.randomUUID(), signals: job.signals });
        return { value: await classifyForEval(this.env, job.signals) };
      }
      catch (error) { return { error: error instanceof ModelCallError ? error.code : "model_response_invalid" }; }
    });
  }
}
