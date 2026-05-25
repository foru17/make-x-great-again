// Maintainer-only admin console. Self-contained — shares only design
// tokens with the public pages. base-ui inspired: monochrome canvas,
// neutral borders, accent reserved for state, sharp corners.
// Lives under /admin and authenticates with ADMIN_TOKEN (localStorage,
// never ships in the consumer extension build).
// Theme: dark + light, picks system pref by default, overridable via the
// theme toggle in the bar (state persisted in localStorage as `mxga_theme`).
import { BRAND } from "../brand";

const GH_REPO = BRAND.repo;

const CSS = `:root{
  color-scheme:dark light;
  --bg:#0a0a0a; --bg-2:#111113;
  --fg:#fafafa; --fg-2:#a1a1aa; --fg-3:#71717a; --fg-4:#52525b;
  --border:rgba(255,255,255,.07); --border-strong:rgba(255,255,255,.14);
  --card:rgba(255,255,255,.025); --card-hi:rgba(255,255,255,.05);
  --accent:#38bdf8; --accent-soft:rgba(56,189,248,.12);
  --danger:#ef4444; --danger-soft:rgba(239,68,68,.08);
  --warn:#f59e0b; --ok:#10b981; --violet:#a855f7;
  --r-sm:4px; --r:6px; --r-lg:10px;
}
@media (prefers-color-scheme:light){
  :root:not([data-theme="dark"]){
    color-scheme:light;
    --bg:#ffffff; --bg-2:#f9fafb;
    --fg:#09090b; --fg-2:#3f3f46; --fg-3:#71717a; --fg-4:#a1a1aa;
    --border:rgba(0,0,0,.08); --border-strong:rgba(0,0,0,.18);
    --card:rgba(0,0,0,.025); --card-hi:rgba(0,0,0,.055);
    --accent:#0284c7; --accent-soft:rgba(2,132,199,.1);
    --danger:#dc2626; --danger-soft:rgba(220,38,38,.08);
    --warn:#d97706; --ok:#15803d; --violet:#7e22ce;
  }
}
:root[data-theme="light"]{
  color-scheme:light;
  --bg:#ffffff; --bg-2:#f9fafb;
  --fg:#09090b; --fg-2:#3f3f46; --fg-3:#71717a; --fg-4:#a1a1aa;
  --border:rgba(0,0,0,.08); --border-strong:rgba(0,0,0,.18);
  --card:rgba(0,0,0,.025); --card-hi:rgba(0,0,0,.055);
  --accent:#0284c7; --accent-soft:rgba(2,132,199,.1);
  --danger:#dc2626; --danger-soft:rgba(220,38,38,.08);
  --warn:#d97706; --ok:#15803d; --violet:#7e22ce;
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0a0a0a; --bg-2:#111113;
  --fg:#fafafa; --fg-2:#a1a1aa; --fg-3:#71717a; --fg-4:#52525b;
  --border:rgba(255,255,255,.07); --border-strong:rgba(255,255,255,.14);
  --card:rgba(255,255,255,.025); --card-hi:rgba(255,255,255,.05);
  --accent:#38bdf8; --accent-soft:rgba(56,189,248,.12);
  --danger:#ef4444; --danger-soft:rgba(239,68,68,.08);
  --warn:#f59e0b; --ok:#10b981; --violet:#a855f7;
}

*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg);
  font:13.5px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Inter","SF Pro Text","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
  transition:background-color .15s ease,color .15s ease}
body{min-height:100vh}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
:focus{outline:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:-1px;border-radius:var(--r)}

.wrap{max-width:1200px;margin:0 auto;padding:22px 28px 60px}

/* Top bar */
.bar{display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding:6px 0 22px;border-bottom:1px solid var(--border);margin-bottom:22px;flex-wrap:wrap}
.bar h1{font-size:17px;font-weight:600;display:flex;align-items:center;gap:10px;letter-spacing:-.005em}
.bar h1 svg{width:20px;height:20px;color:var(--fg)}
.bar .sub{color:var(--fg-3);font-size:12.5px;margin-top:4px}
.bar .sub a{color:var(--fg-2);text-decoration:underline;text-decoration-color:var(--fg-4)}
.bar .sub a:hover{color:var(--fg);text-decoration-color:var(--fg-3)}
.bar .right{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--fg-3)}
.bar .ok{color:var(--ok);display:inline-flex;align-items:center;gap:6px}
.bar .ok::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ok);
  box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 50%,transparent);
  animation:pulse 2.4s ease-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 50%,transparent)}100%{box-shadow:0 0 0 7px transparent}}

/* Theme toggle */
.theme-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:var(--r);color:var(--fg-3);transition:color .15s,background .15s,transform .12s}
.theme-btn:hover{color:var(--fg);background:var(--card-hi)}
.theme-btn:active{transform:translateY(.5px)}
.theme-btn svg{width:14px;height:14px}
.theme-btn .ic-a,.theme-btn .ic-l,.theme-btn .ic-d{display:none}
:root[data-theme="light"] .theme-btn .ic-l{display:inline}
:root[data-theme="dark"] .theme-btn .ic-d{display:inline}
:root:not([data-theme]) .theme-btn .ic-a{display:inline}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;
  border-radius:var(--r);font-size:12.5px;font-weight:500;line-height:1;
  border:1px solid var(--border-strong);background:transparent;color:var(--fg);
  transition:background .12s,border-color .12s,color .12s,transform .08s;white-space:nowrap}
.btn:hover{background:var(--card-hi)}
.btn:active{transform:translateY(.5px)}
.btn[disabled]{opacity:.4;cursor:not-allowed;transform:none}
.btn.primary{background:var(--fg);color:var(--bg);border-color:var(--fg);font-weight:600}
.btn.primary:hover{opacity:.9}
.btn.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 36%,transparent)}
.btn.danger:hover{background:var(--danger-soft)}
.btn.sm{padding:5px 10px;font-size:12px;border-radius:var(--r-sm)}

/* Inputs */
input,select{font:inherit;color:var(--fg);background:transparent;
  border:1px solid var(--border-strong);border-radius:var(--r);padding:7px 11px;
  transition:border-color .12s}
input:focus,select:focus{border-color:var(--accent);outline:none}
input::placeholder{color:var(--fg-4)}

/* Tabs */
.tabs{display:flex;gap:2px;margin-bottom:18px}
.tabs button{padding:8px 14px;border-radius:var(--r);font-size:13px;color:var(--fg-3);
  border:1px solid transparent;background:transparent;
  transition:color .12s,background .12s,border-color .12s}
.tabs button:hover{color:var(--fg);background:var(--card-hi)}
.tabs button.on{color:var(--fg);background:var(--card-hi);border-color:var(--border-strong)}
.tabs .count{margin-left:6px;font-size:11px;color:var(--fg-4);font-variant-numeric:tabular-nums}
.tabs button.on .count{color:var(--fg-2)}

/* Toolbar */
.toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;
  flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;border-radius:var(--r-lg);
  background:var(--card);border:1px solid var(--border)}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{padding:5px 11px;border-radius:999px;font-size:12px;color:var(--fg-3);
  border:1px solid var(--border-strong);background:transparent;transition:all .12s;cursor:pointer}
.chip:hover{background:var(--card-hi);color:var(--fg)}
.chip.on{color:var(--bg);background:var(--fg);border-color:var(--fg)}
.chip .n{margin-left:5px;font-size:10.5px;color:var(--fg-3);font-variant-numeric:tabular-nums;opacity:.7}
.chip.on .n{color:var(--bg);opacity:.6}
.toolbar .r{display:flex;align-items:center;gap:8px}
.toolbar select{padding:6px 26px 6px 11px;font-size:12.5px;-webkit-appearance:none;appearance:none;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='%2371717a'><path d='M6 8L2 4h8z'/></svg>");
  background-repeat:no-repeat;background-position:right 9px center}

/* Batch action bar */
.batch{display:none;align-items:center;justify-content:space-between;gap:10px;
  padding:10px 14px;margin-bottom:12px;border-radius:var(--r-lg);
  background:var(--card-hi);border:1px solid var(--border-strong);animation:slidein .25s ease-out}
.batch.on{display:flex}
.batch .meta{font-size:13px;color:var(--fg)}
.batch .meta b{color:var(--fg);font-variant-numeric:tabular-nums}
.batch .actions{display:flex;gap:8px;flex-wrap:wrap}
@keyframes slidein{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}

/* ──────────────────────────────────────────────────────────────────────
   Queue rows — REDESIGNED for scannability:
   - 4px left edge color-coded by verdict (replaces the repetitive verdict
     tag column; one tap of color, not eight)
   - Confidence: 4px tall bar + bold % above it, both verdict-colored
   - Reporters: ≥3 = green chip "N 人 ✓"; <3 = small muted "N 人"
   - Verdict label still appears inline next to handle as a small grey
     marker so the row category is readable without the giant tag pill
   ────────────────────────────────────────────────────────────────────── */
.rows{display:flex;flex-direction:column;gap:1px;background:var(--border);
  border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden}
.qrow{position:relative;display:grid;grid-template-columns:24px 40px 1fr 110px 80px auto;gap:14px;
  align-items:center;padding:11px 16px 11px 18px;background:var(--bg);
  transition:background .15s,opacity .25s}
.qrow::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;
  background:var(--ec,transparent)}
.qrow.spam,.qrow.likely_spam{--ec:var(--danger)}
.qrow.porn_bot{--ec:var(--violet)}
.qrow.uncertain{--ec:var(--fg-4)}
.qrow.legit{--ec:var(--ok)}
.qrow:hover{background:var(--card-hi)}
.qrow.sel{background:var(--accent-soft)}
.qrow.removing{opacity:.3;pointer-events:none}
.qrow input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent);cursor:pointer}
.qrow .av{width:40px;height:40px;border-radius:50%;overflow:hidden;background:var(--card-hi);
  display:flex;align-items:center;justify-content:center;color:var(--fg-4);font-size:14px;
  font-weight:600;flex-shrink:0}
.qrow .av img{width:100%;height:100%;object-fit:cover;display:block}
.qrow .who{min-width:0}
.qrow .who .name{font-weight:600;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;color:var(--fg);letter-spacing:-.005em}
.qrow .who .name .vlbl{margin-left:6px;font-size:10.5px;font-weight:500;color:var(--ec,var(--fg-3));
  text-transform:uppercase;letter-spacing:.06em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.qrow .who .sub{font-size:11.5px;color:var(--fg-3);margin-top:3px;display:flex;
  align-items:center;gap:6px;flex-wrap:wrap}
.qrow .who .sub a{color:var(--fg-2)}.qrow .who .sub a:hover{color:var(--accent)}
.qrow .who .sub .sep{color:var(--fg-4);opacity:.5}
/* Confidence cell — number on top, fat bar below */
.qrow .conf{display:flex;flex-direction:column;gap:5px;align-items:flex-start;min-width:90px}
.qrow .conf .pct{font-size:14px;color:var(--fg);font-weight:600;font-variant-numeric:tabular-nums;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1}
.qrow .conf .pct .lbl{font-size:9.5px;color:var(--fg-3);margin-left:4px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;font-family:inherit}
.qrow .conf .bar{width:96px;height:4px;background:var(--card-hi);border-radius:2px;overflow:hidden;position:relative}
.qrow .conf .bar i{display:block;height:100%;background:var(--ec,var(--fg-3));border-radius:2px;transition:width .3s ease}
/* Reporters cell — chip when ≥3, muted text otherwise */
.qrow .rep{font-size:12px;color:var(--fg-3);font-variant-numeric:tabular-nums;text-align:right}
.qrow .rep .chip-ok{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;
  border-radius:999px;color:var(--ok);border:1px solid color-mix(in srgb,var(--ok) 40%,transparent);
  background:color-mix(in srgb,var(--ok) 8%,transparent);font-weight:600;font-size:11.5px;letter-spacing:.02em}
.qrow .acts{display:flex;gap:6px;flex-shrink:0}

/* Locked state */
.locked{min-height:60vh;display:flex;align-items:center;justify-content:center}
.locked .card{max-width:420px;width:100%;padding:36px 32px;border-radius:var(--r-lg);
  background:var(--card);border:1px solid var(--border);text-align:center}
.locked .card .lock{width:40px;height:40px;border-radius:var(--r);background:var(--card-hi);
  color:var(--fg);display:inline-flex;align-items:center;justify-content:center;
  margin-bottom:18px;border:1px solid var(--border-strong)}
.locked .card .lock svg{width:18px;height:18px}
.locked .card h2{font-size:17px;font-weight:600;margin-bottom:8px;color:var(--fg);letter-spacing:-.005em}
.locked .card p{font-size:13px;color:var(--fg-3);margin-bottom:20px;line-height:1.6}
.locked .card .form{display:flex;gap:8px}
.locked .card input{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}

/* Log */
.log{display:flex;flex-direction:column;gap:1px;background:var(--border);
  border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden}
.lrow{display:grid;grid-template-columns:160px 130px 130px 1fr 1fr;gap:14px;align-items:center;
  padding:9px 14px;background:var(--bg);font-size:12.5px;transition:background .12s}
.lrow:hover{background:var(--card-hi)}
.lrow.head{background:var(--card);color:var(--fg-3);font-size:11px;letter-spacing:.06em;
  text-transform:uppercase;padding:8px 14px;font-weight:600}
.lrow.head:hover{background:var(--card)}
.lrow .t{color:var(--fg-3);font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.lrow .act{font-weight:600;font-size:12px}
.lrow .act.approve{color:var(--ok)}
.lrow .act.reject,.lrow .act.remove{color:var(--danger)}
.lrow .actor{color:var(--fg-3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.lrow .h a{color:var(--fg)}.lrow .h a:hover{color:var(--accent)}
.lrow .n{color:var(--fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.empty{padding:60px 20px;text-align:center;color:var(--fg-3);border:1px dashed var(--border);
  border-radius:var(--r-lg)}
.status{color:var(--fg-3);font-size:12px}

@media (max-width:880px){
  .wrap{padding:18px 18px 48px}
  .qrow{grid-template-columns:22px 36px 1fr 80px auto;gap:10px;padding:10px 12px 10px 14px}
  .qrow .conf{min-width:70px}
  .qrow .conf .bar{width:70px}
  .qrow .rep{display:none}
  .lrow{grid-template-columns:1fr;gap:4px;padding:10px 12px}
  .lrow.head{display:none}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}}
`;

