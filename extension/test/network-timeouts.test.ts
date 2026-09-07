import assert from "node:assert/strict";
import test from "node:test";
import { flushRuleHits, RULE_HITS_STORE_KEY } from "../lib/rule-telemetry";
import { postOnlineClassification } from "../lib/online-detection";
import { LIST_KEY, syncList } from "../lib/list-sync";

test("network deadlines preserve telemetry and release the list-sync lock after a timeout", async (t) => {
  const oldChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const oldFetch = globalThis.fetch;
  const bag: Record<string, unknown> = {
    "xss:settings": { edgeBase: "https://fixture.invalid", ruleTelemetry: true },
    [RULE_HITS_STORE_KEY]: { queue: [{p:"fixture",h:"fixture",u:"",c:"other",ts:1}], sent:{} },
    [LIST_KEY]: {version:"fixture",entries:[],count:0,fetchedAt:1},
  };
  Object.defineProperty(globalThis,"chrome",{configurable:true,value:{storage:{local:{
    get: async(k:string)=>({[k]:bag[k]}), set: async(values:object)=>Object.assign(bag,values),
  }}}});
  const timeouts: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    timeouts.push(ms);
    return AbortSignal.abort(new DOMException("fixture timeout", "TimeoutError"));
  });
  globalThis.fetch = async (_url, init) => {
    assert.ok(init?.signal, "every request must have a deadline");
    init.signal.throwIfAborted();
    return Response.json({});
  };
  try {
    await flushRuleHits();
    assert.equal((bag[RULE_HITS_STORE_KEY] as {queue:unknown[]}).queue.length,1);
    assert.equal((await syncList()).updated,false);
    await assert.rejects(()=>postOnlineClassification({base:"https://fixture.invalid",token:"fixture",sig:{isProfile:false,handle:"fixture",displayName:"",bio:"",recentTweets:[],hasDefaultAvatar:false}}),/fixture timeout/);
    assert.deepEqual(timeouts,[15000,30000,30000,120000]);
    globalThis.fetch=async url=>Response.json(String(url).includes("whitelist") ? {list:[],count:0} : {version:"fixture",artifacts:{lite:"/v1/artifacts/fixture.json"}});
    await flushRuleHits();
    assert.equal((bag[RULE_HITS_STORE_KEY] as {queue:unknown[]}).queue.length,0);
    assert.equal((await syncList()).error,undefined,"a failed sync must not lock out subsequent attempts");
  } finally {
    globalThis.fetch=oldFetch;
    if(oldChrome)Object.defineProperty(globalThis,"chrome",oldChrome);else Reflect.deleteProperty(globalThis,"chrome");
  }
});
