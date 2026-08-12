// Product landing — public, zero-PII. MXGA identifies spam / porn-ad bots
// on X and hands you a one-click block across supported browsers.
// Visual: base-ui inspired — monochrome canvas, type-led hierarchy.
import { BRAND } from "../brand";
import { ICONS, LINKS, layout } from "./_layout";

// Install CTAs use the official Chrome, Firefox, and TestFlight logos served
// from /static; see the .store-badge markup in HERO.
const ICON_GH = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>`;
const ICON_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`;
// Small chevron tucked after the store name — signals "this jumps out to the
// store". Tints with currentColor and nudges right on badge hover.
const ICON_ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
// Apple glyph inline in the TestFlight badge's sub-line, sized to the 11px text.
const ICON_APPLE = `<svg viewBox="0 0 384 512" fill="currentColor" style="display:inline-block;width:10px;height:10px;vertical-align:-1px" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>`;
const ICON_SHIELD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>`;
const ICON_LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_DB = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`;
const ICON_USER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
// Lucide "triangle-alert" — used by the prominent risk banner and the
// pre-install interstitial. Stroke at currentColor so it tints with --warn.
const ICON_WARN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`;

const HERO_STATS = `
<div class="hero-stats" aria-label="当前运行数据">
  <div class="stats">
    <div class="stat"><div class="n" id="sCount" data-v="0"><span class="skel"></span></div><div class="lbl">已确认</div></div>
    <div class="stat"><div class="n" id="sDay" data-v="0"><span class="skel"></span></div><div class="lbl">24h新增</div></div>
    <div class="stat"><div class="n" id="sWeek" data-v="0"><span class="skel"></span></div><div class="lbl">本周新增</div></div>
    <div class="stat"><div class="n" id="sPending" data-v="0"><span class="skel"></span></div><div class="lbl">待复核</div></div>
  </div>
  <p class="stats-foot">
    <span class="pip"><i aria-hidden="true"></i><span id="sAgo">每分钟同步</span></span>
  </p>
</div>
`;

const HERO = `
<section class="hero-row">
<div class="hero">
  <span class="eyebrow">
    <span class="dot" aria-hidden="true"></span>
    <span class="x">${ICONS.X}</span>
    Chrome / Firefox / Safari 扩展<span class="sep">·</span>${BRAND.license} 开源
  </span>
  <h1>Make <span class="xmark">${ICONS.X}</span> Great Again<br><span class="sub">少看垃圾，多看人话。</span></h1>
  <p class="lede">广告号、色情引流先标出；拉黑由你确认。</p>
  <div class="store-badges">
    <a class="store-badge chrome" data-install href="${BRAND.chromeWebStore}" target="_blank" rel="noopener" aria-label="从 Chrome 网上应用店安装扩展">
      <img class="store-logo" src="/store-chrome.svg" alt="" width="34" height="34" loading="eager">
      <span class="store-text">
        <span class="store-sub">Chrome · Edge · Brave · Arc</span>
        <span class="store-name">Chrome 网上应用店<span class="store-go" aria-hidden="true">${ICON_ARROW}</span></span>
      </span>
    </a>
    <a class="store-badge firefox" href="${BRAND.firefoxAddons}" target="_blank" rel="noopener" aria-label="从 Firefox 附加组件商店安装扩展">
      <img class="store-logo" src="/store-firefox.svg" alt="" width="34" height="34" loading="eager">
      <span class="store-text">
        <span class="store-sub">Firefox 浏览器</span>
        <span class="store-name">Firefox 附加组件<span class="store-go" aria-hidden="true">${ICON_ARROW}</span></span>
      </span>
    </a>
    <a class="store-badge testflight" href="${BRAND.testFlight}" target="_blank" rel="noopener" aria-label="通过 TestFlight 安装 Apple 平台测试版">
      <img class="store-logo" src="/store-safari.svg" alt="" width="34" height="34" loading="eager">
      <span class="store-text">
        <span class="store-sub" style="white-space:nowrap">Safari · ${ICON_APPLE} iOS · iPadOS · macOS</span>
        <span class="store-name">TestFlight 测试版<span class="store-go" aria-hidden="true">${ICON_ARROW}</span></span>
      </span>
    </a>
  </div>
  <div class="ctas ctas-minor">
    <a class="btn ghost" href="/list" aria-label="看公开名单">${ICON_LIST}<span>看公开名单</span></a>
    <a class="btn ghost" href="${BRAND.repo}" aria-label="在 GitHub 上查看源码">${ICON_GH}<span>看源码</span></a>
  </div>
  <p class="meta">
    <span>Chrome / Firefox 已上架，TestFlight 开放测试</span><span class="dot" aria-hidden="true"></span>
    <span>手动拉黑</span><span class="dot" aria-hidden="true"></span>
    <span>不存身份</span><span class="dot" aria-hidden="true"></span>
    <span>开源</span>
  </p>
  <details class="install-alt">
    <summary>想跑开发版，或从源码加载？</summary>
    <ol>
      <li>从 <a href="${LINKS.RELEASE_URL}" target="_blank" rel="noopener">GitHub Release</a> 下载最新 <code>.zip</code> 并解压</li>
      <li><strong>Chromium 内核</strong>（Chrome / Edge / Brave / Arc）：打开 <code>chrome://extensions</code> → 开启「开发者模式」→「加载已解压的扩展程序」</li>
      <li><strong>Firefox</strong>：打开 <code>about:debugging</code> → 「此 Firefox」→「临时加载附加组件」，选择解压目录里的 <code>manifest.json</code></li>
      <li>打开 x.com 就能用</li>
    </ol>
  </details>
