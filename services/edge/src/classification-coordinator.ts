import { DurableObject } from "cloudflare:workers";
import { ClassificationFlight, type FlightStore, type FlightResult } from "./classification-flight";
import { ProviderCircuit, type CircuitState } from "./provider-circuit";
import { AccountAdmission } from "./account-admission";
import { classificationKey } from "./classification-flight";
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
  private readonly circuit: ProviderCircuit;
  private readonly accounts: AccountAdmission;
  private readonly flight: ClassificationFlight<ClassifyVerdict>;
  private readonly batch: ClassificationBatch<{ id: string; signals: ClassifySignals }, ClassifyVerdict>;
  constructor(ctx: DurableObjectState, env: ClassifierBindings) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS provider_circuit (id INTEGER PRIMARY KEY, state TEXT NOT NULL)");
    this.circuit = new ProviderCircuit({
      get: () => {
        const row = sql.exec<{ state: string }>("SELECT state FROM provider_circuit WHERE id=1").toArray()[0];
        return row ? JSON.parse(row.state) as CircuitState : undefined;
      },
      put: state => { sql.exec("INSERT INTO provider_circuit VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state", JSON.stringify(state)); },
    });
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
    sql.exec(`CREATE TABLE IF NOT EXISTS account_admission (
      key TEXT PRIMARY KEY, state TEXT NOT NULL, result TEXT, expires INTEGER NOT NULL
    )`);
    this.accounts = new AccountAdmission({
      get: key => sql.exec<{ state: string; result: string | null; expires: number }>("SELECT state,result,expires FROM account_admission WHERE key=?", key).toArray()[0],
      insert: (key, expires) => { sql.exec("INSERT INTO account_admission VALUES (?,'running',NULL,?)", key, expires); },
      finish: (key, result, expires) => { sql.exec("UPDATE account_admission SET state='done',result=?,expires=? WHERE key=?", result, expires, key); },
      prune: now => { sql.exec("DELETE FROM account_admission WHERE key IN (SELECT key FROM account_admission WHERE expires<=? LIMIT 1000)", now); },
      count: () => sql.exec<{ n: number }>("SELECT COUNT(*) n FROM account_admission").one().n,
    });
    this.batch = new ClassificationBatch(items => classifyBatch(this.env, items));
  }

  enqueueBatch(item: { id: string; signals: ClassifySignals }) { return this.batch.add(item); }

  beginProvider() { return this.circuit.begin(); }
  finishProvider(id: string, outcome: "success" | "failure" | "cancel") { this.circuit.finish(id, outcome); }

  async classify(job: ClassificationJob): Promise<FlightResult<ClassifyVerdict>> {
    const accountKey = await classificationKey([job.signals.userId ?? job.signals.handle]);
    return this.flight.run(job.key, () => this.accounts.run<ClassifyVerdict>(accountKey, async () => {
      const error = await reserveModelQuota(this.env, job.rateFp, Date.now());
      if (error) return { error };
      await recordContribActive(this.env, job.kind, job.rateFp, Date.now());
      try {
        if (this.env.AI_BATCH_ENABLED === "1") {
          // Account shards retain deduplication and failure intent. A shared
          // queue avoids fragmenting a low-rate arrival stream into four tails.
          const result = await this.env.CLASSIFIER.getByName("batch-v2").enqueueBatch({ id: crypto.randomUUID(), signals: job.signals });
          if ("value" in result && result.value !== undefined) return { value: result.value };
          return { error: "error" in result && result.error ? result.error : "model_outcome_unknown" };
        }
        return { value: await classifyForEval(this.env, job.signals) };
      }
      catch (error) { return { error: error instanceof ModelCallError ? error.code : "model_response_invalid" }; }
    }));
  }
}
