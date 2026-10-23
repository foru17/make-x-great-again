import assert from "node:assert/strict";
import test from "node:test";
import { ProviderCircuit, type CircuitState } from "../src/provider-circuit";
function fixture() {
  let state: CircuitState | undefined;
  return {get:()=>state && structuredClone(state),put:(v:CircuitState)=>{state=structuredClone(v);}};
}
test("five failures open persistent provider circuit; one half-open probe controls recovery", () => {
  let now=0; const store=fixture(); const circuit=new ProviderCircuit(store,()=>now);
  const submit=(c=circuit)=>{const p=c.begin();assert.ok("id" in p);return p.id;};
  const stale=submit();
  for(let i=0;i<5;i++) circuit.finish(submit(),"failure");
  assert.deepEqual(circuit.begin(),{error:"model_circuit_open"});
  circuit.finish(stale,"success");
  assert.deepEqual(circuit.begin(),{error:"model_circuit_open"},"late success cannot close an open circuit");
  const restarted=new ProviderCircuit(store,()=>now);
  assert.deepEqual(restarted.begin(),{error:"model_circuit_open"});
  now=60000; const probe=submit(restarted);
  assert.deepEqual(circuit.begin(),{error:"model_circuit_open"});
  restarted.finish(probe,"failure");
  now=119999; assert.deepEqual(circuit.begin(),{error:"model_circuit_open"});
  now=120000; restarted.finish(submit(),"success");
  assert.ok("id" in circuit.begin());
});
test("global concurrency and abandoned recovery probes have bounded leases", () => {
  let now=0; const store=fixture(); const circuit=new ProviderCircuit(store,()=>now);
  const permits=Array.from({length:4},()=>circuit.begin());
  assert.deepEqual(circuit.begin(),{error:"classifier_busy"});
  for(const p of permits){assert.ok("id" in p);circuit.finish(p.id,"success");}
  for(let i=0;i<5;i++){const p=circuit.begin();assert.ok("id" in p);circuit.finish(p.id,"failure");}
  now=60000; assert.ok("id" in circuit.begin());
  now=119999; assert.deepEqual(new ProviderCircuit(store,()=>now).begin(),{error:"model_circuit_open"});
  now=120000; assert.ok("id" in new ProviderCircuit(store,()=>now).begin(),"abandoned probe does not permanently wedge circuit");
});