</div>
<div class="hero-side">
  <div class="hero-mascot" aria-hidden="true">
    <img src="/mxga-hero.png" alt="" width="340" height="340" />
  </div>
  ${HERO_STATS}
</div>
</section>
`;

// Prominent, full-width safety banner — sits between the hero and the live
// feed so it's impossible to miss on first scroll, yet doesn't crowd the H1.
const NOTICE = `
<aside class="notice" role="note" aria-label="账号风控提醒">
  <span class="notice-ic" aria-hidden="true">${ICON_WARN}</span>
  <div class="notice-body">
    <strong>账号风控提醒 · 请克制、分批拉黑</strong>
    <p>X 会对短时间内连续、大量拉黑账号的行为触发风控，可能导致 Ghost Ban（限流）、功能受限，甚至账号冻结。MXGA 默认只「标注」可疑账号，拉黑动作始终由你手动确认 —— 请量力而行，分批处理，不要追求一次清空，也不要叠加其他高频批量操作。</p>
    <a class="more" href="${BRAND.governance}" target="_blank" rel="noopener">了解我们如何降低误伤与风险 →</a>
  </div>
</aside>
`;

// One-time pre-install interstitial. Intercepts the first jump to the Chrome
// Web Store; after the user acknowledges, the flag in localStorage lets later
// clicks pass straight through (see RISK_MODAL_JS).
const MODAL = `
<div class="risk-modal" id="riskModal" role="dialog" aria-modal="true" aria-labelledby="riskModalTitle" aria-describedby="riskModalBody" hidden>
  <div class="risk-modal-backdrop" data-risk-dismiss></div>
  <div class="risk-modal-card" role="document">
    <span class="risk-modal-icon" aria-hidden="true">${ICON_WARN}</span>
    <h2 id="riskModalTitle">安装前，请先了解风控风险</h2>
    <div class="risk-modal-body" id="riskModalBody">
      <p>MXGA 帮你识别广告号和色情引流号，但<strong>拉黑动作发生在你自己的 X 账号上</strong>。安装前请知悉：</p>
      <ul>
        <li>短时间内<strong>连续、大量拉黑</strong>可能被 X 判定为异常自动化，触发 Ghost Ban、功能限制甚至账号冻结。</li>
        <li>请<strong>分批、克制</strong>地处理，不要追求一次清空，也不要叠加其他高频批量操作。</li>
        <li>是否拉黑<strong>始终由你手动确认</strong>，扩展不会替你自动执行。</li>
      </ul>
    </div>
    <div class="risk-modal-actions">
      <button class="btn" type="button" data-risk-dismiss>再想想</button>
      <a class="btn primary" id="riskModalGo" href="${BRAND.chromeWebStore}" target="_blank" rel="noopener">已了解，前往安装</a>
    </div>
  </div>
