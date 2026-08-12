// Public spam board — latest 100 human_confirmed accounts, polled every 30s
// against /v1/list. SSR shell; data fetched client-side so the HTML stays
// trivial and Cloudflare's edge cache handles the JSON.
//
// Visual: base-ui inspired — neutral surfaces, no decorative gradients,
// type-led emphasis, accent reserved for state.
import { BRAND } from "../brand";
import { layout } from "./_layout";

const ICON_EXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;

const SHELL = `
<section class="head">
  <h1>公开名单</h1>
  <p class="lede" style="font-size:12.5px;color:var(--fg-3);margin-bottom:14px;text-transform:uppercase;letter-spacing:.12em">${BRAND.acronym} · 已确认的垃圾号</p>
  <p class="lede">AI 初筛，维护者复核。</p>
  <p class="lede">误伤？开 <a href="${BRAND.appealNewIssue}" style="color:var(--accent)">issue</a>，复核后撤下。</p>
  <p class="lede">完整数据快照每 6h 同步到 <a href="${BRAND.repo}/tree/data-mirror/data" style="color:var(--accent)" target="_blank" rel="noopener">仓库 data/</a> 目录，git history 即审计日志。</p>
  <div class="pulse"><span class="dot" aria-hidden="true"></span><span id="pulseLabel">连接中...</span></div>
</section>

<div class="aggr">
  <div class="c"><div class="n" id="agCount">—</div><div class="l">已确认总数</div></div>
  <div class="c"><div class="n" id="agWeek">—</div><div class="l">本周新增</div></div>
  <div class="c daily"><div class="n" id="agDaily">—</div><div class="l">日均</div></div>
  <div class="c"><div class="n" id="agLatest">—</div><div class="l">最近一条</div></div>
</div>

<div class="list" id="list" role="list"><div class="empty">加载中...</div></div>

<div class="more"><button class="btn sm" id="moreBtn" hidden>加载更早</button></div>

<p class="note">每 30 秒更新。数据接口：<code>GET /v1/list</code></p>
`;