const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>`;
const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_AUTO = `<svg class="ic-a" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 3a9 9 0 0 1 0 18" fill="currentColor"/></svg>`;
const ICON_LIGHT = `<svg class="ic-l" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const ICON_DARK = `<svg class="ic-d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`;

const THEME_BOOT = `(function(){try{var t=localStorage.getItem('mxga_theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
const THEME_TOGGLE_JS = `window.__mxgaTheme=function(){var d=document.documentElement;var cur=d.getAttribute('data-theme');var next=cur===null||cur===''?'light':cur==='light'?'dark':null;try{if(next){d.setAttribute('data-theme',next);localStorage.setItem('mxga_theme',next)}else{d.removeAttribute('data-theme');localStorage.removeItem('mxga_theme')}}catch(e){}};`;

const SCRIPT = String.raw`
(function(){
  var TOK=localStorage.getItem('xss_admin')||'';
  var VIEW='queue';
  var queue=[];
  var filter='all';
  var sort='severity';
  var sel=new Set();
  var logCursor=null;
  var GH='${GH_REPO}';

  function E(s){return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function $(id){return document.getElementById(id)}
  function setStatus(s){var el=$('status');if(el)el.textContent=s||''}
  function ago(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<60)return s+'s';var m=Math.round(s/60);if(m<60)return m+'m';var h=Math.round(m/60);if(h<24)return h+'h';return Math.round(h/24)+'d'}
  function key(a){return (a.x_user_id||'')+'|'+a.handle}
  function api(p,o){return fetch(p,Object.assign({},o||{},{headers:Object.assign({'x-admin-token':TOK},(o&&o.headers)||{})}))}

  function themeBtnHtml(){
    return '<button class="theme-btn" type="button" onclick="window.__mxgaTheme()" aria-label="切换亮/暗主题" title="auto → light → dark">'
      + ${JSON.stringify(ICON_AUTO)} + ${JSON.stringify(ICON_LIGHT)} + ${JSON.stringify(ICON_DARK)}
      + '</button>';
  }

  function renderShell(){
    if(!TOK){renderLocked();return}
    $('app').innerHTML=
      '<div class="bar">'
      +'<div><h1>'+ ${JSON.stringify(LOGO_SVG)} +'<span>'+ ${JSON.stringify(BRAND.acronym)} +' · 审核台 · 守门员</span></h1>'
      +'<div class="sub">守门员才能进 · 通过 = 进公榜 · 驳回 / 移除 = 不公开 · 规则见 <a href="'+GH+'/blob/main/docs/GOVERNANCE.md" target="_blank">GOVERNANCE</a></div></div>'
      +'<div class="right"><span class="ok">已认证</span><button class="btn sm" onclick="window.__xss.logout()">退出</button>'+themeBtnHtml()+'</div>'
      +'</div>'
      +'<div class="tabs">'
      +'<button class="on" data-v="queue" onclick="window.__xss.tab(\'queue\')">待审队列 <span class="count" id="cQ">—</span></button>'
      +'<button data-v="log" onclick="window.__xss.tab(\'log\')">审计日志</button>'
      +'</div>'
      +'<div id="view"></div>';
    loadQueue();
  }
  function renderLocked(){
    $('app').innerHTML='<div class="locked"><div class="card">'
      +'<div class="lock">'+ ${JSON.stringify(LOCK_SVG)} +'</div>'
      +'<h2>需要维护者令牌</h2>'
      +'<p>把 <code style="background:var(--card-hi);padding:1px 6px;border-radius:var(--r-sm);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--fg)">ADMIN_TOKEN</code> 粘进来，仅在本浏览器 localStorage 保存。</p>'
      +'<form class="form" onsubmit="event.preventDefault();window.__xss.save()">'
      +'<input id="t" type="password" autocomplete="off" placeholder="xss_…" />'
      +'<button class="btn primary" type="submit">解锁</button>'
      +'</form>'
      +'<div style="margin-top:18px">'+themeBtnHtml()+'</div>'
      +'</div></div>';
    setTimeout(function(){var t=$('t');if(t)t.focus()},50);
  }

  function loadQueue(){
    setStatus('加载中…');
    api('/v1/admin/queue').then(function(r){
      if(r.status===403){TOK='';localStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      queue=j.queue||[];
      var c=$('cQ');if(c)c.textContent=queue.length;
      setStatus('');
      renderQueue();
    });
  }
  function filteredQueue(){
    var rows=filter==='all'?queue.slice():queue.filter(function(a){return a.verdict_label===filter});
    if(sort==='severity'){
      var sev={spam:4,porn_bot:4,likely_spam:3,uncertain:1,legit:0};
      rows.sort(function(a,b){
        var sa=sev[a.verdict_label]||0,sb=sev[b.verdict_label]||0;
        if(sa!==sb)return sb-sa;
        return (b.confidence||0)-(a.confidence||0);
      });
    } else if(sort==='conf_desc')rows.sort(function(a,b){return (b.confidence||0)-(a.confidence||0)});
    else if(sort==='time_desc')rows.sort(function(a,b){return (b.last_scored||0)-(a.last_scored||0)});
    else if(sort==='rep_desc')rows.sort(function(a,b){return (b.reporters||0)-(a.reporters||0)});
    return rows;
  }
  function counts(){
    var c={all:queue.length,spam:0,porn_bot:0,likely_spam:0,uncertain:0,legit:0};
    queue.forEach(function(a){if(c[a.verdict_label]!=null)c[a.verdict_label]++});
    return c;
  }
  function renderQueue(){
    var v=$('view');
    var c=counts();
    var chip=function(k,lbl){return '<button class="chip'+(filter===k?' on':'')+'" data-f="'+k+'">'+lbl+'<span class="n">'+c[k]+'</span></button>'};
    v.innerHTML=
      '<div class="toolbar">'
        +'<div class="chips">'
          +chip('all','全部')
          +chip('spam','spam')
          +chip('porn_bot','porn_bot')
          +chip('likely_spam','likely_spam')
          +chip('uncertain','uncertain')
          +chip('legit','legit')
        +'</div>'
        +'<div class="r"><label class="status">排序</label>'
          +'<select id="sort">'
            +'<option value="severity"'+(sort==='severity'?' selected':'')+'>风险等级 ↓</option>'
            +'<option value="conf_desc"'+(sort==='conf_desc'?' selected':'')+'>AI 置信 ↓</option>'
            +'<option value="time_desc"'+(sort==='time_desc'?' selected':'')+'>时间 ↓</option>'
            +'<option value="rep_desc"'+(sort==='rep_desc'?' selected':'')+'>举报人数 ↓</option>'
          +'</select>'
        +'</div>'
      +'</div>'
      +'<div class="batch" id="batch">'
        +'<div class="meta">已选 <b id="selN">0</b> 条 · 仅当前过滤范围</div>'
        +'<div class="actions">'
          +'<button class="btn sm primary" onclick="window.__xss.batch(\'approve\')">批量通过</button>'
          +'<button class="btn sm" onclick="window.__xss.batch(\'reject\')">批量驳回</button>'
          +'<button class="btn sm danger" onclick="window.__xss.batch(\'remove\')">批量移除</button>'
          +'<button class="btn sm" onclick="window.__xss.clearSel()">清空选择</button>'
        +'</div>'
      +'</div>'
      +'<div class="rows" id="rows"></div>';
    Array.prototype.forEach.call(v.querySelectorAll('.chip'),function(b){
      b.addEventListener('click',function(){filter=b.dataset.f;sel.clear();renderQueue()})
    });
    $('sort').addEventListener('change',function(e){sort=e.target.value;renderQueue()});
    renderRows();
  }
  function renderRows(){
    var rows=filteredQueue();
    var box=$('rows');
    if(!rows.length){box.innerHTML='<div class="empty">'+(filter==='all'?'队列为空':'当前过滤无匹配')+'</div>';refreshBatch();return}
    box.innerHTML=rows.map(function(a){
      var k=key(a),conf=Math.round((a.confidence||0)*100);
      var av=a.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(a.handle));
      var fb=E((a.handle||'?').slice(0,1).toUpperCase());
      var reps=a.reporters||0;
      var lbl=a.verdict_label||'uncertain';
      // Verdict inline label as a small uppercase marker right of name
      var vlbl='<span class="vlbl">'+E(lbl)+'</span>';
      // Reporters: chip when ≥3, muted otherwise
      var repHtml=reps>=3
        ? '<span class="chip-ok">'+reps+' 人 ✓</span>'
        : '<span>'+reps+' 人</span>';
      return '<div class="qrow '+E(lbl)+(sel.has(k)?' sel':'')+'" data-k="'+E(k)+'">'
        +'<input type="checkbox"'+(sel.has(k)?' checked':'')+' aria-label="选中 @'+E(a.handle)+'">'
        +'<div class="av"><img src="'+E(av)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\''+fb+'\'}))"></div>'
        +'<div class="who">'
          +'<div class="name">'+E(a.display_name||('@'+a.handle))+vlbl+'</div>'
          +'<div class="sub">'
            +'<a href="https://x.com/'+E(a.handle)+'" target="_blank" rel="noopener">@'+E(a.handle)+' ↗</a>'
            +(a.x_user_id&&a.x_user_id!==a.handle?'<span class="sep">·</span><span>'+E(a.x_user_id)+'</span>':'')
            +'<span class="sep">·</span><span>'+ago(a.last_scored)+'</span>'
          +'</div>'
        +'</div>'
        +'<div class="conf">'
          +'<div class="pct">'+conf+'%<span class="lbl">conf</span></div>'
          +'<div class="bar"><i style="width:'+conf+'%"></i></div>'
        +'</div>'
        +'<div class="rep">'+repHtml+'</div>'
        +'<div class="acts">'
          +'<button class="btn sm primary" data-act="approve">通过</button>'
          +'<button class="btn sm" data-act="reject">驳回</button>'
          +'<button class="btn sm danger" data-act="remove">移除</button>'
        +'</div>'
      +'</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.qrow'),function(r){
      var k=r.dataset.k;
      var cb=r.querySelector('input[type=checkbox]');
      cb.addEventListener('change',function(){if(cb.checked){sel.add(k);r.classList.add('sel')}else{sel.delete(k);r.classList.remove('sel')}refreshBatch()});
      Array.prototype.forEach.call(r.querySelectorAll('.acts button'),function(b){
        b.addEventListener('click',function(){decideOne(r,k,b.dataset.act)})
      })
    });
    refreshBatch();
  }
  function refreshBatch(){var b=$('batch'),s=$('selN');if(!b)return;if(sel.size){b.classList.add('on');s.textContent=sel.size}else b.classList.remove('on')}
  function decideOne(rowEl,k,action){
    var parts=k.split('|'),xUserId=parts[0]||undefined,handle=parts[1];
    rowEl.classList.add('removing');
    api('/v1/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:handle,xUserId:xUserId,action:action})})
      .then(function(){
        queue=queue.filter(function(a){return key(a)!==k});sel.delete(k);
        var c=$('cQ');if(c)c.textContent=queue.length;
        renderRows();
        Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(b){
          var k2=b.dataset.f,n=k2==='all'?queue.length:queue.filter(function(a){return a.verdict_label===k2}).length;
          var nEl=b.querySelector('.n');if(nEl)nEl.textContent=n;
        });
      });
  }
  function batch(action){
    if(!sel.size)return;
    var label={approve:'通过',reject:'驳回',remove:'移除'}[action]||action;
    if(!confirm('确认对已选 '+sel.size+' 条执行「'+label+'」？此操作会写 review_log。'))return;
    var ks=Array.from(sel);
    setStatus('批量'+label+'…');
    var done=0;
    function next(){
      if(done>=ks.length){sel.clear();renderQueue();setStatus('完成 · '+done+' 条');setTimeout(function(){setStatus('')},2500);return}
      var k=ks[done++],parts=k.split('|');
      api('/v1/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:parts[1],xUserId:parts[0]||undefined,action:action})})
        .then(function(){queue=queue.filter(function(a){return key(a)!==k});var c=$('cQ');if(c)c.textContent=queue.length;setStatus('批量'+label+' '+done+'/'+ks.length);next()})
        .catch(function(){next()})
    }
    next();
  }
  function clearSel(){sel.clear();renderRows()}

  function loadLog(more){
    var v=$('view');
    if(!more){v.innerHTML='<div class="log" id="log">'
      +'<div class="lrow head"><span>时间</span><span>动作</span><span>角色</span><span>账号</span><span>备注</span></div>'
      +'</div>'
      +'<div style="text-align:center;padding:18px"><button class="btn sm" id="lm">加载更多</button></div>';
      logCursor=null;$('lm').addEventListener('click',function(){loadLog(true)})}
    setStatus('加载中…');
    api('/v1/admin/log?limit=50'+(logCursor?'&before='+logCursor:'')).then(function(r){
      if(r.status===403){TOK='';localStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      setStatus('');
      var log=$('log');
      var rows=(j.log||[]).map(function(e){
        var when=new Date(e.at).toLocaleString('zh-CN',{hour12:false});
        var act=String(e.action||'');
        return '<div class="lrow">'
          +'<span class="t">'+E(when)+'</span>'
          +'<span class="act '+E(act)+'">'+E(act)+'</span>'
          +'<span class="actor">'+E(e.actor||'')+'</span>'
          +'<span class="h">'+(e.handle?'<a href="https://x.com/'+E(e.handle)+'" target="_blank" rel="noopener">@'+E(e.handle)+'</a>':'—')+'</span>'
          +'<span class="n">'+E(e.note||'')+'</span>'
        +'</div>';
      }).join('');
      log.insertAdjacentHTML('beforeend',rows||(more?'':'<div class="empty">暂无记录</div>'));
      logCursor=j.nextCursor;
      var lm=$('lm');if(lm)lm.style.display=logCursor?'':'none';
    });
  }

  function tab(v){
    if(VIEW===v)return;VIEW=v;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(b){b.classList.toggle('on',b.dataset.v===v)});
    if(v==='queue')loadQueue();else loadLog(false);
  }
  function save(){
    var t=$('t');if(!t)return;
    var v=t.value.trim();if(!v)return;
    TOK=v;localStorage.setItem('xss_admin',v);renderShell();
  }
  function logout(){
    if(!confirm('确认退出？将清除本浏览器保存的 ADMIN_TOKEN。'))return;
    TOK='';localStorage.removeItem('xss_admin');renderLocked();
  }

  window.__xss={tab:tab,save:save,logout:logout,batch:batch,clearSel:clearSel};
  renderShell();
})();
`;

export function adminHtml(): string {
  return `<!doctype html><html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex,nofollow">
<title>${BRAND.acronym} · 审核台</title>
<script>${THEME_BOOT}</script>
<style>${CSS}</style>
</head><body>
<div class="wrap"><div id="app" aria-live="polite"><div class="locked"><div class="card"><div class="lock"></div><h2>加载中…</h2></div></div></div></div>
<div class="wrap" style="padding-top:0;color:var(--fg-4);font-size:11.5px;display:flex;justify-content:space-between"><span id="status"></span><span>v1 · /admin</span></div>
<script>${THEME_TOGGLE_JS}${SCRIPT}</script>
</body></html>`;
}