</div>
`;

const TRENDS = `
<section class="trend-block" aria-labelledby="trendTitle">
  <div class="trend-strip">
    <span class="trend-eyebrow" id="trendTitle"><i class="dot" aria-hidden="true"></i>公开趋势</span>
    <span class="trend-updated" id="trendAgo">加载中...</span>
  </div>
  <div class="trend-grid">
    <article class="trend-card" aria-label="过去 24 小时每小时新增 spam">
      <header>
        <div>
          <h2>过去 24 小时</h2>
          <p>每小时新增 spam</p>
        </div>
        <strong class="trend-total" id="trend24Total">—</strong>
      </header>
      <div class="trend-chart" id="trend24Chart"><div class="trend-skel"></div></div>
      <div class="trend-axis hourly" id="trend24Ticks" aria-hidden="true"></div>
    </article>
    <article class="trend-card" aria-label="过去一周每天处理 spam">
      <header>
        <div>
          <h2>过去一周</h2>
          <p>每天处理 spam</p>
        </div>
        <strong class="trend-total" id="trend7Total">—</strong>
      </header>
      <div class="trend-chart" id="trend7Chart"><div class="trend-skel"></div></div>
      <div class="trend-axis daily" id="trend7Ticks" aria-hidden="true"></div>
    </article>
  </div>
</section>
`;

const PILLARS = `
<section class="block">
  <h2>先救评论区，再做深</h2>
  <div class="pillars">
    <div class="pillar">
      <div class="n">01</div>
      <div class="body">
        <h3>拦垃圾评论</h3>
        <p>标出广告、色情引流和模板回复。你确认后再拉黑。</p>
      </div>
      <span class="status live">● 已上线</span>
    </div>
    <div class="pillar">
      <div class="n">02</div>
      <div class="body">
        <h3>识别账号</h3>
        <p>计划显示账号年龄、常聊话题和互动质量。</p>
      </div>
      <span class="status next">下一站</span>
    </div>
    <div class="pillar">
      <div class="n">03</div>
      <div class="body">
        <h3>速览主页</h3>
        <p>计划总结主题、高赞内容和活跃时间。</p>
      </div>
      <span class="status soon">规划中</span>
    </div>
    <div class="pillar">
      <div class="n">04</div>
      <div class="body">
        <h3>看清传播</h3>
        <p>计划显示你关注的人是否转评过。</p>
      </div>
      <span class="status soon">规划中</span>
    </div>
    <div class="pillar">
      <div class="n">05</div>
      <div class="body">
        <h3>导出数据</h3>
        <p>计划导出关注、收藏和自己的推文。</p>
      </div>
      <span class="status soon">规划中</span>
    </div>
  </div>
