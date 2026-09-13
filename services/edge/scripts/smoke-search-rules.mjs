// Run after `wrangler deploy --dry-run --outdir <bundle-dir>`.
// Uses a private local workerd/D1 database; never reaches production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as runtime from 'miniflare';

const bundle = process.argv[2];
assert.ok(bundle, 'pass the dry-run worker.js path');
const options = {
  modules: true, scriptPath: resolve(bundle),
  compatibilityDate: '2026-05-01', compatibilityFlags: ['nodejs_compat'],
  d1Databases: {DB:'search-rule-fixture'}, r2Buckets:['ARTIFACTS'],
  bindings: {ADMIN_TOKEN:'fixture', AI_AUTO_PUBLISH_ENABLED:'0'},
};
const mf = new runtime.Miniflare(runtime.convertV4MiniflareOptions?.(options) ?? options);
let requests = 0;
async function request(path, body) {
  assert.ok(++requests <= 40, 'hard HTTP request cap');
  const response = await mf.dispatchFetch(`http://fixture.test${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {'x-admin-token':'fixture','content-type':'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
try {
  const db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  const statements = schema.replace(/--[^\n]*/g, '').split(';').filter(s=>s.trim());
  assert.ok(statements.length < 100, 'hard schema statement cap');
  await db.batch(statements.map(s=>db.prepare(s)));
  const characters = '\u00ad\u034f\u061c\u180e\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\ufeff';
  const variants = ['我福不黑', ...Array.from(characters, c => `我${c}福${c}不${c}黑`)];
  await db.batch(variants.map((text,i)=>db.prepare(`INSERT INTO accounts
    (handle,display_name,evidence_text,verdict_label,confidence,status,first_seen,last_scored)
    VALUES (?,?,?,'spam',1,'auto_pending_review',1,1)`).bind(`fixture_${i}`,text,text)));
  for (const q of ['我福不黑','我\u2060福\u200c不\u200d黑']) {
    const result = await request(`/v1/admin/queue?${new URLSearchParams({q,total:'1',limit:'200'})}`);
    assert.equal(result.total, variants.length);
    assert.equal(result.queue.length, variants.length);
  }
  const preview = await request('/v1/admin/keyword-rules/preview', {pattern:'我福不黑',field:'display_name'});
  assert.equal(preview.count, variants.length);
  await request('/v1/admin/keyword-rules', {pattern:'我福不黑',field:'display_name',action:'reject',verdict_label:'spam'});
  const sweep = await request('/v1/admin/keyword-rules/apply-to-queue', {});
  assert.equal(sweep.matched, variants.length);
  assert.equal((await request('/v1/admin/queue?total=1')).total, 0);
  console.log(JSON.stringify({passed:true,runtime:'workerd/D1',variants:variants.length,requests,search:variants.length,preview:preview.count,sweep:sweep.matched}));
} finally {
  await mf.dispose();
}
