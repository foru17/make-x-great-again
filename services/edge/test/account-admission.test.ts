import assert from "node:assert/strict";
import test from "node:test";
import { AccountAdmission } from "../src/account-admission";
import type { FlightStore } from "../src/classification-flight";
function fixture() {
  const rows = new Map<string, {state:string;result:string|null;expires:number}>();
  const store: FlightStore = {
    get: k => rows.get(k), insert: (k,expires) => { rows.set(k,{state:"running",result:null,expires}); },
    finish: (k,result,expires) => { rows.set(k,{state:"done",result,expires}); },
    prune: now => { for(const [k,v] of rows) if(v.expires<=now) rows.delete(k); }, count: () => rows.size,
  };
  return store;
}
test("failure cooldown survives restart; success releases identity, unknown never auto-resubmits", async () => {
  let now=0,calls=0;
  const db=fixture();
  const fail=async () => { assert.ok(++calls<=3); return {error:"model_http_error"}; };
  const first=new AccountAdmission(db,()=>now);
  assert.deepEqual(await first.run("account",fail),{error:"model_http_error"});
  now=59_999;
  assert.deepEqual(await new AccountAdmission(db,()=>now).run("account",fail),{error:"model_http_error"});
  assert.equal(calls,1);
  now=60_000;
  await first.run("account",async()=>({value:42}));
  await first.run("account",fail);
  assert.equal(calls,2,"success must not reuse a verdict across different evidence");
  await first.run("unknown",async()=>({error:"model_outcome_unknown"}));
  now+=86400000;
  assert.deepEqual(await new AccountAdmission(db,()=>now).run("unknown",fail),{error:"model_outcome_unknown"});
  assert.equal(calls,2);
});
test("concurrent changed evidence cannot submit a second operation; restart retains intent", async () => {
  const db=fixture(); const gate=Promise.withResolvers<void>();
  const guard=new AccountAdmission(db,()=>0);
  let calls=0;
  const first=guard.run("same-account",async()=>{calls++;await gate.promise;return {value:1};});
  assert.deepEqual(await guard.run("same-account",async()=>{calls++;return {value:2};}),{error:"classifier_busy"});
  assert.deepEqual(await new AccountAdmission(db,()=>0).run("same-account",async()=>{calls++;return {value:2};}),{error:"model_outcome_unknown"});
  gate.resolve(); await first; assert.equal(calls,1);
});
