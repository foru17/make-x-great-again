import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../../..");
const out = resolve(root, ".ui-acceptance/2026-09-23-unified");
mkdirSync(out, { recursive: true });
const session = "mxga-unified";
let commands = 0;
const checks = [];
function run(...args) {
  assert.ok(++commands <= 220, "browser command cap");
  return execFileSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
}
function js(code) {
  return JSON.parse(run("--json", "eval", code)).data.result;
}
function check(name, code) {
  assert.equal(js(code), true, name);
  checks.push(name);
  console.log("PASS", name);
}
const button = (name) => {
  run("find", "role", "button", "click", "--name", name, "--exact");
  if (name === "取消" || /条$/.test(name))
    run("wait", "--fn", `!document.querySelector('[data-slot=dialog-overlay]')`);
};
const wait = (text) => run("wait", "--text", text);
function shot(name) {
  run("wait", "--fn", `document.getAnimations().every(a=>a.playState!=='running')`);
  const r = JSON.parse(run("screenshot", "--json"));
  copyFileSync(r.data.path, resolve(out, name + ".png"));
}
function count(n) {
  wait("命中 " + n);
}
async function reset(hash = "") {
  await fetch("http://127.0.0.1:4318/__fixture/reset", { method: "POST" });
  run("open", "http://127.0.0.1:4318/admin?fixture=" + Date.now() + hash);
  wait("review_");
}
async function state() {
  return (await fetch("http://127.0.0.1:4318/__fixture/state")).json();
}
await reset();
run("set", "viewport", "1440", "900");
run("set", "media", "light");
count(112);
check(
  "one unified tab, no separate AI queues",
  `document.querySelectorAll('[role=tab]').length===6 && document.body.innerText.includes('待审队列')`,
);
for (const [label, n] of [
  ["未初审", 28],
  ["AI 已初审", 84],
  ["AI 待定", 28],
  ["AI 建议拉黑", 28],
  ["AI 建议放行", 28],
  ["全部待审", 112],
]) {
  button(label);
  count(n);
  check(
    "stage " + label,
    `document.querySelector('button[aria-pressed=true]').textContent.trim()===${JSON.stringify(label)}`,
  );
}
run("find", "role", "checkbox", "click", "--name", "选中 @review_0", "--exact");
button("AI 待定");
count(28);
check("filter changes clear hidden selection", `!document.body.innerText.includes('批量白名单')`);
run("click", "details summary");
check(
  "AI evidence expands",
  `document.querySelector('details').open && document.body.innerText.includes('审核模型：fixture-model')`,
);
run("fill", "input[type=search]", "review_1");
button("搜索");
count(6);
check("stage + search combine", `document.querySelectorAll('[aria-label^="选中 @"]').length===6`);
button("全部清除");
count(112);
run("click", 'nav a[aria-label="下一页"]');
run("wait", "--fn", `document.querySelectorAll('[aria-label^="选中 @"]').length===12`);
count(112);
check(
  "pagination uses offset, twelve rows on last page",
  `document.querySelectorAll('[aria-label^="选中 @"]').length===12`,
);
button("AI 建议拉黑");
count(28);
check("filter resets pagination", `document.body.innerText.includes('当前第 1/1')`);
run("click", "[role=combobox]");
run("find", "nth", "1", "[role=listbox] [role=option]", "click");
run("wait", "--fn", `!document.querySelector('[role=listbox]')`);
count(28);
check(
  "sort selection reloads queue",
  `document.querySelector('[role=combobox]').textContent.includes('把握 高→低')`,
);
run("find", "role", "button", "click", "--name", "更多筛选 · 1", "--exact");
check(
  "same structured filters available to AI records",
  `document.body.innerText.includes('粉丝') && document.body.innerText.includes('UID 前缀') && document.body.innerText.includes('推文内容包含')`,
);
run("find", "placeholder", "如 spam_", "fill", "review_2");
button("应用筛选");
count(3);
button("全部清除");
count(112);
run("find", "role", "button", "click", "--name", "更多筛选", "--exact");
button("AI 待定");
count(28);
button("对命中的全部批量操作 ▾");
run("find", "role", "menuitem", "click", "--name", "全部驳回", "--exact");
wait("按筛选批量驳回");
check(
  "batch dialog includes stage and exact count",
  `document.querySelector('[role=dialog]').innerText.includes('28') && document.querySelector('[role=dialog]').innerText.includes('AI 待定')`,
);
shot("queue-confirm-desktop");
button("取消");
assert.equal((await state()).log.length, 0);
checks.push("cancel writes nothing");
button("对命中的全部批量操作 ▾");
run("find", "role", "menuitem", "click", "--name", "全部驳回", "--exact");
button("驳回全部 28 条");
wait("没有符合条件");
let st = await state();
assert.equal(st.counts.find((x) => x.status === "rejected").n, 28);
assert.equal(st.counts.find((x) => x.status === "agent_blacklist").n, 28);
checks.push("filter batch resolves only AI pending");
await reset();
button("AI 建议放行");
count(28);
run("find", "role", "checkbox", "click", "--name", "选中 @review_3", "--exact");
button("批量白名单");
button("白名单 1 条");
count(27);
st = await state();
assert.equal(st.counts.find((x) => x.status === "whitelisted").n, 1);
checks.push("selected AI whitelist applies and recounts");
button("AI 建议拉黑");
count(28);
run("find", "role", "checkbox", "click", "--name", "选中 @review_2", "--exact");
button("拉黑并归类 ▾");
run("find", "role", "menuitem", "click", "--name", "色情招揽", "--exact");
button("拉黑并归类「色情招揽」 1 条");
count(27);
st = await state();
assert.equal(st.counts.find((x) => x.status === "human_confirmed").n, 1);
checks.push("selected AI blacklist + category applies");
button("未初审");
count(28);
run("find", "role", "checkbox", "click", "--name", "选中 @review_0", "--exact");
button("批量移除");
button("移除 1 条");
count(27);
checks.push("selected remove recounts");
run("fill", "input[type=search]", "force_error");
button("搜索");
wait("加载失败");
check(
  "load failure cannot expose stale selection",
  `document.querySelectorAll('[aria-label^="选中 @"]').length===0`,
);
button("全部清除");
count(109);
await reset();
run("click", 'nav a[aria-label="下一页"]');
run("wait", "--fn", `document.querySelectorAll('[aria-label^="选中 @"]').length===12`);
run("find", "role", "checkbox", "click", "--name", "全选当前范围", "--exact");
button("批量驳回");
button("驳回 12 条");
count(100);
check(
  "resolving the last page returns to a valid page",
  `document.body.innerText.includes('当前第 1/1') && document.querySelectorAll('[aria-label^="选中 @"]').length===100`,
);
await reset();
button("AI 待定");
count(28);
run("find", "role", "checkbox", "click", "--name", "选中 @review_1", "--exact");
button("重新初审");
button("重新初审 1 条");
count(27);
button("未初审");
count(29);
check(
  "re-review stays in unified queue and becomes unreviewed",
  `document.querySelector('[role=tab][data-state=active]').textContent.includes('112')`,
);
await reset();
run(
  "open",
  "http://127.0.0.1:4318/admin?fixture=" +
    js('new URL(location.href).searchParams.get("fixture")') +
    "#agentPending",
);
count(28);
check(
  "old AI pending link opens unified stage",
  `document.querySelector('button[aria-pressed=true]').textContent==='AI 待定'`,
);
run("find", "role", "checkbox", "click", "--name", "选中 @review_1", "--exact");
button("清空选择");
check(
  "clear selection",
  `document.querySelectorAll('[role=checkbox][aria-checked=true]').length===0`,
);
// All three required views, and mobile confirmation bounds.
button("全部待审");
count(112);
run("set", "viewport", "1440", "900");
run("set", "media", "light");
shot("queue-desktop");
run("set", "viewport", "390", "844");
shot("queue-mobile");
check(
  "mobile has no horizontal overflow or disabled zoom",
  `document.documentElement.scrollWidth<=innerWidth && !/user-scalable=no|maximum-scale=1/.test(document.querySelector('meta[name=viewport]').content)`,
);
button("AI 待定");
count(28);
button("对命中的全部批量操作 ▾");
run("find", "role", "menuitem", "click", "--name", "全部驳回", "--exact");
wait("按筛选批量驳回");
shot("queue-confirm-mobile");
check(
  "mobile confirmation stays within viewport",
  `(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`,
);
button("取消");
run("set", "viewport", "1440", "900");
button("全部待审");
count(112);
run("set", "media", "dark");
shot("queue-dark");
check("system dark theme applies", `document.documentElement.classList.contains('dark')`);
// Product theme toggle: auto -> light -> dark -> auto.
button("切换亮/暗主题（auto → light → dark）");
check(
  "explicit light overrides system dark",
  `!document.documentElement.classList.contains('dark')`,
);
button("切换亮/暗主题（auto → light → dark）");
check("explicit dark works", `document.documentElement.classList.contains('dark')`);
shot("queue-dark-toggle");
button("切换亮/暗主题（auto → light → dark）");
const result = {
  verdict: "PASS",
  commands,
  checks,
  fixture: "112 simulated accounts; actual Worker routes + SQLite; no production writes",
  screenshots: [
    "queue-desktop",
    "queue-mobile",
    "queue-dark",
    "queue-dark-toggle",
    "queue-confirm-desktop",
    "queue-confirm-mobile",
  ].map((x) => x + ".png"),
};
writeFileSync(resolve(out, "behavior.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