</section>
`;

const TRUST = `
<section class="block">
  <h2>规则公开，误伤可撤</h2>
  <div class="trust">
    <div class="row" style="--ic:#10b981"><span class="ic">${ICON_SHIELD}</span><div><h3>模型不定案</h3><p>模型只给理由；进名单要人工确认或多人上报。</p></div></div>
    <div class="row" style="--ic:#38bdf8"><span class="ic">${ICON_LOCK}</span><div><h3>不碰登录态</h3><p>不上传 Cookie、关注列表和浏览历史。</p></div></div>
    <div class="row" style="--ic:#f59e0b"><span class="ic">${ICON_DB}</span><div><h3>操作留痕</h3><p>加入、移除、白名单、驳回都有记录；完整数据每 6h 同步到 <a href="${BRAND.repo}/tree/data-mirror/data" target="_blank" rel="noopener" style="color:var(--accent)">仓库 data/</a>，git history 可审计。</p></div></div>
    <div class="row" style="--ic:#a855f7"><span class="ic">${ICON_USER}</span><div><h3>GitHub 上报</h3><p>登录只用于防刷和追溯提交。</p></div></div>
  </div>
</section>
`;

// FEED sits directly under the hero — for the "this thing is working
// RIGHT NOW" social-proof beat. No section h2: just a quiet eyebrow that
// chains the eye from the install CTA into the live data.
const FEED = `
<section class="feed-block">
  <div class="feed-head">
    <span class="feed-eyebrow"><i class="live-dot" aria-hidden="true"></i>最近处理<span class="sep">·</span>20 秒更新</span>
    <a class="feed-more" href="/list">完整名单 →</a>
  </div>
  <div class="feed" id="feed" role="list"><div class="feed-skel">连接中...</div></div>
  <p class="feed-foot">
    <span id="feedAgo">连接中...</span>
    <span class="sep">·</span>
    <span>本页新增 <strong id="feedAdded">0</strong> 条</span>
  </p>