const SCRIPT = `
(function(){
  var listEl=document.getElementById('list'),moreBtn=document.getElementById('moreBtn'),pulseLabel=document.getElementById('pulseLabel');
  var rows=[],latestAt=null,oldestAt=null,exhausted=false,lastPollAt=Date.now();
  var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FRESH_MS=5*60*1000;
  function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fmt(n){return typeof n==='number'?n.toLocaleString('zh-CN'):'—'}
  function ago(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<10)return'刚刚';if(s<60)return s+' 秒前';var m=Math.round(s/60);if(m<60)return m+' 分钟前';var h=Math.round(m/60);if(h<24)return h+' 小时前';return Math.round(h/24)+' 天前'}
  function avatarHtml(r){
    var url=r.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(r.handle));
    var fallback=esc((r.handle||'?').slice(0,1).toUpperCase());
    return '<div class="av"><img src="'+esc(url)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\\'span\\'),{textContent:\\''+fallback+'\\'}))"/></div>';
  }
  function labelText(label){
    return {
      spam:'垃圾营销',
      likely_spam:'疑似垃圾',
      porn_bot:'色情广告',
      uncertain:'待复核',
      legit:'正常'
    }[label]||label;
  }
  function rowHtml(r,fresh){
    var lbl=r.verdict_label||'uncertain';
    var conf=typeof r.confidence==='number'?Math.max(0,Math.min(100,Math.round(r.confidence*100))):0;
    var isFresh=r.published_at&&(Date.now()-r.published_at)<FRESH_MS;
    var rawName=(r.display_name||'').trim();
    var display=rawName||('@'+r.handle);
    var handleLower=String(r.handle||'').toLowerCase();
    var showHandle=rawName&&rawName.toLowerCase()!==handleLower&&rawName.toLowerCase()!==('@'+handleLower);
    var profile='https://x.com/'+encodeURIComponent(r.handle);
    var handle=showHandle?'<span class="handle">@'+esc(r.handle)+'</span>':'';
    var freshBadge=isFresh?'<span class="fresh">新</span>':'';
    var reps=r.reporters|0;
    // "N 人拉黑过" — 1 人也显示（说明至少一个维护者或 GH 用户上报过）
    // 3+ 人时用 chip 高亮（达到 auto-publish 阈值的对应数字）
    var repHtml=reps>=3
      ? '<span class="rep-chip strong">'+reps+' 人拉黑过</span>'
      : (reps>=1
          ? '<span class="rep-chip">'+reps+' 人拉黑过</span>'
          : '');
    // AI reasons → hover tooltip on the verdict tag
    var reasonsArr=[];
    try{reasonsArr=r.reasons?(typeof r.reasons==='string'?JSON.parse(r.reasons):r.reasons):[]}catch(e){reasonsArr=[]}
    var reasonsText=Array.isArray(reasonsArr)&&reasonsArr.length?'AI 理由：'+reasonsArr.join('；'):'';
    // Evidence snippet — 第一手公开证据，让公榜不止是 handle + label
    var evid=(r.evidence_text||'').replace(/\\s+/g,' ').trim();
    var evidHtml=evid?'<div class="ev" title="'+esc(evid)+'"><span class="ev-label">证据</span><span class="ev-text">『'+esc(evid.slice(0,180))+(evid.length>180?'…':'')+'』</span></div>':'';
    return '<div class="row '+esc(lbl)+(fresh?' new':'')+'" role="listitem" data-pt="'+r.published_at+'">'
      +avatarHtml(r)
      +'<div class="meta">'
        +'<div class="top">'
          +'<span class="display"><a href="'+profile+'" target="_blank" rel="noopener noreferrer">'+esc(display)+'</a></span>'
          +handle
          +freshBadge
        +'</div>'
        +'<div class="sub">'
          +'<span class="tag '+esc(lbl)+'" title="'+esc(reasonsText)+'">'+esc(labelText(lbl))+'</span>'
          +'<span class="sep">·</span><span>'+ago(r.published_at)+'</span>'
          +(repHtml?'<span class="sep">·</span>'+repHtml:'')
        +'</div>'
        +evidHtml
      +'</div>'
      +'<div class="right">'
        +'<div class="conf" title="模型置信度 '+conf+'%">'
          +'<span class="pct">'+conf+'%</span>'
          +'<div class="bar"><i style="width:'+conf+'%"></i></div>'
        +'</div>'
        +'<a class="ext" href="'+profile+'" target="_blank" rel="noopener noreferrer" aria-label="去 X 主页">${ICON_EXT}</a>'
      +'</div>'
      +'</div>';
  }
  function render(){
    if(!rows.length){listEl.innerHTML='<div class="empty">暂无公开条目。</div>';return}
    listEl.innerHTML=rows.map(function(r){return rowHtml(r,!1)}).join('');
  }
  function refreshAggr(meta){
    document.getElementById('agCount').textContent=fmt(meta.count);
    document.getElementById('agWeek').textContent=(meta.week>0?'+':'')+fmt(meta.week);
    document.getElementById('agDaily').textContent=fmt(Math.round((meta.week||0)/7));
    document.getElementById('agLatest').textContent=meta.latestAt?ago(meta.latestAt):'—';
  }
  function key(r){return (r.x_user_id||'')+'|'+r.handle}
  function setPulse(msg){pulseLabel.innerHTML=msg}
  function load(){
    return fetch('/v1/list?limit=100').then(function(r){return r.json()}).then(function(j){
      rows=j.list||[];latestAt=j.latestAt;oldestAt=j.nextBefore;exhausted=!oldestAt;
      moreBtn.hidden=exhausted;render();
      lastPollAt=Date.now();
      setPulse('<strong>已同步</strong> · 最新 '+fmt(rows.length)+' 条');
    })
  }
  function loadMore(){
    if(exhausted||!oldestAt)return;
    moreBtn.disabled=!0;moreBtn.textContent='加载中...';
    fetch('/v1/list?limit=100&before='+oldestAt).then(function(r){return r.json()}).then(function(j){
      var seen=Object.create(null);rows.forEach(function(r){seen[key(r)]=1});
      (j.list||[]).forEach(function(r){if(!seen[key(r)])rows.push(r)});
      oldestAt=j.nextBefore;exhausted=!oldestAt;moreBtn.hidden=exhausted;
      render();moreBtn.disabled=!1;moreBtn.textContent='加载更早 100 条'
    })
  }
  function poll(){
    if(!latestAt)return;
    fetch('/v1/list?limit=100&since='+latestAt).then(function(r){return r.json()}).then(function(j){
      lastPollAt=Date.now();
      var fresh=j.list||[];
      if(!fresh.length){setPulse('暂无新增 · '+ago(lastPollAt));return}
      var seen=Object.create(null);rows.forEach(function(r){seen[key(r)]=1});
      var added=fresh.filter(function(r){return !seen[key(r)]});if(!added.length){setPulse('暂无新增 · '+ago(lastPollAt));return}
      rows=added.concat(rows);latestAt=j.latestAt||latestAt;
      var frag=document.createDocumentFragment();
      added.forEach(function(r){
        var div=document.createElement('div');div.innerHTML=rowHtml(r,!reduced);frag.appendChild(div.firstElementChild);
      });
      listEl.insertBefore(frag,listEl.firstChild);
      setPulse('<strong>+'+added.length+' 条新增</strong> · '+ago(lastPollAt));
    }).catch(function(){setPulse('网络不稳 · '+ago(lastPollAt))})
  }
  function refreshMeta(){fetch('/v1/list/meta').then(function(r){return r.json()}).then(refreshAggr).catch(function(){})}
  moreBtn.addEventListener('click',loadMore);
  load().then(refreshMeta);
  setInterval(poll,30000);
  setInterval(refreshMeta,60000);
  setInterval(function(){if(rows.length)render();refreshMeta()},90000);
})();
`;

export function listHtml(): string {
  return layout({
    title: `公开名单 · ${BRAND.acronym}`,
    current: "list",
    head: `<meta name="robots" content="noindex,follow">`,
    body: SHELL,
    script: SCRIPT,
  });
}
