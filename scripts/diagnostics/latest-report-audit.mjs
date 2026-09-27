// Read-only production audit. Eight fixed SELECTs, no retries, no credentials in output.
// Run from the repository root: node scripts/diagnostics/latest-report-audit.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const edgeDir = fileURLToPath(new URL("../../services/edge/", import.meta.url));
const anchor = Date.now();
const day = 86400000;
let calls = 0;
const requestCap = 8;
function query(name, sql) {
  assert.match(sql.trim(), /^(SELECT|WITH)\b/);
  assert.ok(++calls <= requestCap, "read request cap");
  const data = JSON.parse(execFileSync("./node_modules/.bin/wrangler", [
    "d1", "execute", "xss-db", "--remote", "--json", "--command", sql,
  ], { cwd: edgeDir, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 }));
  assert.equal(data.length, 1);
  assert.equal(data[0].success, true);
  assert.equal(data[0].meta.rows_written, 0);
  console.log(JSON.stringify({ query: name, rowsRead: data[0].meta.rows_read, rowsWritten: 0 }));
  return data[0].results;
}

console.log(JSON.stringify({ anchor: new Date(anchor).toISOString(), windowStart: new Date(anchor-day).toISOString(), requestCap }));
console.log(JSON.stringify({ snapshot: query("snapshot", `SELECT status,count(*) n,count(DISTINCT lower(handle)) handles FROM accounts GROUP BY status ORDER BY status`) }));
console.log(JSON.stringify({ changed24h: query("changed24h", `SELECT status,source,verdict_label,count(*) n,sum(first_seen>=${anchor-day}) firstSeen24h FROM accounts WHERE last_scored>=${anchor-day} AND last_scored<${anchor} GROUP BY status,source,verdict_label ORDER BY status,source,verdict_label`) }));
console.log(JSON.stringify({ queue: query("queue", `SELECT source,verdict_label,count(*) n,sum(last_scored>=${anchor-day} AND last_scored<${anchor}) scored24h,sum(followers_count IS NULL) missingFollowers,sum(account_created_at IS NULL AND account_age_days IS NULL) missingAge FROM accounts WHERE status='auto_pending_review' GROUP BY source,verdict_label ORDER BY source,verdict_label`) }));
console.log(JSON.stringify({ reports: query("reports", `SELECT '1h' window,count(*) n,count(DISTINCT lower(handle)) handles,count(DISTINCT reporter_fp) reporters FROM reports WHERE created_at>=${anchor-3600000} AND created_at<${anchor} UNION ALL SELECT '24h',count(*),count(DISTINCT lower(handle)),count(DISTINCT reporter_fp) FROM reports WHERE created_at>=${anchor-day} AND created_at<${anchor} UNION ALL SELECT '72h',count(*),count(DISTINCT lower(handle)),count(DISTINCT reporter_fp) FROM reports WHERE created_at>=${anchor-3*day} AND created_at<${anchor}`) }));
console.log(JSON.stringify({ publications24h: query("publications24h", `SELECT action,actor,count(*) n FROM review_log WHERE at>=${anchor-day} AND at<${anchor} AND (action LIKE '%blacklist%' OR action='auto_promote') GROUP BY action,actor ORDER BY n DESC LIMIT 100`) }));

const sample = query("latest1000Pending", `SELECT handle,verdict_label,confidence,source,reasons,evidence_text,last_scored,followers_count,following_count,account_created_at,account_age_days FROM accounts WHERE status='auto_pending_review' AND last_scored>=${anchor-day} AND last_scored<${anchor} ORDER BY last_scored DESC,lower(handle) LIMIT 1000`);
const distribution = {};
for (const row of sample) distribution[row.verdict_label] = (distribution[row.verdict_label] ?? 0) + 1;
console.log(JSON.stringify({ latest1000Pending: { n: sample.length, from: new Date(sample.at(-1)?.last_scored ?? anchor).toISOString(), to: new Date(sample[0]?.last_scored ?? anchor).toISOString(), distribution, sources: [...new Set(sample.map(x=>x.source))], missingFollowers: sample.filter(x=>x.followers_count===null).length, missingAge: sample.filter(x=>x.account_age_days===null && x.account_created_at===null).length, missingEvidence: sample.filter(x=>!x.evidence_text).length } }));

// These are deliberately consecutive samples, not a random population estimate.
console.log(JSON.stringify({ newest50SpamLabeled: query("newest50SpamLabeled", `SELECT handle,verdict_label,confidence,source,reasons,evidence_text,last_scored,followers_count,following_count FROM accounts WHERE status='auto_pending_review' AND verdict_label IN ('spam','porn_bot','likely_spam') AND last_scored>=${anchor-day} AND last_scored<${anchor} ORDER BY last_scored DESC,lower(handle) LIMIT 50`) }));
console.log(JSON.stringify({ latest20Reports: query("latest20Reports", `WITH recent AS (SELECT handle,x_user_id,created_at,evidence FROM reports WHERE created_at>=${anchor-day} AND created_at<${anchor} ORDER BY created_at DESC LIMIT 20) SELECT r.handle,r.created_at,r.evidence,a.status,a.verdict_label,a.source,a.reasons,a.evidence_text FROM recent r LEFT JOIN accounts a ON a.rowid=(SELECT a2.rowid FROM accounts a2 WHERE (r.x_user_id IS NOT NULL AND a2.x_user_id=r.x_user_id) OR (lower(a2.handle)=lower(r.handle) AND (r.x_user_id IS NULL OR a2.x_user_id IS NULL)) ORDER BY CASE WHEN r.x_user_id IS NOT NULL AND a2.x_user_id=r.x_user_id THEN 0 ELSE 1 END,a2.last_scored DESC LIMIT 1) ORDER BY r.created_at DESC`) }));
console.log(JSON.stringify({ requests: calls, requestCap, completed: true }));
