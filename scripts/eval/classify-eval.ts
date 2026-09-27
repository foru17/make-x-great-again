// Offline classifier evaluation against docs/eval/cases.json.
//
// Run BEFORE deploying any prompt / threshold change:
//
//   node_modules/.bin/tsx scripts/eval/classify-eval.ts            # dry-run: validates the set, prints counts, no LLM calls
//   EVAL_LIVE=1 LLM_API_BASE=… LLM_API_KEY=… LLM_API_MODEL=… \
//     node_modules/.bin/tsx scripts/eval/classify-eval.ts          # scores every case (hard-capped)
//
// Cost fuse: live runs stop at EVAL_MAX_CALLS (default 60) — the set is
// meant to stay small enough to run on every change. Never points at the
// production Worker: it calls the model directly with the Worker's exact
// prompt, so nothing is written to the accounts table.
//
// Exit code 1 when any case misses its bucket (or the set is malformed).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLASSIFY_SYSTEM_PROMPT,
  type ClassifySignals,
  type ClassifyVerdict,
  classifyForEval,
} from "../../services/edge/src/index";

type Bucket = "clean" | "spam";
interface EvalCase {
  id: string;
  origin: string;
  expect: Bucket;
  reconstructed?: boolean;
  signals: Record<string, unknown>;
}

const SPAM_LABELS = new Set(["spam", "porn_bot", "likely_spam"]);
const bucketOf = (v: ClassifyVerdict): Bucket => (SPAM_LABELS.has(v.label) ? "spam" : "clean");

const file = resolve(process.argv[2] ?? "docs/eval/cases.json");
const set = JSON.parse(readFileSync(file, "utf8")) as { cases: EvalCase[] };

// ---- validate the set shape (cheap, always) ----
const problems: string[] = [];
const ids = new Set<string>();
for (const c of set.cases) {
  if (!c.id || ids.has(c.id)) problems.push(`duplicate or missing id: ${c.id}`);
  ids.add(c.id);
  if (c.expect !== "clean" && c.expect !== "spam") problems.push(`${c.id}: bad expect`);
  const h = c.signals?.handle;
  if (typeof h !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(h)) problems.push(`${c.id}: bad handle`);
  if (!Array.isArray(c.signals?.recentTweets)) problems.push(`${c.id}: recentTweets must be an array`);
}
const byBucket = { clean: 0, spam: 0 };
for (const c of set.cases) byBucket[c.expect] += 1;
const reconstructed = set.cases.filter((c) => c.reconstructed).length;
console.log(
  `eval set: ${set.cases.length} cases (clean=${byBucket.clean}, spam=${byBucket.spam}, reconstructed=${reconstructed}); prompt ${CLASSIFY_SYSTEM_PROMPT.length} chars`,
);
if (problems.length) {
  for (const p of problems) console.error(`✖ ${p}`);
  process.exit(1);
}

if (process.env.EVAL_LIVE !== "1") {
  console.log("dry-run only (set EVAL_LIVE=1 with LLM_API_* to score). ok.");
  process.exit(0);
}

// ---- live scoring ----
const env = {
  LLM_API_BASE: process.env.LLM_API_BASE ?? "",
  LLM_API_KEY: process.env.LLM_API_KEY ?? "",
  LLM_API_MODEL: process.env.LLM_API_MODEL ?? "",
} as never;
if (!process.env.LLM_API_BASE || !process.env.LLM_API_KEY || !process.env.LLM_API_MODEL) {
  console.error("EVAL_LIVE=1 needs LLM_API_BASE, LLM_API_KEY, LLM_API_MODEL");
  process.exit(1);
}
const MAX_CALLS = Math.max(1, Number(process.env.EVAL_MAX_CALLS ?? 60));
const CONCURRENCY = 2;
const queue = set.cases.slice(0, MAX_CALLS);
if (queue.length < set.cases.length) {
  console.warn(`⚠ EVAL_MAX_CALLS=${MAX_CALLS} < ${set.cases.length} cases — scoring the first ${MAX_CALLS} only`);
}

interface Row {
  id: string;
  expect: Bucket;
  got?: Bucket;
  label?: string;
  confidence?: number;
  reasons?: string[];
  error?: string;
}
const rows: Row[] = [];
let next = 0;
async function worker() {
  while (next < queue.length) {
    const c = queue[next++]!;
    const sig = {
      displayName: "",
      bio: "",
      recentTweets: [],
      ...c.signals,
    } as unknown as ClassifySignals;
    try {
      const v = await classifyForEval(env, sig);
      rows.push({ id: c.id, expect: c.expect, got: bucketOf(v), label: v.label, confidence: v.confidence, reasons: v.reasons });
    } catch (err) {
      rows.push({ id: c.id, expect: c.expect, error: (err as Error).message.slice(0, 160) });
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

rows.sort((a, b) => a.id.localeCompare(b.id));
let hit = 0;
const misses: Row[] = [];
const errors: Row[] = [];
for (const r of rows) {
  if (r.error) errors.push(r);
  else if (r.got === r.expect) hit += 1;
  else misses.push(r);
}
const scored = rows.length - errors.length;
const fp = misses.filter((m) => m.expect === "clean").length;
const fn = misses.filter((m) => m.expect === "spam").length;
console.log(`\nscored ${scored}/${rows.length} · accuracy ${scored ? ((hit / scored) * 100).toFixed(1) : "n/a"}% · false positives ${fp} · misses ${fn} · errors ${errors.length}`);
for (const m of misses) {
  console.log(`✖ ${m.id}: expected ${m.expect}, got ${m.label} ${m.confidence?.toFixed(2)} — ${(m.reasons ?? []).join(" | ").slice(0, 200)}`);
}
for (const e of errors) console.log(`! ${e.id}: ${e.error}`);
process.exit(misses.length ? 1 : 0);
