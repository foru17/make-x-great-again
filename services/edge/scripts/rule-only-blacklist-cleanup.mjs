import { createHash } from "node:crypto";

const PAGE_LIMIT = 1_000;
const MAX_PAGES = 300;
const CONFIRM_FLAG = "--confirm-remove-non-rule-blacklist";
const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes(CONFIRM_FLAG);
const baseUrl = (process.env.EDGE_BASE_URL || "https://x.zuoluo.tv").replace(/\/$/, "");
const adminToken = process.env.ADMIN_TOKEN;
const cleanupId = process.env.CLEANUP_ID || "rule-only-2026-09-01";

if (!adminToken) throw new Error("ADMIN_TOKEN is required");
if (apply && !confirmed) {
  throw new Error(`--apply also requires ${CONFIRM_FLAG}`);
}

async function cleanupPage(body) {
  const response = await fetch(`${baseUrl}/v1/admin/rule-only-blacklist-cleanup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { raw: raw.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(`cleanup endpoint returned ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

const startedAt = new Date().toISOString();
let cursor = 0;
let calls = 0;
let pages = 0;
let scanned = 0;
let retained = 0;
let removable = 0;
let processed = 0;
let ruleFingerprint = null;
const retainedByRule = {};
const planDigest = createHash("sha256");
const retainedSamples = [];
const removableSamples = [];
let finished = false;

for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
  pages = pageIndex + 1;
  const preview = await cleanupPage({ dryRun: true, cursor, limit: PAGE_LIMIT });
  calls++;
  if (preview.dryRun !== true || preview.cursor !== cursor) {
    throw new Error(`invalid dry-run response at cursor ${cursor}`);
  }
  if (ruleFingerprint === null) ruleFingerprint = preview.ruleFingerprint;
  if (preview.ruleFingerprint !== ruleFingerprint) {
    throw new Error(`rule fingerprint changed during scan at cursor ${cursor}`);
  }
  planDigest.update(`${preview.cursor}:${preview.planHash}\n`);
  scanned += preview.scanned;
  retained += preview.retained;
  removable += preview.removable;
  for (const [ruleId, count] of Object.entries(preview.retainedByRule || {})) {
    retainedByRule[ruleId] = (retainedByRule[ruleId] || 0) + Number(count);
  }
  for (const sample of preview.samples?.retained || []) {
    if (retainedSamples.length < 20) retainedSamples.push(sample);
  }
  for (const sample of preview.samples?.removable || []) {
    if (removableSamples.length < 20) removableSamples.push(sample);
  }

  let pageResult = preview;
  if (apply) {
    pageResult = await cleanupPage({
      dryRun: false,
      cursor,
      limit: PAGE_LIMIT,
      cleanupId,
      expectedRuleFingerprint: preview.ruleFingerprint,
      expectedPlanHash: preview.planHash,
      confirm: "REMOVE_NON_RULE_BLACKLIST",
    });
    calls++;
    if (
      pageResult.planHash !== preview.planHash ||
      pageResult.scanned !== preview.scanned ||
      pageResult.removable !== preview.removable ||
      pageResult.processed !== preview.removable ||
      pageResult.skipped !== 0 ||
      pageResult.ok !== true
    ) {
      throw new Error(`write verification failed at cursor ${cursor}: ${JSON.stringify(pageResult)}`);
    }
    processed += pageResult.processed;
  }

  if (preview.done) {
    cursor = preview.nextCursor ?? cursor;
    finished = true;
    break;
  }
  if (!Number.isInteger(pageResult.nextCursor) || pageResult.nextCursor <= cursor) {
    throw new Error(`non-advancing cursor at ${cursor}`);
  }
  cursor = pageResult.nextCursor;
}

if (!finished) {
  throw new Error(`hard page limit ${MAX_PAGES} reached before the scan finished`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: apply ? "apply" : "dry-run",
      cleanupId: apply ? cleanupId : null,
      startedAt,
      finishedAt: new Date().toISOString(),
      pageLimit: PAGE_LIMIT,
      maxPages: MAX_PAGES,
      maxCalls: apply ? MAX_PAGES * 2 : MAX_PAGES,
      pages,
      calls,
      scanned,
      retained,
      removable,
      processed,
      lastCursor: cursor,
      ruleFingerprint,
      aggregatePlanHash: planDigest.digest("hex"),
      retainedByRule,
      samples: { retained: retainedSamples, removable: removableSamples },
    },
    null,
    2,
  ),
);