</section>
`;

const SCRIPT = `
(function(){
  var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fmt(n){return typeof n==='number'?n.toLocaleString('zh-CN'):'—'}
  function plus(n){return n>0?'+'+fmt(n):fmt(n)}
  function ago(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<10)return'刚刚';if(s<60)return s+'s';var m=Math.round(s/60);if(m<60)return m+'m';var h=Math.round(m/60);if(h<24)return h+'h';return Math.round(h/24)+'d'}
  function agoLong(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<60)return s+' 秒前';var m=Math.round(s/60);if(m<60)return m+' 分钟前';var h=Math.round(m/60);if(h<24)return h+' 小时前';return Math.round(h/24)+' 天前'}
  function setText(id,v){var el=document.getElementById(id);if(el)el.textContent=v}
  function total(items){return (items||[]).reduce(function(sum,item){return sum+(Number(item.count)||0)},0)}
  function hourLabel(ms){return new Date(ms).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}
  function dayLabel(ms){return new Date(ms).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}
  function weekLabel(ms){return new Date(ms).toLocaleDateString('zh-CN',{weekday:'short'})}
  function dayLongLabel(ms){return new Date(ms).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'})}
  function setTicks(id,items){
    var el=document.getElementById(id);if(!el)return;
    el.innerHTML=(items||[]).map(function(t){return '<span>'+esc(t)+'</span>'}).join('');
  }
  function bindTrendTooltip(el){
    var tip=el&&el.querySelector('.trend-tip');if(!tip)return;
    function show(target){
      tip.innerHTML='<strong>'+esc(target.getAttribute('data-tip-title')||'')+'</strong><span>'+esc(target.getAttribute('data-tip-value')||'')+'</span>';
      tip.style.left=(target.getAttribute('data-tip-x')||'50')+'%';
      tip.style.top=(target.getAttribute('data-tip-y')||'50')+'%';
      tip.classList.add('show');
    }
    function hide(){tip.classList.remove('show')}
    el.querySelectorAll('[data-tip-title]').forEach(function(target){
      target.addEventListener('mouseenter',function(){show(target)});
      target.addEventListener('focus',function(){show(target)});
      target.addEventListener('mouseleave',hide);
      target.addEventListener('blur',hide);
    });
  }

  function gridLines(w,h,top,base){
    var out='';
    for(var i=0;i<4;i++){
      var y=top+(base-top)*i/3;
      out+='<line class="trend-gridline" x1="0" x2="'+w+'" y1="'+y.toFixed(1)+'" y2="'+y.toFixed(1)+'"/>';
    }
    return out;
  }

  function renderAreaChart(el,data,label){
    if(!el)return;
    if(!data.length){el.innerHTML='<div class="trend-empty">暂无数据</div>';return}
    var sum=total(data);
    if(sum===0){el.innerHTML='<div class="trend-empty">这段时间暂无新增</div>';return}
    var w=640,h=170,top=10,base=146,left=8,right=8;
    var max=Math.max(1,Math.max.apply(null,data.map(function(p){return Number(p.count)||0})));
    var pts=data.map(function(p,i){
      var x=left+(data.length===1?0:i*(w-left-right)/(data.length-1));
      var y=top+(base-top)*(1-((Number(p.count)||0)/max));
      return {x:x,y:y,count:Number(p.count)||0,at:p.at};
    });
    var line=pts.map(function(p,i){return (i?'L':'M')+p.x.toFixed(1)+','+p.y.toFixed(1)}).join(' ');
    var area=line+' L'+pts[pts.length-1].x.toFixed(1)+','+base+' L'+pts[0].x.toFixed(1)+','+base+' Z';
    var dots=pts.map(function(p){
      return '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3" fill="var(--accent)" opacity=".9"/>';
    }).join('');
    var slot=(w-left-right)/(data.length-1);
    var hits=pts.map(function(p,i){
      var x=Math.max(0,p.x-slot/2);
      var ww=Math.min(w-x,slot);
      var title=hourLabel(p.at)+' - '+hourLabel(p.at+3600_000);
      return '<rect class="trend-hit" tabindex="0" x="'+x.toFixed(1)+'" y="0" width="'+ww.toFixed(1)+'" height="'+base+'" fill="transparent" style="pointer-events:all" data-tip-title="'+esc(title)+'" data-tip-value="'+esc(fmt(p.count)+' 条新增')+'" data-tip-x="'+(p.x/w*100).toFixed(2)+'" data-tip-y="'+(p.y/h*100).toFixed(2)+'"><title>'+esc(title+' · '+fmt(p.count)+' 条新增')+'</title></rect>';
    }).join('');
    el.innerHTML='<svg role="img" aria-label="'+esc(label)+'" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'
      +'<defs><linearGradient id="trend24Fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stop-color="var(--accent)" stop-opacity=".30"/><stop offset="95%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>'
      +gridLines(w,h,top,base)
      +'<path d="'+area+'" fill="url(#trend24Fill)"/>'
      +'<path d="'+line+'" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'
      +dots+hits+'</svg><div class="trend-tip" role="tooltip"></div>';
    bindTrendTooltip(el);
  }

  function renderBarChart(el,data,label){
    if(!el)return;
    if(!data.length){el.innerHTML='<div class="trend-empty">暂无数据</div>';return}
    var sum=total(data);
    if(sum===0){el.innerHTML='<div class="trend-empty">这周暂无新增</div>';return}
    var w=420,h=170,top=10,base=146,left=10,right=10;
    var max=Math.max(1,Math.max.apply(null,data.map(function(p){return Number(p.count)||0})));
    var slot=(w-left-right)/data.length;
    var barW=Math.max(18,slot*.56);
    var bars=data.map(function(p,i){
      var count=Number(p.count)||0;
      var bh=Math.max(count?3:0,(base-top)*(count/max));
      var x=left+i*slot+(slot-barW)/2;
      var y=base-bh;
      return '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="4" fill="var(--violet)" opacity="'+(count?'.9':'.25')+'"/>';
    }).join('');
    var hits=data.map(function(p,i){
      var count=Number(p.count)||0;
      var x=left+i*slot;
      var cx=x+slot/2;
      var y=top+(base-top)*(1-(count/max));
      var title=dayLongLabel(p.at);
      return '<rect class="trend-hit" tabindex="0" x="'+x.toFixed(1)+'" y="0" width="'+slot.toFixed(1)+'" height="'+base+'" fill="transparent" style="pointer-events:all" data-tip-title="'+esc(title)+'" data-tip-value="'+esc(fmt(count)+' 条处理')+'" data-tip-x="'+(cx/w*100).toFixed(2)+'" data-tip-y="'+(y/h*100).toFixed(2)+'"><title>'+esc(title+' · '+fmt(count)+' 条处理')+'</title></rect>';
    }).join('');
    el.innerHTML='<svg role="img" aria-label="'+esc(label)+'" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'
      +gridLines(w,h,top,base)
      +bars+hits+'</svg><div class="trend-tip" role="tooltip"></div>';
    bindTrendTooltip(el);
  }

  // ---- Stat count-up animation ----
  function countTo(el,target,ms){
    if(!el)return;
    var pos=String(target).indexOf('+')===0?'+':'';
    var n=target.toString().replace(/[^0-9]/g,'');var nn=parseInt(n,10);if(isNaN(nn))nn=0;
    var prev=parseInt(el.dataset.v||'0',10);
    if(reduced){el.textContent=pos+fmt(nn);el.dataset.v=String(nn);return}
    if(prev===nn){el.textContent=pos+fmt(nn);return}
    var t0=performance.now();
    function step(t){
      var p=Math.min(1,(t-t0)/ms);
      var v=Math.round(prev+(nn-prev)*(1-Math.pow(1-p,3)));
      el.textContent=pos+fmt(v);
      if(p<1)requestAnimationFrame(step);
      else{el.dataset.v=String(nn);if(prev!==nn){el.classList.remove('bump');void el.offsetWidth;el.classList.add('bump')}}
    }
    requestAnimationFrame(step);
  }

  // ---- Stats (meta) refresh ----
  function refreshMeta(){
    fetch('/v1/list/meta').then(function(r){return r.json()}).then(function(j){
      countTo(document.getElementById('sCount'),j.count,650);
      countTo(document.getElementById('sDay'),(j.day>0?'+':'')+j.day,650);
      countTo(document.getElementById('sWeek'),(j.week>0?'+':'')+j.week,650);
      countTo(document.getElementById('sPending'),j.pending,650);
      document.getElementById('sAgo').textContent=j.generatedAt?('刚刚同步 '+agoLong(j.generatedAt)):'每分钟同步'
    }).catch(function(){
      ['sCount','sDay','sWeek','sPending'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='—'})
    })
  }

  function refreshTrends(){
    fetch('/v1/list/trends?tz='+encodeURIComponent(new Date().getTimezoneOffset()))
      .then(function(r){return r.json()})
      .then(function(j){
        var hourly=(j.hourly||[]).slice(-24);
        var daily=j.daily||[];
        setText('trend24Total',plus(total(hourly)));
        setText('trend7Total',plus(total(daily)));
        setTicks('trend24Ticks',hourly.length?[0,4,8,12,16,20,23].map(function(i){return i===23?'现在':hourLabel(hourly[Math.min(i,hourly.length-1)].at)}):['—']);
        setTicks('trend7Ticks',daily.map(function(d){return dayLabel(d.at)}));
        setText('trendAgo',j.now?('刚刚同步 '+agoLong(j.now)):'刚刚同步');
        renderAreaChart(document.getElementById('trend24Chart'),hourly,'过去 24 小时每小时新增 spam');
        renderBarChart(document.getElementById('trend7Chart'),daily,'过去一周每天处理 spam');
      })
      .catch(function(){
        setText('trendAgo','趋势加载失败');
        var a=document.getElementById('trend24Chart');if(a)a.innerHTML='<div class="trend-empty">趋势加载失败</div>';
        var b=document.getElementById('trend7Chart');if(b)b.innerHTML='<div class="trend-empty">趋势加载失败</div>';
      })
  }

  // ---- Live feed (most recent 10) ----
  var feedEl=document.getElementById('feed');
  var feedAgo=document.getElementById('feedAgo');
  var feedAddedEl=document.getElementById('feedAdded');
  var rows=[];          // displayed (max 10)
  var latestAt=null;    // newest published_at we know of
  var addedThisSession=0;
  var lastPollAt=Date.now();

  function key(r){return (r.x_user_id||'')+'|'+r.handle}

  function avatarHtml(r){
    var url=r.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(r.handle));
    var fb=esc((r.handle||'?').slice(0,1).toUpperCase());
    return '<div class="av"><img src="'+esc(url)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\\'span\\'),{textContent:\\''+fb+'\\'}))"/></div>';
  }

  var EXT_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

  function rowHtml(r,fresh,idx){
    var lbl=r.verdict_label||'uncertain';
    var conf=typeof r.confidence==='number'?Math.round(r.confidence*100):0;
    var handleHref='https://x.com/'+encodeURIComponent(r.handle);
    var idxStr='#'+String(typeof idx==='number'?idx:0).padStart(2,'0');
    var rawName=(r.display_name||'').trim();
    var display=rawName||('@'+r.handle);
    var handleLower=String(r.handle||'').toLowerCase();
    var showHandle=rawName&&rawName.toLowerCase()!==handleLower&&rawName.toLowerCase()!==('@'+handleLower);
    return '<div class="feed-row '+esc(lbl)+(fresh?' new':'')+'" role="listitem">'
      +'<span class="idx">'+idxStr+'</span>'
      +avatarHtml(r)
      +'<div class="ident">'
        +'<span class="display"><a href="'+handleHref+'" target="_blank" rel="noopener noreferrer">'+esc(display)+'</a></span>'
        +(showHandle?'<span class="handle">@'+esc(r.handle)+'</span>':'')
        +'<span class="vlbl">'+esc(lbl)+'</span>'
      +'</div>'
      +'<span class="pct">'+conf+'%</span>'
      +'<span class="t">'+ago(r.published_at)+'</span>'
      +'<a class="x-link" href="'+handleHref+'" target="_blank" rel="noopener noreferrer" aria-label="去 X 主页">'+EXT_ICON+'</a>'
      +'</div>';
  }

  function renderInitial(){
    if(!rows.length){feedEl.innerHTML='<div class="feed-skel">暂无公开条目。</div>';return}
    // initial render — no "new" flash, just appear
    feedEl.innerHTML=rows.map(function(r,i){return rowHtml(r,false,i+1)}).join('');
  }

  function loadInitial(){
    return fetch('/v1/list?limit=6').then(function(r){return r.json()}).then(function(j){
      rows=(j.list||[]).slice(0,6);
      latestAt=j.latestAt;
      lastPollAt=Date.now();
      renderInitial();
      feedAgo.textContent='已同步 '+rows.length+' 条';
    }).catch(function(){
      feedEl.innerHTML='<div class="feed-skel">连接失败，稍后重试。</div>';
    })
  }

  function pollFeed(){
    if(!latestAt){return loadInitial()}
    fetch('/v1/list?limit=6&since='+latestAt).then(function(r){return r.json()}).then(function(j){
      lastPollAt=Date.now();
      var fresh=(j.list||[]).filter(function(r){return !rows.some(function(x){return key(x)===key(r)})});
      if(!fresh.length){feedAgo.textContent='暂无新增 · '+agoLong(lastPollAt);return}
      // Prepend new rows (newest first, animated). Cap at 10 total.
      var added=fresh.slice(0,6);
      latestAt=j.latestAt||latestAt;
      addedThisSession+=added.length;
      feedAddedEl.textContent=addedThisSession;
      var frag=document.createDocumentFragment();
      added.forEach(function(r,i){
        var div=document.createElement('div');
        div.innerHTML=rowHtml(r,!reduced,i+1);
        frag.appendChild(div.firstElementChild);
      });
      feedEl.insertBefore(frag,feedEl.firstChild);
      // Trim to 6 + re-number every visible row so #01 stays at the top
      while(feedEl.childElementCount>6){feedEl.removeChild(feedEl.lastElementChild)}
      rows=added.concat(rows).slice(0,6);
      Array.prototype.forEach.call(feedEl.querySelectorAll('.feed-row .idx'),
        function(el,i){el.textContent='#'+String(i+1).padStart(2,'0')});
      feedAgo.innerHTML='<strong>+'+added.length+' 条新增</strong> · '+agoLong(lastPollAt);
    }).catch(function(){feedAgo.textContent='网络不稳 · '+agoLong(lastPollAt)})
  }

  // ---- Boot ----
  refreshMeta();
  refreshTrends();
  loadInitial();
  setInterval(refreshMeta,60000);
  setInterval(refreshTrends,60000);
  setInterval(pollFeed,20000);
  // Keep relative timestamps fresh every 30s without hitting the API
  setInterval(function(){if(rows.length){feedEl.querySelectorAll('.feed-row').forEach(function(el,i){var t=el.querySelector('.t');if(t&&rows[i])t.textContent=ago(rows[i].published_at)});feedAgo.textContent='上次 '+agoLong(lastPollAt)}},30000);
})();
`;

// Pre-install risk interstitial. Self-contained IIFE so it stays independent
// of the live-feed boot script above. Shows the modal the first time a user
// clicks through to an install channel; once acknowledged (continue OR
// dismiss), a localStorage flag lets every later click pass straight through —
// so the dialog appears exactly once per browser.
const RISK_MODAL_JS = `
(function(){
  var KEY='mxga_risk_ack';
  var modal=document.getElementById('riskModal');
  if(!modal)return;
  var goBtn=document.getElementById('riskModalGo');
  var lastFocus=null;
  function acked(){try{return localStorage.getItem(KEY)==='1'}catch(e){return false}}
  function ack(){try{localStorage.setItem(KEY,'1')}catch(e){}}
  function open(url){
    lastFocus=document.activeElement;
    if(goBtn&&url)goBtn.setAttribute('href',url);
    modal.hidden=false;
    document.body.style.overflow='hidden';
    requestAnimationFrame(function(){modal.classList.add('show')});
    setTimeout(function(){try{goBtn&&goBtn.focus()}catch(e){}},30);
  }
  function close(){
    ack();
    modal.classList.remove('show');
    document.body.style.overflow='';
    setTimeout(function(){modal.hidden=true},220);
    try{lastFocus&&lastFocus.focus&&lastFocus.focus()}catch(e){}
  }
  // Intercept any jump to an install channel (skip the modal's own button,
  // which carries the resolved href).
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a[href*="chromewebstore"],a[href*="addons.mozilla"],a[href*="testflight.apple.com"]');
    if(!a||a.id==='riskModalGo')return;
    if(acked())return;            // already seen — let it through
    e.preventDefault();
    open(a.getAttribute('href'));
  });
  // Continue: record ack, let the anchor's default open the store in a new tab.
  if(goBtn)goBtn.addEventListener('click',function(){close()});
  modal.querySelectorAll('[data-risk-dismiss]').forEach(function(el){
    el.addEventListener('click',function(){close()});
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&!modal.hidden)close();
  });
})();
`;

export function landingHtml(): string {
  return layout({
    title: `${BRAND.name} · ${BRAND.tagline}`,
    current: "home",
    head: `<meta name="description" content="MXGA 是开源 X 扩展：标出广告号和色情引流号，拉黑由你确认。">`,
    body: HERO + NOTICE + FEED + TRENDS + PILLARS + TRUST + MODAL,
    script: SCRIPT + RISK_MODAL_JS,
  });
}
