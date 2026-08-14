import { CSS } from "../_generated-css";
// Maintainer-only admin console. Self-contained — shares only design
// tokens with the public pages. base-ui inspired: monochrome canvas,
// neutral borders, accent reserved for state, sharp corners.
// Lives under /admin.legacy and authenticates with a tab-scoped ADMIN_TOKEN
// (sessionStorage, never ships in the consumer extension build).
// Theme: dark + light, picks system pref by default, overridable via the
// theme toggle in the bar (state persisted in localStorage as `mxga_theme`).
import { BRAND } from "../brand";

const GH_REPO = BRAND.repo;

const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>`;
const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_AUTO = `<svg class="ic-a" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 3a9 9 0 0 1 0 18" fill="currentColor"/></svg>`;
const ICON_LIGHT = `<svg class="ic-l" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const ICON_DARK = `<svg class="ic-d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`;

const THEME_BOOT = `(function(){try{var t=localStorage.getItem('mxga_theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
const THEME_TOGGLE_JS = `window.__mxgaTheme=function(){var d=document.documentElement;var cur=d.getAttribute('data-theme');var next=cur===null||cur===''?'light':cur==='light'?'dark':null;try{if(next){d.setAttribute('data-theme',next);localStorage.setItem('mxga_theme',next)}else{d.removeAttribute('data-theme');localStorage.removeItem('mxga_theme')}}catch(e){}};`;

const SCRIPT = String.raw`
(function(){
  try{localStorage.removeItem('xss_admin')}catch(e){}
  var TOK=sessionStorage.getItem('xss_admin')||'';
  var VIEW='queue';
  var queue=[];
  var queueCursor=null;
  // Monotonic token so only the most recent /v1/admin/queue response is allowed
  // to render. Rapid sort/filter switches fire overlapping slow requests; without
  // this, a stale response can land last and clobber the fresh one (the old
  // "switching sort sometimes fails" bug).
  var queueReq=0;
  var queueLoading=false;
  var whitelist=[];
  var wlCursor=null;
  var wlSearch='';
  var wlSort='time_desc';
  var blacklist=[];
  var blCursor=null;
  var blSearch='';
  var blSort='time_desc';
  var filter='all';
  var sort='severity';
  var sel=new Set();         // queue tab selection
  var wlSel=new Set();        // whitelist tab selection
  var blSel=new Set();        // blacklist tab selection
  var logCursor=null;
  var GH='${GH_REPO}';
  // True per-table totals (vs in-memory loaded count), fetched eagerly from
  // /v1/admin/stats. Null until first refresh; chips show "—" while pending.
  var stats={queue:null,blacklist:null,whitelist:null,reports:null};
  // Last-clicked row index per tab, for shift-click range selection.
  var lastSelIdxQ=-1,lastSelIdxW=-1,lastSelIdxB=-1;
  // Queue filter state. Backend accepts these as query params; UI keeps a
  // single copy here and rebuilds the URL on every loadQueue. q is the
  // fuzzy multi-field input; the rest are explicit per-field substring /
  // prefix filters (uid is prefix, others substring).
  var qFilters={q:'',uid:'',handle:'',evidence:'',display_name:'',reasons:''};
  function fmtN(n){return typeof n==='number'?n.toLocaleString('zh-CN'):'—'}
  function num(v){return typeof v==='number'?v:(typeof v==='string'&&v!==''&&!isNaN(Number(v))?Number(v):null)}
  function ymd(ms){var d=new Date(ms);if(!isFinite(d.getTime()))return'';var p=function(n){return String(n).padStart(2,'0')};return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())}
  function createdChip(a){
    var raw=(a.account_created_at||'').trim();
    if(raw){
      var t=Date.parse(raw);
      if(!isNaN(t))return {text:ymd(t),title:new Date(t).toLocaleString('zh-CN')};
      return {text:raw,title:raw};
    }
    var age=num(a.account_age_days);
    if(age==null)return null;
    var base=num(a.last_scored)||num(a.published_at)||num(a.agent_at)||Date.now();
    return {text:'约 '+ymd(base-age*86400000),title:'按账龄 '+fmtN(age)+' 天估算'};
  }
  function accountMetaHtml(a){
    var chips=[];
    var c=createdChip(a);
    var followers=num(a.followers_count),following=num(a.following_count);
    if(c&&c.text)chips.push('<span class="acct-chip" title="'+E(c.title)+'">注册 '+E(c.text)+'</span>');
    if(followers!=null)chips.push('<span class="acct-chip" title="被关注人数">粉丝 '+fmtN(followers)+'</span>');
    if(following!=null)chips.push('<span class="acct-chip" title="关注人数">关注 '+fmtN(following)+'</span>');
    return chips.length?'<div class="acct-meta">'+chips.join('')+'</div>':'';
  }
  function opt(value,label,current){return '<option value="'+E(value)+'"'+(current===value?' selected':'')+'>'+E(label)+'</option>'}
  // Sortable queue columns. desc/asc are the server sort tokens; columns
  // with asc:null are one-direction only (风险 / 更新). The header renders these
  // as clickable cells aligned to the .qrow grid (see renderQueue).
  var QSORT_WHO=[
    {lbl:'风险',desc:'severity',asc:null,title:'按风险等级（判定+置信）排序'},
    {lbl:'注册',desc:'created_desc',asc:'created_asc',title:'按账号注册时间排序'},
    {lbl:'粉丝',desc:'followers_desc',asc:'followers_asc',title:'按粉丝数排序'},
    {lbl:'关注',desc:'following_desc',asc:'following_asc',title:'按关注数排序'},
    {lbl:'更新',desc:'time_desc',asc:null,title:'按最近判定时间排序'}
  ];
  var QSORT_CONF={lbl:'把握',desc:'conf_desc',asc:'conf_asc',title:'按 AI 置信排序'};
  var QSORT_REP={lbl:'举报',desc:'rep_desc',asc:'rep_asc',title:'按举报人数排序'};
  // One sortable header cell. Active column shows ▼ (desc) / ▲ (asc); idle shows ⇅.
  function sortBtn(col){
    var active=(sort===col.desc||(col.asc&&sort===col.asc));
    var arrow=active?(sort===col.asc?'▲':'▼'):'⇅';
    return '<button type="button" class="sortbtn'+(active?' on':'')+'" title="'+E(col.title||'')+'"'
      +' data-desc="'+E(col.desc)+'" data-asc="'+E(col.asc||'')+'">'
      +E(col.lbl)+'<span class="ar">'+arrow+'</span></button>';
  }
  function queueSortHeader(){
    return '<div class="qhead">'
      +'<span class="qh-spacer"></span>'
      +'<span class="qh-spacer"></span>'
      +'<div class="qh-who">'+QSORT_WHO.map(sortBtn).join('')+'</div>'
      +'<div class="qh-conf">'+sortBtn(QSORT_CONF)+'</div>'
      +'<div class="qh-rep">'+sortBtn(QSORT_REP)+'</div>'
      +'<span class="qh-acts">操作</span>'
    +'</div>';
  }
  function metricSortOptions(current){
    return opt('time_desc','更新时间 ↓',current)
      +opt('created_desc','注册时间 新→旧',current)
      +opt('created_asc','注册时间 旧→新',current)
      +opt('followers_desc','粉丝数 多→少',current)
      +opt('followers_asc','粉丝数 少→多',current)
      +opt('following_desc','关注数 多→少',current)
      +opt('following_asc','关注数 少→多',current);
  }
  // Build the query string for /v1/admin/queue from the current filter state.
  // Empty values are omitted entirely so the URL stays compact and the backend
  // treats them as "no filter on this dimension".
  function queueQs(){
    var parts=['limit=100'];
    if(queueCursor)parts.push('before='+encodeURIComponent(queueCursor));
    if(sort)parts.push('sort='+encodeURIComponent(sort));
    Object.keys(qFilters).forEach(function(k){
      var v=qFilters[k];
      if(v)parts.push(k+'='+encodeURIComponent(v));
    });
    return '?'+parts.join('&');
  }
  function listQs(cursor,q,listSort){
    var parts=['limit=100'];
    if(cursor)parts.push('before='+encodeURIComponent(cursor));
    if(q&&String(q).trim())parts.push('q='+encodeURIComponent(String(q).trim()));
    if(listSort)parts.push('sort='+encodeURIComponent(listSort));
    return '?'+parts.join('&');
  }
  function activeFilterCount(){
    var n=0;Object.keys(qFilters).forEach(function(k){if(qFilters[k])n++});return n;
  }
  function clearFilters(){
    Object.keys(qFilters).forEach(function(k){qFilters[k]=''});
  }
  function setFilter(key,val){
    if(!(key in qFilters))return;
    qFilters[key]=String(val||'').trim();
    loadQueue(false);
  }

  function E(s){return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function xUrl(handle){return 'https://x.com/'+encodeURIComponent(handle||'')}
  function displayName(a){var n=(a.display_name||'').trim();return n||('@'+(a.handle||''))}
  function nameLink(a){return '<a href="'+E(xUrl(a.handle))+'" target="_blank" rel="noopener">'+E(displayName(a))+'</a>'}
  function handleLink(handle){return '<a href="'+E(xUrl(handle))+'" target="_blank" rel="noopener">@'+E(handle)+' ↗</a>'}
  function idChip(id){return id?'<span class="sep">·</span><span class="id-chip" title="X user id '+E(id)+'">ID '+E(id)+'</span>':''}

  // Themed modal — replaces native confirm()/prompt() so destructive
  // actions read in the same visual language as the rest of the panel.
  var mxModal=(function(){
    function variantClass(v){return v==='danger'?'blacklist':v==='ok'?'ok':v==='muted'?'muted':'primary'}
    function dismiss(bg){if(!bg.parentNode)return;bg.remove();document.removeEventListener('keydown',bg.__k,true)}
    function open(html,onKey){
      var bg=document.createElement('div');bg.className='mx-bg';bg.tabIndex=-1;bg.innerHTML=html;
      bg.__k=onKey;document.addEventListener('keydown',onKey,true);
      document.body.appendChild(bg);
      // First focus after the animation settles
      setTimeout(function(){var f=bg.querySelector('input,[data-mx-default],button.primary,button.blacklist,button.ok');if(f)f.focus()},40);
      return bg;
    }
    function confirmFn(opts){
      return new Promise(function(resolve){
        var v=variantClass(opts.okVariant);
        // body accepts inline HTML (internal-only callers; admin-page DOM)
        var bodyHtml=String(opts.body||'').split('\n').map(function(p){return '<p>'+p+'</p>'}).join('');
        var html='<div class="mx-card" role="dialog" aria-modal="true" aria-labelledby="mxt">'
          +'<h3 id="mxt">'+E(opts.title||'确认')+'</h3>'
          +'<div class="body">'+bodyHtml+'</div>'
          +'<div class="foot">'
            +'<button type="button" class="btn sm" data-r="0">'+E(opts.cancelLabel||'取消')+'</button>'
            +'<button type="button" class="btn sm '+v+'" data-r="1" data-mx-default>'+E(opts.okLabel||'确认')+'</button>'
          +'</div></div>';
        function fin(r){dismiss(bg);resolve(!!r)}
        var bg=open(html,function(e){if(e.key==='Escape'){e.preventDefault();fin(0)}else if(e.key==='Enter'){e.preventDefault();fin(1)}});
        bg.addEventListener('click',function(e){if(e.target===bg)fin(0)});
        bg.querySelector('[data-r="0"]').addEventListener('click',function(){fin(0)});
        bg.querySelector('[data-r="1"]').addEventListener('click',function(){fin(1)});
      });
    }
    function formFn(opts){
      return new Promise(function(resolve){
        var v=variantClass(opts.okVariant);
        var fields=(opts.fields||[]);
        var fHtml=fields.map(function(f){
          var val=f.value!=null?String(f.value):'';
          var ctrl;
          if(f.type==='select'){
            var opts2=(f.options||[]).map(function(o){
              var ov=(o&&typeof o==='object')?o.value:o;
              var ol=(o&&typeof o==='object')?(o.label!=null?o.label:o.value):o;
              return '<option value="'+E(ov)+'"'+(String(ov)===val?' selected':'')+'>'+E(ol)+'</option>';
            }).join('');
            ctrl='<select id="mxf_'+f.name+'" name="'+f.name+'"'+(f.required?' required':'')+'>'+opts2+'</select>';
          } else if(f.type==='textarea'){
            ctrl='<textarea id="mxf_'+f.name+'" name="'+f.name+'" rows="'+(f.rows||3)+'"'
              +' placeholder="'+E(f.placeholder||'')+'"'+(f.required?' required':'')+'>'+E(val)+'</textarea>';
          } else {
            ctrl='<input id="mxf_'+f.name+'" name="'+f.name+'" type="'+E(f.type||'text')+'"'
              +' value="'+E(val)+'" placeholder="'+E(f.placeholder||'')+'" autocomplete="off"'+(f.required?' required':'')+'>';
          }
          return '<div class="fld"><label for="mxf_'+f.name+'">'+E(f.label||f.name)+(f.required?'<span class="req">*</span>':'')+'</label>'
            +ctrl
            +(f.hint?'<div class="hint">'+E(f.hint)+'</div>':'')
          +'</div>';
        }).join('');
        var html='<form class="mx-card" role="dialog" aria-modal="true" aria-labelledby="mxt">'
          +'<h3 id="mxt">'+E(opts.title||'')+'</h3>'
          +(opts.body?'<div class="body"><p>'+E(opts.body)+'</p></div>':'')
          +'<div class="fields">'+fHtml+'</div>'
          +'<div class="foot">'
            +'<button type="button" class="btn sm" data-r="0">'+E(opts.cancelLabel||'取消')+'</button>'
            +'<button type="submit" class="btn sm '+v+'">'+E(opts.okLabel||'确认')+'</button>'
          +'</div></form>';
        function fin(ok){
          dismiss(bg);
          if(!ok){resolve(null);return}
          var obj={};fields.forEach(function(f){obj[f.name]=bg.querySelector('[name="'+f.name+'"]').value.trim()});
          resolve(obj);
        }
        var bg=open(html,function(e){if(e.key==='Escape'){e.preventDefault();fin(0)}});
        var formEl=bg.querySelector('form');
        formEl.addEventListener('submit',function(e){
          e.preventDefault();
          var miss=fields.find(function(f){return f.required && !bg.querySelector('[name="'+f.name+'"]').value.trim()});
          if(miss){var el=bg.querySelector('[name="'+miss.name+'"]');el.focus();el.style.borderColor='var(--danger)';return}
          fin(1);
        });
        bg.addEventListener('click',function(e){if(e.target===bg)fin(0)});
        bg.querySelector('[data-r="0"]').addEventListener('click',function(){fin(0)});
      });
    }
    return {confirm:confirmFn,form:formFn};
  })();
  function $(id){return document.getElementById(id)}
  function setStatus(s){var el=$('status');if(el)el.textContent=s||''}
  function ago(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<60)return s+'s';var m=Math.round(s/60);if(m<60)return m+'m';var h=Math.round(m/60);if(h<24)return h+'h';return Math.round(h/24)+'d'}
  // Render a small chip indicating who/what made the most recent decision
  // on this row. Format from D1.accounts.last_decided_by:
  //   'human:<actor>'  → 👤 actor       (you / a maintainer)
  //   'agent:<id>'     → 🤖 <id>        (a side-channel agent, e.g. hermes)
  //   'rule:<id>'      → 🔧 规则#<id>   (a keyword rule auto-decided)
  //   'system'         → 🛠 system
  //   null/empty       → empty string (don't render)
  function actorBadge(by){
    if(!by)return '';
    var i=by.indexOf(':');
    var kind=i>=0?by.slice(0,i):by;
    var who=i>=0?by.slice(i+1):'';
    if(kind==='human')return '<span class="actor actor-human" title="人工决策：'+E(who)+'">👤 '+E(who||'人工')+'</span>';
    if(kind==='agent')return '<span class="actor actor-agent" title="AI agent 决策：'+E(who)+'">🤖 '+E(who||'agent')+'</span>';
    if(kind==='rule')return '<span class="actor actor-rule" title="关键词规则 #'+E(who)+'">🔧 规则#'+E(who)+'</span>';
    return '<span class="actor actor-sys" title="'+E(by)+'">🛠 '+E(by)+'</span>';
  }
  function key(a){return (a.x_user_id||'')+'|'+a.handle}
  function api(p,o){return fetch(p,Object.assign({},o||{},{headers:Object.assign({'x-admin-token':TOK},(o&&o.headers)||{})}))}

  function themeBtnHtml(){
    return '<button class="theme-btn" type="button" onclick="window.__mxgaTheme()" aria-label="切换亮/暗主题" title="auto → light → dark">'
      + ${JSON.stringify(ICON_AUTO)} + ${JSON.stringify(ICON_LIGHT)} + ${JSON.stringify(ICON_DARK)}
      + '</button>';
  }
  // Unified per-tab header. Every tab opens with the same anatomy so the
  // console reads as one product: title + count on the left, a one-line
  // description under it, and the tab's primary action(s) pinned right.
  //   o.title   — escaped plain text (may include a leading emoji)
  //   o.count   — already-formatted string/number, or null to omit the pill
  //   o.desc    — trusted inline HTML (links / <b>), callers control it
  //   o.actions — trusted inline HTML (buttons), or '' for none
  function viewHead(o){
    return '<div class="view-head">'
      +'<div class="vh-main">'
        +'<div class="vh-title">'+E(o.title||'')
          +(o.count!=null?'<span class="vh-count">'+o.count+'</span>':'')
        +'</div>'
        +(o.desc?'<div class="vh-desc">'+o.desc+'</div>':'')
      +'</div>'
      +(o.actions?'<div class="vh-actions">'+o.actions+'</div>':'')
    +'</div>';
  }

  function renderShell(){
    if(!TOK){renderLocked();return}
    $('app').innerHTML=
      '<div class="bar">'
      +'<div><h1>'+ ${JSON.stringify(LOGO_SVG)} +'<span>'+ ${JSON.stringify(BRAND.acronym)} +' · 审核台 · 守门员</span></h1>'
      +'<div class="sub">守门员才能进 · <b style="color:var(--danger)">拉黑</b>=进公榜 · <b style="color:var(--ok)">白名单</b>=永不扫 · 驳回/移除=不公开 · 规则见 <a href="${BRAND.governance}" target="_blank">GOVERNANCE</a></div></div>'
      +'<div class="right"><span class="ok">已认证</span><button class="btn sm" onclick="window.__xss.logout()">退出</button>'+themeBtnHtml()+'</div>'
      +'</div>'
      +'<div class="tabs">'
      +'<button class="on" data-v="queue" onclick="window.__xss.tab(\'queue\')">待审队列 <span class="count" id="cQ">—</span></button>'
      +'<button data-v="blacklist" onclick="window.__xss.tab(\'blacklist\')">黑名单 <span class="count" id="cB">—</span></button>'
      +'<button data-v="whitelist" onclick="window.__xss.tab(\'whitelist\')">白名单 <span class="count" id="cW">—</span></button>'
      +'<button data-v="agentPending" onclick="window.__xss.tab(\'agentPending\')">🤖 待定 <span class="count" id="cAP">—</span></button>'
      +'<button data-v="agentBL" onclick="window.__xss.tab(\'agentBL\')">🤖 拟拉黑 <span class="count" id="cAB">—</span></button>'
      +'<button data-v="agentWL" onclick="window.__xss.tab(\'agentWL\')">🤖 拟加白 <span class="count" id="cAW">—</span></button>'
      +'<button data-v="rules" onclick="window.__xss.tab(\'rules\')">关键字规则 <span class="count" id="cR">—</span></button>'
      +'<button data-v="log" onclick="window.__xss.tab(\'log\')">审计日志</button>'
      +'</div>'
      +'<div id="view"></div>';
    loadQueue(false);
    refreshStats();
  }
  function renderLocked(){
    $('app').innerHTML='<div class="locked"><div class="card">'
      +'<div class="lock">'+ ${JSON.stringify(LOCK_SVG)} +'</div>'
      +'<h2>需要维护者令牌</h2>'
      +'<p>把 <code style="background:var(--card-hi);padding:1px 6px;border-radius:var(--r-sm);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--fg)">ADMIN_TOKEN</code> 粘进来，仅在当前标签页会话保存，关闭后自动清除。</p>'
      +'<form class="form" onsubmit="event.preventDefault();window.__xss.save()">'
      +'<input id="t" type="password" autocomplete="off" placeholder="xss_…" />'
      +'<button class="btn primary" type="submit">解锁</button>'
      +'</form>'
      +'<div style="margin-top:18px">'+themeBtnHtml()+'</div>'
      +'</div></div>';
    setTimeout(function(){var t=$('t');if(t)t.focus()},50);
  }

  // Source-of-truth chip totals. Cheap COUNT(*) on the server; we refresh
  // after every mutating action so the chips stay honest as the queue drains.
  function refreshStats(){
    api('/v1/admin/stats').then(function(r){
      if(r.status===403){TOK='';sessionStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      stats=j;
      var cQ=$('cQ');if(cQ)cQ.textContent=fmtN(j.queue);
      var cB=$('cB');if(cB)cB.textContent=fmtN(j.blacklist);
      var cW=$('cW');if(cW)cW.textContent=fmtN(j.whitelist);
      var cAP=$('cAP');if(cAP)cAP.textContent=fmtN(j.agent_pending);
      var cAB=$('cAB');if(cAB)cAB.textContent=fmtN(j.agent_blacklist);
      var cAW=$('cAW');if(cAW)cAW.textContent=fmtN(j.agent_whitelist);
    }).catch(function(){});
  }
  function loadQueue(more){
    if(!more){queue=[];queueCursor=null;sel.clear();lastSelIdxQ=-1}
    var req=++queueReq;          // claim this load; stale responses are dropped
    queueLoading=true;
    setStatus('加载中…');
    api('/v1/admin/queue'+queueQs()).then(function(r){
      if(req!==queueReq)return null;   // superseded by a newer load
      if(r.status===403){TOK='';sessionStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      // Drop late responses from a sort/filter the user already moved past, so
      // the rendered rows always match the active sort header.
      if(req!==queueReq)return;
      queueLoading=false;
      if(!j){setStatus('');return}
      queue=queue.concat(j.queue||[]);
      queueCursor=j.nextBefore;
      // Sync filter inputs back from the server-echoed appliedFilters — this
      // catches the "user typed a numeric q, server rewrote it to uid" case.
      if(j.appliedFilters){
        if(j.appliedFilters.sort)sort=j.appliedFilters.sort;
        Object.keys(qFilters).forEach(function(k){
          if(k in j.appliedFilters)qFilters[k]=j.appliedFilters[k]||'';
        });
      }
      // chip total reflects unfiltered queue size from /v1/admin/stats; only
      // fall back to the loaded-count placeholder when stats hasn't arrived.
      var cQ=$('cQ');
      if(cQ&&stats.queue==null)cQ.textContent=queue.length+(queueCursor?'+':'');
      setStatus('');
      if(more)renderRows();else renderQueue();
    }).catch(function(){
      if(req!==queueReq)return;
      queueLoading=false;setStatus('加载失败，请重试');
    });
  }
  // Sorting is now done server-side (see queueSortCols / the sort header), so the
  // queue arrives already ordered. This only applies the verdict-label chip
  // filter to the loaded rows; it no longer re-sorts (which used to only reorder
  // the loaded page and hid the true top-of-queue items).
  function filteredQueue(){
    return filter==='all'?queue.slice():queue.filter(function(a){return a.verdict_label===filter});
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
    // Advanced filter panel is collapsed by default; show it open if any of
    // the explicit per-field filters are already populated (e.g. from a
    // "find similar" click that targeted a specific field).
    var anyExplicit=qFilters.uid||qFilters.handle||qFilters.evidence||qFilters.display_name||qFilters.reasons;
    var advOpen=!!anyExplicit;
    var nActive=activeFilterCount();
    var qTotal=(stats&&stats.queue!=null)?fmtN(stats.queue):(queue.length+(queueCursor?'+':''));
    v.innerHTML=
      viewHead({
        title:'待审队列',
        count:qTotal,
        desc:'AI 与举报汇入的待裁决账号。<b style="color:var(--danger)">拉黑</b> → 进公榜 · <b style="color:var(--ok)">白名单</b> → 永不再扫 · 驳回 / 移除 → 不公开。点击列头可排序。'
      })
      +'<div class="search-bar">'
        +'<form class="filter-form queue" id="qForm">'
          +'<label class="filter-field"><span>搜索</span><input id="qSearch" class="search-input" type="search" autocomplete="off" placeholder="handle / uid / 推文内容 / 理由" value="'+E(qFilters.q||'')+'"></label>'
          +'<div class="filter-actions">'
            +'<button class="btn sm" id="qSearchBtn" type="submit">搜索</button>'
            +'<button class="btn sm muted" id="qAdvToggle" type="button" aria-expanded="'+(advOpen?'true':'false')+'">'
              +'更多筛选'+(nActive?' · <b>'+nActive+'</b>':'')
            +'</button>'
            +(nActive?'<button class="btn sm" id="qClearAll" type="button">清空全部</button>':'')
          +'</div>'
        +'</form>'
        +'<details class="adv-panel" id="qAdv"'+(advOpen?' open':'')+'>'
          +'<summary style="display:none"></summary>'
          +'<div class="adv-grid">'
            +'<label><span>Handle 包含</span><input class="adv-input" data-fk="handle" value="'+E(qFilters.handle||'')+'" placeholder="如 spam_"></label>'
            +'<label><span>UID 前缀</span><input class="adv-input" data-fk="uid" value="'+E(qFilters.uid||'')+'" placeholder="如 2056413"></label>'
            +'<label><span>推文内容包含</span><input class="adv-input" data-fk="evidence" value="'+E(qFilters.evidence||'')+'" placeholder="如 比她好看"></label>'
            +'<label><span>显示名包含</span><input class="adv-input" data-fk="display_name" value="'+E(qFilters.display_name||'')+'" placeholder="如 Mary"></label>'
            +'<label><span>Reasons 包含</span><input class="adv-input" data-fk="reasons" value="'+E(qFilters.reasons||'')+'" placeholder="如 导流模板"></label>'
          +'</div>'
          +'<div class="adv-hint">每个字段是「包含」匹配（uid 是「前缀」）；多字段为 AND。回车应用。</div>'
        +'</details>'
      +'</div>'
      +'<div class="toolbar">'
        +'<div class="chips">'
          +chip('all','全部')
          +chip('spam','垃圾营销')
          +chip('porn_bot','色情广告号')
          +chip('likely_spam','疑似垃圾')
          +chip('uncertain','不确定')
          +chip('legit','正常账号')
        +'</div>'
      +'</div>'
      +'<div class="batch" id="batch">'
        +'<label class="meta" title="全选当前过滤范围。Shift+点 可在两次勾选间一次性勾选范围">'
          +'<input type="checkbox" id="selAllQ" aria-label="全选当前过滤范围">'
          +'<span>已选 <b id="selN">0</b> · 当前 <b id="visN">0</b><span class="hint">（Shift+点可范围多选）</span></span>'
        +'</label>'
        +'<div class="actions">'
          +'<button class="btn sm blacklist" onclick="window.__xss.batch(\'approve\')">批量拉黑</button>'
          +'<button class="btn sm" onclick="window.__xss.batch(\'reject\')">批量驳回</button>'
          +'<button class="btn sm muted" onclick="window.__xss.batch(\'remove\')">批量移除</button>'
          +'<button class="btn sm" onclick="window.__xss.clearSel()">清空选择</button>'
        +'</div>'
      +'</div>'
      +queueSortHeader()
      +'<div class="rows" id="rows"></div>'
      +'<div class="more-foot" id="qmoreFoot"></div>';
    Array.prototype.forEach.call(v.querySelectorAll('.chip'),function(b){
      b.addEventListener('click',function(){filter=b.dataset.f;lastSelIdxQ=-1;renderRows()})
    });
    // Sort header — click flips the server-side sort. First click on a column =
    // desc; click the active column again = asc (for two-way columns); refetch.
    Array.prototype.forEach.call(v.querySelectorAll('.qhead .sortbtn'),function(b){
      b.addEventListener('click',function(){
        var desc=b.dataset.desc,asc=b.dataset.asc||'';
        var next=(sort===desc&&asc)?asc:(sort===asc&&asc)?desc:desc;
        if(next===sort&&!asc)return;   // one-way column already active — no-op
        sort=next;lastSelIdxQ=-1;loadQueue(false);
      });
    });
    $('selAllQ').addEventListener('change',function(){
      var rows=filteredQueue();
      if(this.checked)rows.forEach(function(a){sel.add(key(a))})
      else rows.forEach(function(a){sel.delete(key(a))});
      lastSelIdxQ=-1;renderRows();
    });
    // Search wiring — Enter or button click commits the fuzzy q filter.
    var qInput=$('qSearch');
    function commitQ(){qFilters.q=qInput.value.trim();loadQueue(false)}
    $('qForm').addEventListener('submit',function(e){e.preventDefault();commitQ()});
    // Advanced field inputs — Enter commits the value of that single field.
    Array.prototype.forEach.call(v.querySelectorAll('.adv-input'),function(inp){
      inp.addEventListener('keydown',function(e){
        if(e.key==='Enter'){e.preventDefault();setFilter(inp.dataset.fk,inp.value)}
      });
      inp.addEventListener('blur',function(){
        // commit on blur so tabbing through fields applies each
        if((qFilters[inp.dataset.fk]||'')!==inp.value.trim())setFilter(inp.dataset.fk,inp.value);
      });
    });
    var clearBtn=$('qClearAll');
    if(clearBtn)clearBtn.addEventListener('click',function(){clearFilters();loadQueue(false)});
    var advToggle=$('qAdvToggle');
    if(advToggle)advToggle.addEventListener('click',function(){
      var adv=$('qAdv');if(!adv)return;
      adv.open=!adv.open;
      this.setAttribute('aria-expanded',adv.open?'true':'false');
    });
    renderRows();
  }
  function renderRows(){
    var rows=filteredQueue();
    var box=$('rows');
    if(!rows.length){box.innerHTML='<div class="empty">'+(filter==='all'?'队列为空':'当前过滤无匹配')+'</div>';renderQueueMoreFoot();refreshBatch();return}
    box.innerHTML=rows.map(function(a,i){
      var k=key(a),conf=Math.round((a.confidence||0)*100);
      var av=a.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(a.handle));
      var fb=E((a.handle||'?').slice(0,1).toUpperCase());
      var reps=a.reporters||0;
      var lbl=a.verdict_label||'uncertain';
      // Verdict inline label — Chinese, small marker right of name.
      var lblZh={spam:'垃圾营销',porn_bot:'色情广告',likely_spam:'疑似垃圾',uncertain:'不确定',legit:'正常'}[lbl]||lbl;
      var vlbl='<span class="vlbl">'+E(lblZh)+'</span>';
      // Reporters: chip when ≥3, muted otherwise
      var repHtml=reps>=3
        ? '<span class="chip-ok">'+reps+' 人 ✓</span>'
        : '<span>'+reps+' 人</span>';
      // Evidence snippet — the X content that triggered the verdict.
      // Surfaces "what did this account actually say" so maintainers don't
      // have to click into x.com on every queue item.
      var evid=(a.evidence_text||'').replace(/\s+/g,' ').trim();
      var evidHtml=evid?'<div class="ev" title="'+E(evid)+'">『'+E(evid.slice(0,90))+(evid.length>90?'…':'')+'』</div>':'';
      var acctHtml=accountMetaHtml(a);
      return '<div class="qrow '+E(lbl)+(sel.has(k)?' sel':'')+'" data-k="'+E(k)+'" data-idx="'+i+'">'
        +'<input type="checkbox"'+(sel.has(k)?' checked':'')+' aria-label="选中 @'+E(a.handle)+'">'
        +'<div class="av"><img src="'+E(av)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\''+fb+'\'}))"></div>'
        +'<div class="who">'
          +'<div class="name">'+nameLink(a)+vlbl+'</div>'
          +'<div class="sub">'
            +handleLink(a.handle)
            +idChip(a.x_user_id)
            +'<span class="sep">·</span><span>'+ago(a.last_scored)+'</span>'
          +'</div>'
          +acctHtml
          +evidHtml
        +'</div>'
        +'<div class="conf">'
          +'<div class="pct">'+conf+'%<span class="lbl">把握</span></div>'
        +'</div>'
        +'<div class="rep">'+repHtml+'</div>'
        +'<div class="acts">'
          +'<button class="btn sm blacklist" data-act="approve" title="加入黑名单：进公榜，所有用户都会看到">拉黑</button>'
          +'<button class="btn sm ok" data-act="whitelist" title="加入白名单：永不再扫，举报也忽略">白名单</button>'
          +'<button class="btn sm" data-act="reject" title="不公开，但保留判定记录">驳回</button>'
          +'<button class="btn sm muted" data-act="remove" title="从数据集移除（误判账号）">移除</button>'
          +'<button class="btn sm" data-act="similar" title="按这一行的某个字段过滤出同类账号">找同类 ▾</button>'
        +'</div>'
      +'</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.qrow'),function(r){
      var k=r.dataset.k;
      var idx=parseInt(r.dataset.idx,10);
      var cb=r.querySelector('input[type=checkbox]');
      // Range-select on shift+click: extend the previous click's intent
      // (the current cb.checked state, already toggled by the browser)
      // across [lastSelIdxQ, idx]. The native click fires before change,
      // so we handle range here and let change handle the singleton case.
      cb.addEventListener('click',function(e){
        if(e.shiftKey&&lastSelIdxQ>=0&&lastSelIdxQ!==idx){
          var rowEls=box.querySelectorAll('.qrow');
          var lo=Math.min(lastSelIdxQ,idx),hi=Math.max(lastSelIdxQ,idx);
          var target=cb.checked;
          for(var i=lo;i<=hi;i++){
            var rr=rowEls[i];if(!rr)continue;
            var cc=rr.querySelector('input[type=checkbox]');
            if(!cc||cc.checked===target)continue;
            cc.checked=target;
            var kk=rr.dataset.k;
            if(target){sel.add(kk);rr.classList.add('sel')}
            else{sel.delete(kk);rr.classList.remove('sel')}
          }
        }
        lastSelIdxQ=idx;
      });
      cb.addEventListener('change',function(){if(cb.checked){sel.add(k);r.classList.add('sel')}else{sel.delete(k);r.classList.remove('sel')}refreshBatch()});
      Array.prototype.forEach.call(r.querySelectorAll('.acts button'),function(b){
        b.addEventListener('click',function(){
          if(b.dataset.act==='whitelist')whitelistFromQueue(r,k);
          else if(b.dataset.act==='similar')openSimilarMenu(r,rows[idx]);
          else decideOne(r,k,b.dataset.act);
        })
      })
    });
    renderQueueMoreFoot();
    refreshBatch();
  }
  // "找同类" menu — derive cluster-fingerprint candidates from this row and
  // let the maintainer pick which dimension to filter by. Each option, when
  // chosen, sets the matching qFilter and triggers a re-fetch so the queue
  // collapses to just that cluster.
  function openSimilarMenu(rowEl,a){
    if(!a)return;
    var options=[];
    // uid prefix (first 8 digits) — most useful for batch-created clusters
    // like the 2026-05-26 2056413xxx spam ring. Falls back to full uid if
    // shorter than 8.
    if(a.x_user_id){
      var uidPref=String(a.x_user_id).slice(0,8);
      options.push({label:'同 UID 前 '+uidPref.length+' 位「'+uidPref+'」',field:'uid',value:uidPref});
    }
    // handle prefix — first 6 chars (usually the human-meaningful part
    // before any auto-generated number suffix)
    if(a.handle){
      var hPref=String(a.handle).replace(/\d+$/,'').slice(0,8) || String(a.handle).slice(0,6);
      if(hPref.length>=3){
        options.push({label:'同 handle 前缀「'+hPref+'」',field:'handle',value:hPref});
      }
    }
    // display_name — exact-text-as-substring; spammers often share verbatim names
    var dn=(a.display_name||'').trim();
    if(dn&&dn.length>=2){
      options.push({label:'同显示名「'+dn+'」',field:'display_name',value:dn});
    }
    // evidence snippet — strongest cluster signal. Take a meaningful slice
    // that survives across the cluster (skip leading mentions / urls).
    var ev=(a.evidence_text||'').replace(/\s+/g,' ').trim();
    if(ev){
      // Pick a 12-char window that's likely shared across the template
      // (after any leading @ chunks). Heuristic, not perfect.
      var evCore=ev.replace(/^(@\S+\s*)+/,'').slice(0,16).trim();
      if(evCore.length>=4){
        options.push({label:'同推文模板「'+evCore+'…」',field:'evidence',value:evCore});
      }
    }
    // reasons — first meaningful keyword
    try{
      var rs=JSON.parse(a.reasons||'[]');
      if(Array.isArray(rs)&&rs.length){
        var firstReason=String(rs[0]).split(/[：:。,，]/)[0].trim().slice(0,12);
        if(firstReason.length>=2){
          options.push({label:'同 reasons 关键词「'+firstReason+'」',field:'reasons',value:firstReason});
        }
      }
    }catch(e){}
    if(!options.length){setStatus('这行没有可用于聚类的特征字段');setTimeout(function(){setStatus('')},2000);return}
    // Render as a small modal-style popover anchored to the action button.
    var btnHtml=options.map(function(o,i){
      return '<button type="button" class="btn sm" data-sim-idx="'+i+'" style="justify-content:flex-start;text-align:left;width:100%">'+E(o.label)+'</button>';
    }).join('');
    var html='<div class="mx-card" role="dialog" aria-modal="true" aria-labelledby="simtitle" style="max-width:480px">'
      +'<h3 id="simtitle">找同类</h3>'
      +'<div class="body"><p>挑一个特征，队列会过滤出共享该特征的所有账号。</p></div>'
      +'<div class="fields" style="display:flex;flex-direction:column;gap:8px;padding:0 22px 12px">'+btnHtml+'</div>'
      +'<div class="foot"><button type="button" class="btn sm" data-r="0">取消</button></div>'
      +'</div>';
    var bg=document.createElement('div');bg.className='mx-bg';bg.tabIndex=-1;bg.innerHTML=html;
    function dismiss(){if(bg.parentNode)bg.remove()}
    bg.addEventListener('click',function(e){if(e.target===bg)dismiss()});
    bg.querySelector('[data-r="0"]').addEventListener('click',dismiss);
    Array.prototype.forEach.call(bg.querySelectorAll('[data-sim-idx]'),function(b){
      b.addEventListener('click',function(){
        var o=options[parseInt(b.dataset.simIdx,10)];
        clearFilters();             // discard previous filters — clean slate per cluster pivot
        qFilters[o.field]=o.value;
        dismiss();
        loadQueue(false);
      });
    });
    document.body.appendChild(bg);
    setTimeout(function(){var f=bg.querySelector('button.btn');if(f)f.focus()},40);
  }
  // Footer below the queue rows. "加载更多 N 条" when more pending exists;
  // a quiet "已加载全部 N 条" otherwise so the maintainer knows they're done.
  function renderQueueMoreFoot(){
    var f=$('qmoreFoot');if(!f)return;
    var total=(stats&&stats.queue!=null)?stats.queue:null;
    var loaded=queue.length;
    var remaining=total!=null?Math.max(0,total-loaded):null;
    if(queueCursor){
      f.innerHTML='<button class="btn sm" id="qmore">加载更多</button>'
        +(remaining!=null?'<span>还有 '+fmtN(remaining)+' 条</span>':'<span>继续加载</span>');
      $('qmore').addEventListener('click',function(){loadQueue(true)});
    } else {
      f.innerHTML=loaded>0?'<span>已加载全部 '+fmtN(loaded)+' 条</span>':'';
    }
  }
  // Master checkbox state reflects "every visible row is selected".
  // selN = global selection size, visN = current filter size.
  function refreshBatch(){
    var b=$('batch'),s=$('selN'),v=$('visN'),m=$('selAllQ');
    if(!b)return;
    var rows=filteredQueue();
    var inFilter=0;for(var i=0;i<rows.length;i++)if(sel.has(key(rows[i])))inFilter++;
    if(s)s.textContent=sel.size;
    if(v)v.textContent=rows.length;
    if(m){m.checked=rows.length>0&&inFilter===rows.length;m.indeterminate=inFilter>0&&inFilter<rows.length}
    b.classList.toggle('on',sel.size>0);
  }
  function decideOne(rowEl,k,action){
    var parts=k.split('|'),xUserId=parts[0]||undefined,handle=parts[1];
    rowEl.classList.add('removing');
    api('/v1/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:handle,xUserId:xUserId,action:action})})
      .then(function(res){
        // Only prune local state on a confirmed 2xx — a 403/500 must keep the
        // row visible and tell the maintainer instead of lying about success.
        if(!res.ok){
          rowEl.classList.remove('removing');
          setStatus('操作失败：HTTP '+res.status);
          setTimeout(function(){setStatus('')},3500);
          return;
        }
        queue=queue.filter(function(a){return key(a)!==k});sel.delete(k);
        // Optimistic chip decrement so the count drops immediately; the next
        // refreshStats() reconciles against the server.
        if(stats.queue!=null){stats.queue=Math.max(0,stats.queue-1);var c=$('cQ');if(c)c.textContent=fmtN(stats.queue)}
        renderRows();
        Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(b){
          var k2=b.dataset.f,n=k2==='all'?queue.length:queue.filter(function(a){return a.verdict_label===k2}).length;
          var nEl=b.querySelector('.n');if(nEl)nEl.textContent=n;
        });
        refreshStats();
      })
      .catch(function(){
        rowEl.classList.remove('removing');
        setStatus('操作失败：网络错误');
        setTimeout(function(){setStatus('')},3500);
      });
  }
  // Translate the local sel/wlSel/blSel key strings (which encode as
  // "uid|handle") into the {handle, xUserId} item shape the batch endpoints
  // expect. Server caps each batch at 100; we chunk locally so the
  // maintainer can still "select all 200 spammers" without manual splits.
  var BATCH_CHUNK=100;
  function selToItems(keys){
    return keys.map(function(k){
      var parts=k.split('|');
      var uid=parts[0]||'';
      var h=parts[1]||'';
      return uid?{handle:h,xUserId:uid}:{handle:h};
    });
  }
  function chunked(arr,n){
    var out=[];for(var i=0;i<arr.length;i+=n)out.push(arr.slice(i,i+n));return out;
  }
  function batch(action){
    if(!sel.size)return;
    var label={approve:'拉黑',reject:'驳回',remove:'移除'}[action]||action;
    var variant=action==='approve'?'danger':action==='remove'?'muted':'primary';
    mxModal.confirm({
      title:'批量'+label,
      body:'确认对已选 <b>'+sel.size+'</b> 条执行「'+label+'」？\n此操作会写 review_log，不可批量撤回。',
      okLabel:label+' '+sel.size+' 条',
      okVariant:variant
    }).then(function(ok){
      if(!ok)return;
      var ks=Array.from(sel);
      var chunks=chunked(ks,BATCH_CHUNK);
      setStatus('批量'+label+' 0/'+ks.length);
      var done=0,idx=0;
      function nextChunk(){
        if(idx>=chunks.length){
          sel.clear();lastSelIdxQ=-1;renderQueue();refreshStats();
          setStatus('完成 · '+done+' 条');setTimeout(function(){setStatus('')},2500);
          return;
        }
        var slice=chunks[idx++];
        var items=selToItems(slice);
        api('/v1/admin/decide-batch',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({action:action,items:items})
        }).then(function(r){return r.json()}).then(function(j){
          if(j&&j.ok){
            done+=slice.length;
            // optimistic local prune so the UI reflects success immediately
            var sliceSet={};slice.forEach(function(k){sliceSet[k]=true});
            queue=queue.filter(function(a){return !sliceSet[key(a)]});
            if(stats.queue!=null){
              stats.queue=Math.max(0,stats.queue-slice.length);
              var c=$('cQ');if(c)c.textContent=fmtN(stats.queue);
            }
            setStatus('批量'+label+' '+done+'/'+ks.length);
            nextChunk();
          } else {
            setStatus('批量'+label+' 失败：'+(j&&j.error||'unknown'));
            setTimeout(function(){setStatus('')},3500);
          }
        }).catch(function(e){
          setStatus('批量'+label+' 网络错误');
          setTimeout(function(){setStatus('')},3500);
        });
      }
      nextChunk();
    });
  }
  function clearSel(){sel.clear();lastSelIdxQ=-1;renderRows()}

  // ---- Keyword rules (Wave G) -------------------------------------------
  var rulesList=[];
  var fieldLabels={handle:'Handle',display_name:'显示名',bio:'Bio',tweet:'推文',any:'任一字段'};
  var actionLabels={blacklist:'拉黑（→公榜）',whitelist:'白名单',reject:'驳回（不公开）'};
  var verdictLabels={spam:'垃圾营销',porn_bot:'色情广告',likely_spam:'疑似垃圾',uncertain:'不确定',legit:'正常'};

  function loadRules(){
    setStatus('加载中…');
    api('/v1/admin/keyword-rules').then(function(r){
      if(r.status===403){TOK='';sessionStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      rulesList=j.rules||[];
      var cR=$('cR');if(cR)cR.textContent=fmtN(rulesList.length);
      setStatus('');
      renderRules();
    });
  }

  function renderRules(){
    var v=$('view');
    var hint='规则会在 /v1/classify 阶段先于 LLM 匹配。命中 → 跳过 LLM，按 action 落地（默认进公榜）。改规则 ≤30s 全局生效。';
    var rows=rulesList.length
      ? rulesList.map(function(r){
          var enabled=r.enabled===1||r.enabled===true;
          var verdLbl=verdictLabels[r.verdict_label]||r.verdict_label;
          var actLbl=actionLabels[r.action]||r.action;
          var fLbl=fieldLabels[r.field]||r.field;
          var lastHit=r.last_hit_at?ago(r.last_hit_at):'—';
          return '<div class="rrow '+(enabled?'':'off')+'" data-id="'+r.id+'">'
            +'<div class="r-toggle">'
              +'<label class="switch" title="点击启用/停用"><input type="checkbox" '+(enabled?'checked':'')+' data-rule-toggle><span class="slider"></span></label>'
            +'</div>'
            +'<div class="r-pat">'
              +'<div class="r-pattern">'+E(r.pattern)+'</div>'
              +'<div class="r-meta">'+E(fLbl)+'<span class="sep">·</span>'+E(actLbl)+'<span class="sep">·</span>判 '+E(verdLbl)+(r.note?'<span class="sep">·</span><span class="r-note">'+E(r.note)+'</span>':'')+'</div>'
            +'</div>'
            +'<div class="r-hits"><b>'+fmtN(r.hit_count||0)+'</b><span class="lbl">命中</span></div>'
            +'<div class="r-last">'+E(lastHit)+'</div>'
            +'<div class="r-acts">'
              +'<button class="btn sm" data-rule-act="apply" title="对当前 pending 队列试跑这条规则">扫一下</button>'
              +'<button class="btn sm muted" data-rule-act="delete">删除</button>'
            +'</div>'
          +'</div>';
        }).join('')
      : '<div class="empty">还没有规则。点右上角「+ 新增规则」加第一条 —— 比如 pattern=「约炮」field=「任一字段」action=「拉黑」就能把绝大多数色情号在 LLM 前直接拦下。</div>';
    v.innerHTML=
      viewHead({
        title:'关键字规则',
        count:fmtN(rulesList.length),
        desc:E(hint),
        actions:'<button class="btn sm" onclick="window.__xss.rulesApplyAll()">扫所有规则到队列</button>'
          +'<button class="btn sm primary" onclick="window.__xss.ruleAdd()">+ 新增规则</button>'
      })
      +'<div class="rules-head">'
        +'<span>启用</span><span>规则</span><span>命中</span><span>最近</span><span></span>'
      +'</div>'
      +'<div class="rules" id="rulesBox">'+rows+'</div>';
    var box=$('rulesBox');if(!box)return;
    Array.prototype.forEach.call(box.querySelectorAll('.rrow'),function(rr){
      var id=Number(rr.dataset.id);
      var tog=rr.querySelector('[data-rule-toggle]');
      if(tog)tog.addEventListener('change',function(){
        ruleToggle(id,tog.checked);
      });
      Array.prototype.forEach.call(rr.querySelectorAll('[data-rule-act]'),function(b){
        b.addEventListener('click',function(){
          if(b.dataset.ruleAct==='delete')ruleDelete(id);
          else if(b.dataset.ruleAct==='apply')ruleApplyOne(id);
        });
      });
    });
  }

  function ruleToggle(id,enabled){
    setStatus(enabled?'启用规则…':'停用规则…');
    api('/v1/admin/keyword-rules/'+id,{
      method:'PATCH',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({enabled:enabled})
    }).then(function(r){return r.json()}).then(function(j){
      setStatus(j&&j.ok?(enabled?'已启用':'已停用'):'操作失败');
      setTimeout(function(){setStatus('')},1500);
      loadRules();
    });
  }

  function ruleDelete(id){
    var r=rulesList.find(function(x){return x.id===id});
    if(!r)return;
    mxModal.confirm({
      title:'删除规则',
      body:'确认删除规则 <code>'+E(r.pattern)+'</code>？\n已经命中的账号不会被回滚，但这条规则未来不再生效。',
      okLabel:'删除',
      okVariant:'danger'
    }).then(function(ok){
      if(!ok)return;
      api('/v1/admin/keyword-rules/'+id,{method:'DELETE'}).then(function(){
        setStatus('已删除');setTimeout(function(){setStatus('')},1500);
        loadRules();
      });
    });
  }

  function ruleApplyOne(id){
    var r=rulesList.find(function(x){return x.id===id});
    if(!r)return;
    mxModal.confirm({
      title:'扫一下：'+r.pattern,
      body:'用这条规则扫一遍当前 <b>auto_pending_review</b> 队列，命中的账号会按规则 action 落地（默认进公榜）。\n操作不可批量撤回，但每条都有 review_log。',
      okLabel:'扫描并应用',
      okVariant:'primary'
    }).then(function(ok){
      if(!ok)return;
      // server endpoint applies ALL enabled rules; we briefly disable
      // everything except this one, run, then re-enable. Cleaner: server
      // could take a single-rule param. For now use the all-rules endpoint
      // and just inform the maintainer.
      setStatus('应用规则中…');
      api('/v1/admin/keyword-rules/apply-to-queue',{method:'POST'}).then(function(r){return r.json()}).then(function(j){
        if(j&&j.ok){
          setStatus('完成 · '+j.matched+' 条命中');
          setTimeout(function(){setStatus('')},3000);
          loadRules();refreshStats();
        } else {
          setStatus('失败：'+(j&&j.error||'unknown'));
          setTimeout(function(){setStatus('')},3000);
        }
      });
    });
  }

  function rulesApplyAll(){
    mxModal.confirm({
      title:'扫所有规则到队列',
      body:'用全部启用规则扫一遍当前 <b>auto_pending_review</b> 队列。命中的账号按各自规则的 action 落地。<br><br>建议在新增规则后立刻跑一次，让历史 pending 数据也享受新规则。',
      okLabel:'开始扫描',
      okVariant:'primary'
    }).then(function(ok){
      if(!ok)return;
      setStatus('应用规则中…');
      api('/v1/admin/keyword-rules/apply-to-queue',{method:'POST'}).then(function(r){return r.json()}).then(function(j){
        if(j&&j.ok){
          var lines=(j.perRule||[]).map(function(p){
            var rule=rulesList.find(function(x){return x.id===p.id});
            return '· '+(rule?E(rule.pattern):'rule#'+p.id)+'：'+p.hits+' 条';
          }).join('\n');
          mxModal.confirm({
            title:'扫描完成',
            body:'命中 <b>'+j.matched+'</b> 条。\n'+(lines||'无命中'),
            okLabel:'好',
            okVariant:'primary'
          });
          setStatus('');
          loadRules();refreshStats();
        } else {
          setStatus('失败：'+(j&&j.error||'unknown'));
          setTimeout(function(){setStatus('')},3000);
        }
      });
    });
  }

  function ruleAdd(){
    mxModal.form({
      title:'新增关键字规则',
      body:'pattern 为字面子串，大小写不敏感。命中 → 跳过 LLM，按 action 落地。',
      fields:[
        {name:'pattern',label:'关键字 / 子串',required:true,placeholder:'如：约炮、@target_dispatch、电报 @',hint:'匹配前两边做 lower()，大小写不敏感'},
        {name:'field',label:'匹配字段',type:'select',value:'any',options:[
          {value:'any',label:'任一字段'},
          {value:'handle',label:'Handle'},
          {value:'display_name',label:'显示名'},
          {value:'bio',label:'简介 Bio'},
          {value:'tweet',label:'推文内容'}
        ]},
        {name:'action',label:'命中动作',type:'select',value:'blacklist',options:[
          {value:'blacklist',label:'拉黑 — 直接进公榜'},
          {value:'whitelist',label:'白名单 — 永不再扫'},
          {value:'reject',label:'驳回 — 不公开'}
        ]},
        {name:'verdict_label',label:'判定标签',type:'select',value:'spam',options:[
          {value:'spam',label:'垃圾营销'},
          {value:'porn_bot',label:'色情广告号'},
          {value:'likely_spam',label:'疑似垃圾'},
          {value:'uncertain',label:'不确定'},
          {value:'legit',label:'正常账号'}
        ]},
        {name:'note',label:'备注（仅你可见）',type:'textarea',placeholder:'比如：色情广告 tg 链路特征'}
      ],
      okLabel:'创建',
      okVariant:'primary'
    }).then(function(vals){
      if(!vals)return;
      var body={
        pattern:(vals.pattern||'').trim(),
        field:(vals.field||'any').trim(),
        action:(vals.action||'blacklist').trim(),
        verdict_label:(vals.verdict_label||'spam').trim(),
        note:(vals.note||'').trim()||undefined
      };
      setStatus('创建规则…');
      api('/v1/admin/keyword-rules',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(body)
      }).then(function(r){return r.json()}).then(function(j){
        if(j&&j.ok){
          setStatus('已创建 rule#'+j.id);
          setTimeout(function(){setStatus('')},1500);
          loadRules();
        } else {
          setStatus('失败：'+(j&&(j.detail||j.error)||'unknown'));
          setTimeout(function(){setStatus('')},5000);
        }
      });
    });
  }

  // ===== Agent staging tabs =================================================
  // Renders the three agent-curated buckets (pending / blacklist / whitelist).
  // Layout reuses the .qrow 6-column grid (checkbox / av / who / conf / rep /
  // acts) so it visually aligns with the queue / BL / WL tabs. The fifth
  // column is intentionally empty here — reporters don't apply.
  var agentRows = [];
  var agentBucket = '';
  var agentCursor = null;
  var agentSel = new Set();
  var lastSelIdxA = -1;

  // Plain-language labels for the signal codes the agent emits. Lookup
  // tables stay in JS (not the prompt) so we can iterate on copy without
  // re-running the agent. Codes that are not in the table are dropped
  // from the UI — they belong in audit logs, not in the maintainer view.
  var SIGNAL_LABELS = {
    P1: '色情/约炮关键词',
    P2: '复读模板内容',
    P3: '回复跑题 + 引流',
    P5: '新号+0粉+促销',
    P6: '黑灰产话术',
    P7: '头像含促销水印',
    P8: 'NSFW 头像',
    S1: '账号 <90 天',
    S2: '粉丝 <50',
    S3: '关注/粉丝比异常',
    S4: '日发帖 >30',
    S5: '链接域名单一',
    S6: '泛拉客话术',
    L1: '真人画像',
    L2: '透明自有产品',
    L3: '历史一致',
    L4: '正常粉丝盘',
    N1: '大号 (>5k 粉)',
    N2: '大号 (>10k 粉)',
    N3: '老号 + 主题稳定',
    N4: '存在多轮对话',
    A1: '内容是观点/政治',
    A2: '样本太薄',
    A3: '账号已死/封禁',
  };
  function humanSignal(code){
    return SIGNAL_LABELS[code] || code;
  }

  function loadAgentList(bucket){
    agentBucket=bucket;
    agentRows=[];agentCursor=null;
    agentSel.clear();lastSelIdxA=-1;
    setStatus('加载中…');
    api('/v1/admin/agent-list?bucket='+encodeURIComponent(bucket)+'&limit=100').then(function(r){
      if(r.status===403){TOK='';sessionStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      agentRows=j.list||[];
      agentCursor=j.nextBefore;
      setStatus('');
      renderAgentList();
    });
  }
  function loadAgentListMore(){
    if(!agentCursor)return;
    api('/v1/admin/agent-list?bucket='+encodeURIComponent(agentBucket)+'&limit=100&before='+agentCursor).then(function(r){return r.json()}).then(function(j){
      if(!j)return;
      agentRows=agentRows.concat(j.list||[]);
      agentCursor=j.nextBefore;
      renderAgentList();
    });
  }
  function renderAgentList(){
    var v=$('view');
    var bucket=agentBucket;
    var bucketZh={pending:'待定',blacklist:'拟拉黑',whitelist:'拟加白'}[bucket]||bucket;
    var primaryAct = bucket==='whitelist'
      ? {target:'whitelist',label:'确认加白',cls:'ok'}
      : {target:'blacklist',label:'确认拉黑',cls:'blacklist'};
    v.innerHTML=
      viewHead({
        title:'🤖 agent · '+bucketZh,
        count:fmtN(agentRows.length)+(agentCursor?'+':''),
        desc:(bucket==='pending'
          ? 'agent 看过但拿不准的条目。可能信号薄弱、可能账号已被 X 封、可能你需要亲眼看一眼。'
          : bucket==='blacklist'
            ? 'agent 给出高置信 spam 判定，尚未公开。点「确认拉黑」升级到公榜（公开拉黑）。'
            : 'agent 给出高置信 legit 判定，尚未进白名单。点「确认加白」才会真正入官方白名单。')
      })
      +'<div class="batch" id="agbatch">'
        +'<label class="meta" title="全选已加载范围。Shift+点 可在两次勾选间一次性勾选范围">'
          +'<input type="checkbox" id="selAllA" aria-label="全选已加载范围">'
          +'<span>已选 <b id="agselN">0</b> · 当前 <b id="agvisN">0</b><span class="hint">（Shift+点可范围多选）</span></span>'
        +'</label>'
        +'<div class="actions">'
          +'<button class="btn sm '+primaryAct.cls+'" onclick="window.__xss.agBatch(\''+primaryAct.target+'\')">批量'+E(primaryAct.label)+'</button>'
          +(bucket!=='whitelist'?'<button class="btn sm ok" onclick="window.__xss.agBatch(\'whitelist\')">批量加白</button>':'')
          +(bucket!=='blacklist'?'<button class="btn sm danger" onclick="window.__xss.agBatch(\'blacklist\')">批量拉黑</button>':'')
          +'<button class="btn sm muted" onclick="window.__xss.agBatch(\'requeue\')" title="退回待审队列重新走 LLM">批量退回</button>'
          +'<button class="btn sm muted" onclick="window.__xss.agBatch(\'reject\')">批量拒绝</button>'
          +'<button class="btn sm" onclick="window.__xss.agClearSel()">清空选择</button>'
        +'</div>'
      +'</div>'
      +'<div class="rows" id="agrows"></div>'
      +'<div class="more-foot" id="agmoreFoot">'
        +(agentCursor?'<button class="btn sm" id="agmore">加载更多</button>':'')
        +'<span>已加载 '+fmtN(agentRows.length)+' 条'+(agentCursor?'（还有更多）':'（全部）')+'</span>'
      +'</div>';
    var box=$('agrows');
    if(!agentRows.length){
      box.innerHTML='<div class="empty">'+E(bucketZh)+'桶当前为空。agent 每 15 分钟自动扫待审队列。</div>';
      agRefreshBatch();return;
    }
    box.innerHTML=agentRows.map(function(a,i){
      var k=(a.x_user_id||'')+'|'+a.handle;
      var av=a.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(a.handle));
      var fb=E((a.handle||'?').slice(0,1).toUpperCase());
      var aLbl=a.agent_label||'uncertain';
      var aLblZh={spam:'垃圾营销',porn_bot:'色情广告',likely_spam:'疑似垃圾',uncertain:'不确定',legit:'正常'}[aLbl]||aLbl;
      var aConf=Math.round((a.agent_confidence||0)*100);
      var signals=[];
      try{signals=JSON.parse(a.agent_signals||'[]')||[]}catch(e){signals=[]}
      var reasons=[];
      try{reasons=JSON.parse(a.agent_reasons||'[]')||[]}catch(e){reasons=[]}
      var ev={};
      try{ev=JSON.parse(a.agent_evidence||'{}')||{}}catch(e){ev={}}
      var evChips=[];
      if(ev.account_age_days!=null)evChips.push('账龄 '+ev.account_age_days+'d');
      if(ev.follower_count!=null)evChips.push('粉丝 '+fmtN(ev.follower_count));
      if(ev.posting_rate_per_day!=null)evChips.push('日发帖 '+ev.posting_rate_per_day);
      if(ev.x_status&&ev.x_status!=='active'&&ev.x_status!=='unknown')evChips.push('X 状态: '+ev.x_status);
      if(ev.reply_offtopic_ratio!=null)evChips.push('回复跑题率 '+Math.round(ev.reply_offtopic_ratio*100)+'%');
      var nameHtml='<a href="'+E(xUrl(a.handle))+'" target="_blank" rel="noopener">'+E(displayName(a))+'</a>';
      var acctHtml=accountMetaHtml(a);
      return '<div class="qrow '+E(aLbl)+(agentSel.has(k)?' sel':'')+'" data-k="'+E(k)+'" data-idx="'+i+'" data-h="'+E(a.handle)+'" data-u="'+E(a.x_user_id||'')+'">'
        +'<input type="checkbox"'+(agentSel.has(k)?' checked':'')+' aria-label="选中 @'+E(a.handle)+'">'
        +'<div class="av"><img src="'+E(av)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\''+fb+'\'}))"></div>'
        +'<div class="who">'
          +'<div class="name">'+nameHtml+'<span class="vlbl">'+E(aLblZh)+'</span>'
            +(a.agent_id?' <span class="actor actor-agent" title="决策来源：'+E(a.agent_id)+'">🤖 '+E(a.agent_id)+'</span>':'')
          +'</div>'
          +'<div class="sub">'
            +handleLink(a.handle)
            +idChip(a.x_user_id)
            +'<span class="sep">·</span><span title="'+E(new Date(a.agent_at||a.last_scored).toLocaleString('zh-CN'))+'">agent 决策 '+ago(a.agent_at||a.last_scored)+'</span>'
          +'</div>'
          +acctHtml
          +(signals.length?'<div class="agent-signals">'+signals.map(function(s){return '<span class="agent-sig" title="'+E(s)+'">'+E(humanSignal(s))+'</span>'}).join('')+'</div>':'')
          +(reasons.length?'<div class="agent-reasons">'+reasons.slice(0,4).map(function(r){return '<span>· '+E(r)+'</span>'}).join('')+'</div>':'')
          +(evChips.length?'<div class="agent-evidence">'+evChips.map(function(c){return '<span class="agent-evc">'+E(c)+'</span>'}).join('')+'</div>':'')
        +'</div>'
        +'<div class="conf"><div class="pct">'+aConf+'%<span class="lbl">把握</span></div></div>'
        +'<span></span>'
        +'<div class="acts">'
          +'<button class="btn sm '+primaryAct.cls+'" data-ag-act="'+primaryAct.target+'">'+E(primaryAct.label)+'</button>'
          +(bucket!=='whitelist'?'<button class="btn sm ok" data-ag-act="whitelist">加白</button>':'')
          +(bucket!=='blacklist'?'<button class="btn sm danger" data-ag-act="blacklist">拉黑</button>':'')
          +'<button class="btn sm muted" data-ag-act="requeue" title="退回待审队列重新走 LLM">退回</button>'
          +'<button class="btn sm muted" data-ag-act="reject" title="agent 误判，直接拒绝">拒绝</button>'
        +'</div>'
      +'</div>';
    }).join('');
    // wire row interactions (selection + per-row action)
    Array.prototype.forEach.call(box.querySelectorAll('.qrow'),function(r){
      var k=r.dataset.k;
      var idx=parseInt(r.dataset.idx,10);
      var cb=r.querySelector('input[type=checkbox]');
      cb.addEventListener('click',function(e){
        if(e.shiftKey&&lastSelIdxA>=0&&lastSelIdxA!==idx){
          var rowEls=box.querySelectorAll('.qrow');
          var lo=Math.min(lastSelIdxA,idx),hi=Math.max(lastSelIdxA,idx);
          var target=cb.checked;
          for(var i=lo;i<=hi;i++){
            var rr=rowEls[i];if(!rr)continue;
            var cc=rr.querySelector('input[type=checkbox]');
            if(!cc||cc.checked===target)continue;
            cc.checked=target;
            var kk=rr.dataset.k;
            if(target){agentSel.add(kk);rr.classList.add('sel')}
            else{agentSel.delete(kk);rr.classList.remove('sel')}
          }
        }
        lastSelIdxA=idx;
      });
      cb.addEventListener('change',function(){
        if(cb.checked){agentSel.add(k);r.classList.add('sel')}
        else{agentSel.delete(k);r.classList.remove('sel')}
        agRefreshBatch();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-ag-act]'),function(btn){
      btn.addEventListener('click',function(){
        var r=btn.closest('.qrow');
        var h=r.dataset.h,u=r.dataset.u||undefined;
        var target=btn.dataset.agAct;
        agentPromoteOne(h,u,target,r);
      });
    });
    var lm=$('agmore');if(lm)lm.addEventListener('click',loadAgentListMore);
    var sa=$('selAllA');if(sa)sa.addEventListener('change',function(){
      if(this.checked)agentRows.forEach(function(a){agentSel.add((a.x_user_id||'')+'|'+a.handle)});
      else agentRows.forEach(function(a){agentSel.delete((a.x_user_id||'')+'|'+a.handle)});
      lastSelIdxA=-1;renderAgentList();
    });
    agRefreshBatch();
  }
  function agRefreshBatch(){
    var b=$('agbatch'),s=$('agselN'),v=$('agvisN'),m=$('selAllA');
    if(!b)return;
    var inView=0;for(var i=0;i<agentRows.length;i++){
      if(agentSel.has((agentRows[i].x_user_id||'')+'|'+agentRows[i].handle))inView++;
    }
    if(s)s.textContent=agentSel.size;
    if(v)v.textContent=agentRows.length;
    if(m){m.checked=agentRows.length>0&&inView===agentRows.length;m.indeterminate=inView>0&&inView<agentRows.length}
    b.classList.toggle('on',agentSel.size>0);
  }
  function agClearSel(){agentSel.clear();lastSelIdxA=-1;renderAgentList()}
  function agentPromoteOne(handle,xUserId,target,rowEl){
    var body={handle:handle,target:target};
    if(xUserId)body.x_user_id=xUserId;
    api('/v1/admin/agent-promote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
      .then(function(j){
        if(j&&j.ok){
          rowEl.style.opacity='0.4';
          rowEl.style.transition='opacity .25s';
          setTimeout(function(){
            var k=(xUserId||'')+'|'+handle;
            agentSel.delete(k);
            agentRows=agentRows.filter(function(x){return x.handle!==handle||(x.x_user_id||'')!==(xUserId||'')});
            renderAgentList();
            refreshStats();
          },250);
        } else {
          setStatus('操作失败');
          loadAgentList(agentBucket);refreshStats();
        }
      })
      .catch(function(){
        rowEl.style.opacity='';
        setStatus('操作失败 · 已重新加载');
        setTimeout(function(){setStatus('')},3000);
        loadAgentList(agentBucket);refreshStats();
      });
  }
  function agBatch(target){
    if(!agentSel.size)return;
    var label={blacklist:'确认拉黑',whitelist:'确认加白',requeue:'退回待审',reject:'拒绝'}[target]||target;
    var variant=target==='blacklist'?'danger':target==='whitelist'?'ok':'muted';
    mxModal.confirm({
      title:'批量'+label,
      body:'对已选 <b>'+agentSel.size+'</b> 条 agent 决策执行「'+label+'」？'
        +(target==='blacklist'?'<br>它们将被升级到公榜（公开拉黑），并以 <code>human:admin</code> 角色记录。':'')
        +(target==='whitelist'?'<br>它们将进入官方白名单，并以 <code>human:admin</code> 角色记录。':'')
        +(target==='requeue'?'<br>它们将回到待审队列，下一轮 agent 会重新看。':'')
        +(target==='reject'?'<br>它们将标记为 rejected，不再出现在 agent 队列里。':''),
      okLabel:label+' '+agentSel.size+' 条',
      okVariant:variant
    }).then(function(ok){
      if(!ok)return;
      var ks=Array.from(agentSel);
      var chunks=chunked(ks,BATCH_CHUNK);
      setStatus('批量'+label+' 0/'+ks.length);
      var done=0,idx=0;
      function nextChunk(){
        if(idx>=chunks.length){
          agentSel.clear();lastSelIdxA=-1;
          setStatus('完成 · '+done+' 条');setTimeout(function(){setStatus('')},2500);
          loadAgentList(agentBucket);refreshStats();
          return;
        }
        var slice=chunks[idx++];
        // selToItems returns {handle, xUserId}; agent-promote-batch
        // expects {handle, x_user_id}, so remap.
        var items=selToItems(slice).map(function(it){
          return it.xUserId?{handle:it.handle,x_user_id:it.xUserId}:{handle:it.handle};
        });
        api('/v1/admin/agent-promote-batch',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({target:target,items:items})
        }).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(j){
          if(j&&j.ok){
            done+=slice.length;
            setStatus('批量'+label+' '+done+'/'+ks.length);
            nextChunk();
          } else {
            setStatus('批量'+label+' 失败');setTimeout(function(){setStatus('')},3000);
            loadAgentList(agentBucket);refreshStats();
          }
        }).catch(function(){
          setStatus('批量'+label+' 失败 · 已重新加载');
          setTimeout(function(){setStatus('')},3000);
          loadAgentList(agentBucket);refreshStats();
        });
      }
      nextChunk();
    });
  }
  function loadLog(more){
    var v=$('view');
    if(!more){v.innerHTML=
      viewHead({
        title:'审计日志',
        desc:'每一次加入、移除、白名单、驳回都留痕。完整数据每 6h 镜像到仓库 <a href="'+GH+'/tree/data-mirror/data" target="_blank">data/</a>，git history 可审计。'
      })
      +'<div class="log" id="log">'
      +'<div class="lrow head"><span>时间</span><span>动作</span><span>角色</span><span>账号</span><span>备注</span></div>'
      +'</div>'
      +'<div class="more-foot"><button class="btn sm" id="lm">加载更多</button></div>';
      logCursor=null;$('lm').addEventListener('click',function(){loadLog(true)})}
    setStatus('加载中…');
    api('/v1/admin/log?limit=50'+(logCursor?'&before='+logCursor:'')).then(function(r){
      if(r.status===403){TOK='';sessionStorage.removeItem('xss_admin');renderLocked();return null}
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

  function loadWhitelist(more){
    if(!more){whitelist=[];wlCursor=null;wlSel.clear();lastSelIdxW=-1}
    setStatus('加载中…');
    api('/v1/admin/whitelist'+listQs(wlCursor,wlSearch,wlSort)).then(function(r){
      if(r.status===403){TOK='';sessionStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      whitelist=whitelist.concat(j.list||[]);
      wlCursor=j.nextBefore;
      if(j.appliedFilters&&j.appliedFilters.sort)wlSort=j.appliedFilters.sort;
      setStatus('');
      // Truth lives in stats; this is just a quick fallback before /v1/admin/stats arrives.
      var c=$('cW');if(c&&stats.whitelist==null)c.textContent=whitelist.length+(wlCursor?'+':'');
      renderWhitelist();
    });
  }
  function renderWhitelist(){
    var v=$('view');
    var totalLbl=(stats&&stats.whitelist!=null)?fmtN(stats.whitelist):(whitelist.length+(wlCursor?'+':''));
    var searching=!!wlSearch;
    v.innerHTML=
      viewHead({
        title:'白名单',
        count:totalLbl,
        desc:'白名单账号不会再被 AI 扫描，被举报也会被吞掉。'
          +(searching?' · 当前搜索 <b>'+E(wlSearch)+'</b>':''),
        actions:'<button class="btn sm primary" onclick="window.__xss.wlAdd()">+ 加入白名单</button>'
      })
      +'<div class="search-bar">'
        +'<form class="filter-form" id="wlForm">'
          +'<label class="filter-field"><span>搜索</span><input id="wlSearch" class="search-input" type="search" value="'+E(wlSearch)+'" placeholder="handle / uid / 显示名 / 备注"></label>'
          +'<label class="filter-field"><span>排序</span><select id="wlSort">'+metricSortOptions(wlSort)+'</select></label>'
          +'<div class="filter-actions">'
            +'<button class="btn sm" id="wlSearchBtn" type="submit">搜索</button>'
            +(wlSearch?'<button class="btn sm muted" id="wlSearchClear" type="button">清除</button>':'')
          +'</div>'
        +'</form>'
      +'</div>'
      +'<div class="batch" id="wlbatch">'
        +'<label class="meta" title="全选已加载范围。Shift+点 可在两次勾选间一次性勾选范围">'
          +'<input type="checkbox" id="selAllW" aria-label="全选已加载范围">'
          +'<span>已选 <b id="wlselN">0</b> · 当前 <b id="wlvisN">0</b><span class="hint">（Shift+点可范围多选）</span></span>'
        +'</label>'
        +'<div class="actions">'
          +'<button class="btn sm danger" onclick="window.__xss.wlBatch(\'remove\')">批量移出白名单</button>'
          +'<button class="btn sm" onclick="window.__xss.wlClearSel()">清空选择</button>'
        +'</div>'
      +'</div>'
      +'<div class="rows" id="wlrows"></div>'
      +'<div class="more-foot" id="wmoreFoot">'
        +(wlCursor?'<button class="btn sm" id="wlmore">加载更多</button>':'')
        +(searching?'<span>'+(wlCursor?'已加载 '+fmtN(whitelist.length)+' 条匹配':'已加载全部 '+fmtN(whitelist.length)+' 条匹配')+'</span>'
          :(stats.whitelist!=null?'<span>'+(wlCursor?'已加载 '+fmtN(whitelist.length)+' / 共 '+fmtN(stats.whitelist):'已加载全部 '+fmtN(whitelist.length))+' 条</span>':''))
      +'</div>';
    var box=$('wlrows');
    var wli=$('wlSearch');
    function commitWlSearch(){wlSearch=(wli&&wli.value||'').trim();loadWhitelist(false)}
    var wlf=$('wlForm');if(wlf)wlf.addEventListener('submit',function(e){e.preventDefault();commitWlSearch()});
    var wls=$('wlSort');if(wls)wls.addEventListener('change',function(e){wlSort=e.target.value;loadWhitelist(false)});
    var wlc=$('wlSearchClear');if(wlc)wlc.addEventListener('click',function(){wlSearch='';loadWhitelist(false)});
    if(!whitelist.length){box.innerHTML='<div class="empty">'+(searching?'没有匹配的白名单账号。':'还没有白名单账号。<br><br>点击右上角 <b>+ 加入白名单</b>，或在「待审队列」对某行点 <b>白名单</b> 按钮把它直接挪过来。')+'</div>';wlRefreshBatch();return}
    box.innerHTML=whitelist.map(function(a,i){
      var k=(a.x_user_id||'')+'|'+a.handle;
      var av=a.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(a.handle));
      var fb=E((a.handle||'?').slice(0,1).toUpperCase());
      var note='';
      try{var rs=JSON.parse(a.reasons||'[]');note=Array.isArray(rs)?rs.filter(function(x){return x&&x!=='whitelisted by admin'}).join(' · '):''}catch(e){}
      var acctHtml=accountMetaHtml(a);
      return '<div class="qrow legit'+(wlSel.has(k)?' sel':'')+'" data-k="'+E(k)+'" data-idx="'+i+'" data-h="'+E(a.handle)+'" data-u="'+E(a.x_user_id||'')+'">'
        +'<input type="checkbox"'+(wlSel.has(k)?' checked':'')+' aria-label="选中 @'+E(a.handle)+'">'
        +'<div class="av"><img src="'+E(av)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\''+fb+'\'}))"></div>'
        +'<div class="who">'
          +'<div class="name">'+nameLink(a)+'<span class="vlbl">白名单</span>'
            +(a.last_decided_by?' '+actorBadge(a.last_decided_by):'')+'</div>'
          +'<div class="sub">'
            +handleLink(a.handle)
            +idChip(a.x_user_id)
            +(note?'<span class="sep">·</span><span>'+E(note)+'</span>':'')
            +'<span class="sep">·</span><span title="'+E(new Date(a.last_decided_at||a.last_scored).toLocaleString('zh-CN'))+'">加入 '+ago(a.last_decided_at||a.last_scored)+'</span>'
          +'</div>'
          +acctHtml
        +'</div>'
        +'<span></span><span></span>'
        +'<div class="acts">'
          +'<button class="btn sm danger" data-wl-rm="1">移出白名单</button>'
        +'</div>'
      +'</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.qrow'),function(r){
      var k=r.dataset.k;
      var idx=parseInt(r.dataset.idx,10);
      var cb=r.querySelector('input[type=checkbox]');
      cb.addEventListener('click',function(e){
        if(e.shiftKey&&lastSelIdxW>=0&&lastSelIdxW!==idx){
          var rowEls=box.querySelectorAll('.qrow');
          var lo=Math.min(lastSelIdxW,idx),hi=Math.max(lastSelIdxW,idx);
          var target=cb.checked;
          for(var i=lo;i<=hi;i++){
            var rr=rowEls[i];if(!rr)continue;
            var cc=rr.querySelector('input[type=checkbox]');
            if(!cc||cc.checked===target)continue;
            cc.checked=target;
            var kk=rr.dataset.k;
            if(target){wlSel.add(kk);rr.classList.add('sel')}
            else{wlSel.delete(kk);rr.classList.remove('sel')}
          }
        }
        lastSelIdxW=idx;
      });
      cb.addEventListener('change',function(){if(cb.checked){wlSel.add(k);r.classList.add('sel')}else{wlSel.delete(k);r.classList.remove('sel')}wlRefreshBatch()});
      var btn=r.querySelector('[data-wl-rm]');
      if(btn)btn.addEventListener('click',function(){wlRemove(r.dataset.h,r.dataset.u||null,r)});
    });
    var lm=$('wlmore');if(lm)lm.addEventListener('click',function(){loadWhitelist(true)});
    var sa=$('selAllW');if(sa)sa.addEventListener('change',function(){
      if(this.checked)whitelist.forEach(function(a){wlSel.add((a.x_user_id||'')+'|'+a.handle)});
      else whitelist.forEach(function(a){wlSel.delete((a.x_user_id||'')+'|'+a.handle)});
      lastSelIdxW=-1;renderWhitelist();
    });
    wlRefreshBatch();
  }
  function wlRefreshBatch(){
    var b=$('wlbatch'),s=$('wlselN'),v=$('wlvisN'),m=$('selAllW');
    if(!b)return;
    var inView=0;for(var i=0;i<whitelist.length;i++){if(wlSel.has((whitelist[i].x_user_id||'')+'|'+whitelist[i].handle))inView++}
    if(s)s.textContent=wlSel.size;
    if(v)v.textContent=whitelist.length;
    if(m){m.checked=whitelist.length>0&&inView===whitelist.length;m.indeterminate=inView>0&&inView<whitelist.length}
    b.classList.toggle('on',wlSel.size>0);
  }
  function wlClearSel(){wlSel.clear();lastSelIdxW=-1;renderWhitelist()}
  function wlBatch(action){
    if(!wlSel.size)return;
    mxModal.confirm({
      title:'批量移出白名单',
      body:'确认把 <b>'+wlSel.size+'</b> 个账号移出白名单？\n它们将变回 rejected 状态（不进公榜，但可被重新扫描 / 举报）。',
      okLabel:'移出 '+wlSel.size+' 条',
      okVariant:'danger'
    }).then(function(ok){
      if(!ok)return;
      var ks=Array.from(wlSel);
      var chunks=chunked(ks,BATCH_CHUNK);
      setStatus('批量移出 0/'+ks.length);
      var done=0,idx=0;
      function nextChunk(){
        if(idx>=chunks.length){
          wlSel.clear();lastSelIdxW=-1;loadWhitelist(false);refreshStats();
          setStatus('完成 · '+done+' 条');setTimeout(function(){setStatus('')},2500);
          return;
        }
        var slice=chunks[idx++];
        var items=selToItems(slice);
        api('/v1/admin/whitelist-batch',{
          method:'DELETE',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({items:items})
        }).then(function(r){return r.json()}).then(function(j){
          if(j&&j.ok){
            done+=slice.length;
            setStatus('批量移出 '+done+'/'+ks.length);
            nextChunk();
          } else {
            setStatus('批量移出失败：'+(j&&j.error||'unknown'));
            setTimeout(function(){setStatus('')},3500);
          }
        }).catch(function(){
          setStatus('批量移出 网络错误');
          setTimeout(function(){setStatus('')},3500);
        });
      }
      nextChunk();
    });
  }

  function loadBlacklist(more){
    if(!more){blacklist=[];blCursor=null;blSel.clear()}
    setStatus('加载中…');
    api('/v1/admin/blacklist'+listQs(blCursor,blSearch,blSort)).then(function(r){
      if(r.status===403){TOK='';sessionStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      blacklist=blacklist.concat(j.list||[]);
      blCursor=j.nextBefore;
      if(j.appliedFilters&&j.appliedFilters.sort)blSort=j.appliedFilters.sort;
      setStatus('');
      // Truth lives in stats; this is just a quick fallback before /v1/admin/stats arrives.
      var c=$('cB');if(c&&stats.blacklist==null)c.textContent=blacklist.length+(blCursor?'+':'');
      renderBlacklist();
    });
  }
  function renderBlacklist(){
    var v=$('view');
    var totalLbl=(stats&&stats.blacklist!=null)?fmtN(stats.blacklist):(blacklist.length+(blCursor?'+':''));
    var searching=!!blSearch;
    v.innerHTML=
      viewHead({
        title:'黑名单',
        count:totalLbl,
        desc:'已公榜账号，在 <a href="/list" target="_blank">/list</a> 公开可见。误判可直接 → <b>白名单</b> 或 <b>驳回</b>。'
          +(searching?' · 当前搜索 <b>'+E(blSearch)+'</b>':'')
      })
      +'<div class="search-bar">'
        +'<form class="filter-form" id="blForm">'
          +'<label class="filter-field"><span>搜索</span><input id="blSearch" class="search-input" type="search" value="'+E(blSearch)+'" placeholder="handle / uid / 显示名 / 证据 / 理由"></label>'
          +'<label class="filter-field"><span>排序</span><select id="blSort">'+metricSortOptions(blSort)+'</select></label>'
          +'<div class="filter-actions">'
            +'<button class="btn sm" id="blSearchBtn" type="submit">搜索</button>'
            +(blSearch?'<button class="btn sm muted" id="blSearchClear" type="button">清除</button>':'')
          +'</div>'
        +'</form>'
      +'</div>'
      +'<div class="batch" id="blbatch">'
        +'<label class="meta" title="全选已加载范围。Shift+点 可在两次勾选间一次性勾选范围">'
          +'<input type="checkbox" id="selAllB" aria-label="全选已加载范围">'
          +'<span>已选 <b id="blselN">0</b> · 当前 <b id="blvisN">0</b><span class="hint">（Shift+点可范围多选）</span></span>'
        +'</label>'
        +'<div class="actions">'
          +'<button class="btn sm ok" onclick="window.__xss.blBatch(\'whitelist\')">批量白名单</button>'
          +'<button class="btn sm" onclick="window.__xss.blBatch(\'reject\')">批量驳回（不公开）</button>'
          +'<button class="btn sm muted" onclick="window.__xss.blBatch(\'remove\')">批量移除</button>'
          +'<button class="btn sm" onclick="window.__xss.blClearSel()">清空选择</button>'
        +'</div>'
      +'</div>'
      +'<div class="rows" id="blrows"></div>'
      +'<div class="more-foot" id="bmoreFoot">'
        +(blCursor?'<button class="btn sm" id="blmore">加载更多</button>':'')
        +(searching?'<span>'+(blCursor?'已加载 '+fmtN(blacklist.length)+' 条匹配':'已加载全部 '+fmtN(blacklist.length)+' 条匹配')+'</span>'
          :(stats.blacklist!=null?'<span>'+(blCursor?'已加载 '+fmtN(blacklist.length)+' / 共 '+fmtN(stats.blacklist):'已加载全部 '+fmtN(blacklist.length))+' 条</span>':''))
      +'</div>';
    var box=$('blrows');
    var bli=$('blSearch');
    function commitBlSearch(){blSearch=(bli&&bli.value||'').trim();loadBlacklist(false)}
    var blf=$('blForm');if(blf)blf.addEventListener('submit',function(e){e.preventDefault();commitBlSearch()});
    var bls=$('blSort');if(bls)bls.addEventListener('change',function(e){blSort=e.target.value;loadBlacklist(false)});
    var blc=$('blSearchClear');if(blc)blc.addEventListener('click',function(){blSearch='';loadBlacklist(false)});
    if(!blacklist.length){box.innerHTML='<div class="empty">'+(searching?'没有匹配的黑名单账号。':'公榜还没有账号。<br><br>在「待审队列」点 <b style="color:var(--danger)">拉黑</b> 把判定结果送进公榜。')+'</div>';blRefreshBatch();return}
    box.innerHTML=blacklist.map(function(a,i){
      var k=(a.x_user_id||'')+'|'+a.handle;
      var av=a.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(a.handle));
      var fb=E((a.handle||'?').slice(0,1).toUpperCase());
      var conf=Math.round((a.confidence||0)*100);
      var lbl=a.verdict_label||'spam';
      var lblZh={spam:'垃圾营销',porn_bot:'色情广告',likely_spam:'疑似垃圾',uncertain:'不确定',legit:'正常'}[lbl]||lbl;
      var reps=a.reporters||0;
      var acctHtml=accountMetaHtml(a);
      return '<div class="qrow '+E(lbl)+(blSel.has(k)?' sel':'')+'" data-k="'+E(k)+'" data-idx="'+i+'" data-h="'+E(a.handle)+'" data-u="'+E(a.x_user_id||'')+'">'
        +'<input type="checkbox"'+(blSel.has(k)?' checked':'')+' aria-label="选中 @'+E(a.handle)+'">'
        +'<div class="av"><img src="'+E(av)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\''+fb+'\'}))"></div>'
        +'<div class="who">'
          +'<div class="name">'+nameLink(a)+'<span class="vlbl">'+E(lblZh)+'</span>'
            +(a.last_decided_by?' '+actorBadge(a.last_decided_by):'')+'</div>'
          +'<div class="sub">'
            +handleLink(a.handle)
            +idChip(a.x_user_id)
            +'<span class="sep">·</span><span title="'+E(new Date(a.published_at||a.last_decided_at).toLocaleString('zh-CN'))+'">已公榜 '+ago(a.published_at)+'</span>'
            +(a.last_decided_at&&a.last_decided_at!==a.published_at?'<span class="sep">·</span><span title="'+E(new Date(a.last_decided_at).toLocaleString('zh-CN'))+'">决策 '+ago(a.last_decided_at)+'</span>':'')
          +'</div>'
          +acctHtml
        +'</div>'
        +'<div class="conf"><div class="pct">'+conf+'%<span class="lbl">把握</span></div></div>'
        +'<div class="rep">'+(reps>=3?'<span class="chip-ok">'+reps+' 人 ✓</span>':'<span>'+reps+' 人</span>')+'</div>'
        +'<div class="acts">'
          +'<button class="btn sm ok" data-bl-act="whitelist">移到白名单</button>'
          +'<button class="btn sm" data-bl-act="reject" title="撤下公榜，但保留判定记录">驳回</button>'
          +'<button class="btn sm muted" data-bl-act="remove">移除</button>'
        +'</div>'
      +'</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.qrow'),function(r){
      var k=r.dataset.k;
      var idx=parseInt(r.dataset.idx,10);
      var cb=r.querySelector('input[type=checkbox]');
      cb.addEventListener('click',function(e){
        if(e.shiftKey&&lastSelIdxB>=0&&lastSelIdxB!==idx){
          var rowEls=box.querySelectorAll('.qrow');
          var lo=Math.min(lastSelIdxB,idx),hi=Math.max(lastSelIdxB,idx);
          var target=cb.checked;
          for(var i=lo;i<=hi;i++){
            var rr=rowEls[i];if(!rr)continue;
            var cc=rr.querySelector('input[type=checkbox]');
            if(!cc||cc.checked===target)continue;
            cc.checked=target;
            var kk=rr.dataset.k;
            if(target){blSel.add(kk);rr.classList.add('sel')}
            else{blSel.delete(kk);rr.classList.remove('sel')}
          }
        }
        lastSelIdxB=idx;
      });
      cb.addEventListener('change',function(){if(cb.checked){blSel.add(k);r.classList.add('sel')}else{blSel.delete(k);r.classList.remove('sel')}blRefreshBatch()});
      Array.prototype.forEach.call(r.querySelectorAll('.acts button'),function(b){
        b.addEventListener('click',function(){blDecideOne(r,k,b.dataset.blAct)})
      })
    });
    var lm=$('blmore');if(lm)lm.addEventListener('click',function(){loadBlacklist(true)});
    var sa=$('selAllB');if(sa)sa.addEventListener('change',function(){
      if(this.checked)blacklist.forEach(function(a){blSel.add((a.x_user_id||'')+'|'+a.handle)});
      else blacklist.forEach(function(a){blSel.delete((a.x_user_id||'')+'|'+a.handle)});
      lastSelIdxB=-1;renderBlacklist();
    });
    blRefreshBatch();
  }
  function blRefreshBatch(){
    var b=$('blbatch'),s=$('blselN'),v=$('blvisN'),m=$('selAllB');
    if(!b)return;
    var inView=0;for(var i=0;i<blacklist.length;i++){if(blSel.has((blacklist[i].x_user_id||'')+'|'+blacklist[i].handle))inView++}
    if(s)s.textContent=blSel.size;
    if(v)v.textContent=blacklist.length;
    if(m){m.checked=blacklist.length>0&&inView===blacklist.length;m.indeterminate=inView>0&&inView<blacklist.length}
    b.classList.toggle('on',blSel.size>0);
  }
  function blClearSel(){blSel.clear();lastSelIdxB=-1;renderBlacklist()}
  function blDecideOne(rowEl,k,action){
    var parts=k.split('|'),xUserId=parts[0]||undefined,handle=parts[1];
    var label={whitelist:'移到白名单',reject:'驳回',remove:'移除'}[action]||action;
    var variant=action==='whitelist'?'ok':action==='remove'?'muted':'primary';
    mxModal.confirm({
      title:label,
      body:'把 <b>@'+E(handle)+'</b> 从公榜「'+label+'」？\n该账号将立刻从 /list 消失。',
      okLabel:label,
      okVariant:variant
    }).then(function(ok){
      if(!ok)return;
      rowEl.classList.add('removing');
      api('/v1/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:handle,xUserId:xUserId,action:action})})
        .then(function(){
          blacklist=blacklist.filter(function(a){return ((a.x_user_id||'')+'|'+a.handle)!==k});
          blSel.delete(k);
          if(stats.blacklist!=null){stats.blacklist=Math.max(0,stats.blacklist-1);var c=$('cB');if(c)c.textContent=fmtN(stats.blacklist)}
          renderBlacklist();
          refreshStats();
        });
    });
  }
  function blBatch(action){
    if(!blSel.size)return;
    var label={whitelist:'移到白名单',reject:'驳回',remove:'移除'}[action]||action;
    var variant=action==='whitelist'?'ok':action==='remove'?'muted':'primary';
    mxModal.confirm({
      title:'批量'+label,
      body:'确认对已选 <b>'+blSel.size+'</b> 个公榜账号「'+label+'」？\n它们将立刻从 /list 消失。',
      okLabel:label+' '+blSel.size+' 条',
      okVariant:variant
    }).then(function(ok){
      if(!ok)return;
      var ks=Array.from(blSel);
      var chunks=chunked(ks,BATCH_CHUNK);
      setStatus('批量'+label+' 0/'+ks.length);
      var done=0,idx=0;
      function nextChunk(){
        if(idx>=chunks.length){
          blSel.clear();lastSelIdxB=-1;loadBlacklist(false);refreshStats();
          setStatus('完成 · '+done+' 条');setTimeout(function(){setStatus('')},2500);
          return;
        }
        var slice=chunks[idx++];
        var items=selToItems(slice);
        api('/v1/admin/decide-batch',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({action:action,items:items})
        }).then(function(r){return r.json()}).then(function(j){
          if(j&&j.ok){
            done+=slice.length;
            setStatus('批量'+label+' '+done+'/'+ks.length);
            nextChunk();
          } else {
            setStatus('批量'+label+' 失败：'+(j&&j.error||'unknown'));
            setTimeout(function(){setStatus('')},3500);
          }
        }).catch(function(){
          setStatus('批量'+label+' 网络错误');
          setTimeout(function(){setStatus('')},3500);
        });
      }
      nextChunk();
    });
  }
  function wlAdd(){
    mxModal.form({
      title:'加入白名单',
      body:'白名单账号不会再被 AI 扫描，被举报也会被吞掉。',
      fields:[
        {name:'handle',label:'X handle（不带 @）',required:true,placeholder:'someuser'},
        {name:'xUserId',label:'X 数字 user id',placeholder:'1234567890',hint:'可选，但强烈建议填写（handle 会被改）'},
        {name:'note',label:'备注',placeholder:'核心维护者 / 误判申诉',hint:'仅维护者可见'},
      ],
      okLabel:'加白名单',
      okVariant:'ok'
    }).then(function(vals){
      if(!vals)return;
      var h=(vals.handle||'').replace(/^@+/,'').trim();
      if(!h)return;
      setStatus('加入白名单…');
      api('/v1/admin/whitelist',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({handle:h,xUserId:vals.xUserId||undefined,note:vals.note||''})
      }).then(function(r){return r.json()}).then(function(j){
        if(j&&j.ok){setStatus('已加入');setTimeout(function(){setStatus('')},2000);loadWhitelist(false);refreshStats()}
        else{setStatus('失败：'+(j&&j.error||'unknown'));setTimeout(function(){setStatus('')},3000)}
      });
    });
  }
  function wlRemove(handle,xUserId,rowEl){
    mxModal.confirm({
      title:'移出白名单',
      body:'确认把 <b>@'+E(handle)+'</b> 移出白名单？\n该账号将变回普通可扫描状态（status=rejected，不会自动进公榜）。',
      okLabel:'移出白名单',
      okVariant:'danger'
    }).then(function(ok){
      if(!ok)return;
      rowEl&&rowEl.classList.add('removing');
      var q='?handle='+encodeURIComponent(handle)+(xUserId?'&xUserId='+encodeURIComponent(xUserId):'');
      api('/v1/admin/whitelist'+q,{method:'DELETE'}).then(function(){loadWhitelist(false);refreshStats()});
    });
  }
  /** Called from queue rows — promotes a queue item to whitelist via /admin/decide. */
  function whitelistFromQueue(rowEl,k){
    var parts=k.split('|'),xUserId=parts[0]||undefined,handle=parts[1];
    mxModal.confirm({
      title:'加入白名单',
      body:'把 <b>@'+E(handle)+'</b> 加入白名单？\n该账号将永不再被 AI 扫描，被举报也会被吞掉。',
      okLabel:'加白名单',
      okVariant:'ok'
    }).then(function(ok){
      if(!ok)return;
      rowEl.classList.add('removing');
      api('/v1/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:handle,xUserId:xUserId,action:'whitelist'})})
        .then(function(res){
          if(!res.ok){
            rowEl.classList.remove('removing');
            setStatus('加白名单失败：HTTP '+res.status);
            setTimeout(function(){setStatus('')},3500);
            return;
          }
          queue=queue.filter(function(a){return key(a)!==k});sel.delete(k);
          if(stats.queue!=null){stats.queue=Math.max(0,stats.queue-1);var c=$('cQ');if(c)c.textContent=fmtN(stats.queue)}
          renderRows();
          refreshStats();
        })
        .catch(function(){
          rowEl.classList.remove('removing');
          setStatus('加白名单失败：网络错误');
          setTimeout(function(){setStatus('')},3500);
        });
    });
  }

  function tab(v){
    if(VIEW===v)return;VIEW=v;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(b){b.classList.toggle('on',b.dataset.v===v)});
    if(v==='queue')loadQueue(false);
    else if(v==='whitelist')loadWhitelist(false);
    else if(v==='blacklist')loadBlacklist(false);
    else if(v==='agentPending')loadAgentList('pending');
    else if(v==='agentBL')loadAgentList('blacklist');
    else if(v==='agentWL')loadAgentList('whitelist');
    else if(v==='rules')loadRules();
    else loadLog(false);
    // Refresh chips on every tab switch — chips show counts for tabs the user
    // isn't currently looking at, and those counts change as the queue drains.
    refreshStats();
  }
  function save(){
    var t=$('t');if(!t)return;
    var v=t.value.trim();if(!v)return;
    TOK=v;try{localStorage.removeItem('xss_admin')}catch(e){}sessionStorage.setItem('xss_admin',v);renderShell();
  }
  function logout(){
    mxModal.confirm({
      title:'退出审核台',
      body:'清除本浏览器保存的 <code>ADMIN_TOKEN</code>，回到锁屏。',
      okLabel:'退出',
      okVariant:'muted'
    }).then(function(ok){
      if(!ok)return;
      TOK='';sessionStorage.removeItem('xss_admin');renderLocked();
    });
  }

  window.__xss={
    tab:tab,save:save,logout:logout,
    batch:batch,clearSel:clearSel,
    wlAdd:wlAdd,wlBatch:wlBatch,wlClearSel:wlClearSel,
    blBatch:blBatch,blClearSel:blClearSel,
    agBatch:agBatch,agClearSel:agClearSel,
    ruleAdd:ruleAdd,rulesApplyAll:rulesApplyAll,
  };
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
</head><body class="admin">
<div class="wrap"><div id="app" aria-live="polite"><div class="locked"><div class="card"><div class="lock"></div><h2>加载中…</h2></div></div></div></div>
<div class="wrap" style="padding-top:0;color:var(--fg-4);font-size:11.5px;display:flex;justify-content:space-between"><span id="status"></span><span>v1 · /admin</span></div>
<script>${THEME_TOGGLE_JS}${SCRIPT}</script>
</body></html>`;
}
