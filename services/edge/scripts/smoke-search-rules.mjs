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
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../migrations/2026-05-27-agent-pipeline.sql', import.meta.url),'utf8');
  const statements = schema.replace(/--[^\n]*/g, '').split(';').filter(s=>s.trim());
  assert.ok(statements.length < 100, 'hard schema statement cap');
  await db.batch(statements.map(s=>db.prepare(s)));
  const characters = '\u00ad\u034f\u061c\u180e\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\ufeff';
  const variants = ['我福不黑', ...Array.from(characters, c => `我${c}福${c}不${c}黑`)];
  const states=['auto_pending_review','agent_pending','agent_blacklist','agent_whitelist'];
  const records=Array.from({length:301},(_,i)=>({handle:`fixture_${i}`,text:variants[i%variants.length],status:states[i%4],followers:10}));
  records.push({handle:'protected',text:variants[0],status:'agent_pending',followers:100000});
  for (const status of ['human_confirmed','whitelisted','rejected','removed']) records.push({handle:status,text:variants[0],status,followers:10});
  for(let i=0;i<records.length;i+=90) await db.batch(records.slice(i,i+90).map(r=>db.prepare(`INSERT INTO accounts
    (handle,display_name,evidence_text,verdict_label,confidence,status,first_seen,last_scored,followers_count)
    VALUES (?,?,?,'spam',1,?,1,1,?)`).bind(r.handle,r.text,r.text,r.status,r.followers)));
  for (const q of ['我福不黑','我\u2060福\u200c不\u200d黑']) {
    const result = await request(`/v1/admin/queue?${new URLSearchParams({q,total:'1',limit:'200'})}`);
    assert.equal(result.total,302);
    assert.equal(result.queue.length,200);
  }
  const preview = await request('/v1/admin/keyword-rules/preview', {pattern:'我福不黑',field:'display_name'});
  assert.equal(preview.count,302);
  await request('/v1/admin/keyword-rules', {pattern:'我福不黑',field:'display_name',action:'blacklist',verdict_label:'spam'});
  async function scan(dryRun){
    let cursor;let matches=0;let protectedCount=0;let complete=false;
    for(let i=0;i<10;i++){
      const result=await request('/v1/admin/keyword-rules/apply-to-queue',{dryRun,cursor});
      matches+=dryRun?result.wouldApply:result.matched;protectedCount+=result.skippedProtected;
      if(result.complete){complete=true;break;}
      assert.ok(result.nextCursor);cursor=result.nextCursor;
    }
    assert.ok(complete);assert.equal(matches,301);assert.equal(protectedCount,1);
    return matches;
  }
  await scan(true);
  assert.equal((await db.prepare('SELECT count(*) n FROM review_log').first()).n,0);
  const matched=await scan(false);
  assert.equal((await db.prepare('SELECT count(*) n FROM review_log').first()).n,301);
  assert.equal((await db.prepare('SELECT hit_count FROM keyword_rules').first()).hit_count,301);
  assert.equal((await request('/v1/admin/queue?total=1')).total,1);
  console.log(JSON.stringify({passed:true,runtime:'workerd/D1',variants:variants.length,states:4,requests,search:302,preview:preview.count,sweep:matched,protected:1,terminalUnchanged:4}));
} finally {
  await mf.dispose();
}
