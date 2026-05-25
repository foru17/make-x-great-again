// Product landing — public, zero-PII. Make X Great Again — passive
// ambient extension that makes X usable: 5 pillars, only Pillar 1 (Spam
// Shield) is shipped today; the rest are tagged Coming soon.
// Visual: base-ui inspired — monochrome canvas, type-led hierarchy.
import { BRAND } from "../brand";
import { LINKS, layout } from "./_layout";

const CSS = `
/* Hero */
.hero{padding:96px 0 72px;max-width:780px}
.hero .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--fg-3);padding:5px 10px;
  border:1px solid var(--border);border-radius:999px;margin-bottom:24px}
.hero .eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--ok);
  box-shadow:0 0 0 0 rgba(16,185,129,.45);animation:pulse 2.4s ease-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.45)}100%{box-shadow:0 0 0 6px rgba(16,185,129,0)}}
.hero h1{font-size:64px;line-height:1.02;letter-spacing:-.04em;font-weight:600;
  margin:0 0 22px;color:var(--fg)}
.hero h1 .sub{display:block;color:var(--fg-3);font-weight:500;letter-spacing:-.03em}
.hero .lede{font-size:17px;color:var(--fg-2);max-width:620px;margin-bottom:32px;
  line-height:1.6;letter-spacing:-.005em}
.hero .ctas{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}
.hero .meta{font-size:12.5px;color:var(--fg-4);display:flex;flex-wrap:wrap;
  gap:6px 14px;align-items:center}
.hero .meta .dot{width:3px;height:3px;border-radius:50%;background:var(--fg-4);opacity:.5}

/* Section */
section.block{padding:64px 0;border-top:1px solid var(--border)}
section.block h2{font-size:11.5px;letter-spacing:.18em;text-transform:uppercase;
  color:var(--fg-3);font-weight:600;margin-bottom:32px}

/* 5 Pillars — vertical stack of large cells, each labeled */
.pillars{display:grid;grid-template-columns:1fr;gap:1px;background:var(--border);
  border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden}
.pillar{display:grid;grid-template-columns:80px 1fr auto;gap:20px;padding:24px 28px;
  background:var(--bg);align-items:center;transition:background .15s}
.pillar:hover{background:var(--card)}
.pillar .n{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
  font-weight:600;color:var(--fg-4);letter-spacing:.05em}
.pillar .body h3{font-size:17px;font-weight:600;margin-bottom:6px;color:var(--fg);
  letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
.pillar .body p{font-size:13.5px;line-height:1.6;color:var(--fg-3);max-width:640px}
.pillar .status{font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;
  border:1px solid currentColor;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.pillar .status.live{color:var(--ok)}
.pillar .status.next{color:var(--accent)}
.pillar .status.soon{color:var(--fg-3)}

/* Trust — 4 governance bullets, themed glyphs */
.trust{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);
  border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden}
.trust .row{display:flex;gap:14px;align-items:flex-start;padding:22px 24px;background:var(--bg);
  transition:background .15s}
.trust .row:hover{background:var(--card)}
.trust .row .ic{width:28px;height:28px;flex-shrink:0;color:var(--ic,var(--fg-3));
  display:inline-flex;align-items:center;justify-content:center;
  border:1px solid color-mix(in srgb,var(--ic,var(--fg-3)) 30%,transparent);
  border-radius:var(--r-sm)}
.trust .row .ic svg{width:14px;height:14px}
.trust .row h3{font-size:14px;font-weight:600;margin-bottom:5px;color:var(--fg);letter-spacing:-.005em}
.trust .row p{font-size:13px;line-height:1.6;color:var(--fg-3)}

/* Stats */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);
  border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden}
.stat{padding:24px 24px 22px;background:var(--bg)}
.stat .n{font-size:36px;font-weight:600;letter-spacing:-.025em;font-variant-numeric:tabular-nums;
  line-height:1.05;color:var(--fg);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.stat .n.skel{display:inline-block;width:64px;height:38px;background:linear-gradient(90deg,
  var(--card),var(--card-hi),var(--card));
  background-size:200% 100%;animation:shim 1.4s ease-in-out infinite;border-radius:var(--r-sm);vertical-align:middle}
@keyframes shim{0%{background-position:200% 0}100%{background-position:-200% 0}}
.stat .lbl{font-size:12px;color:var(--fg-3);margin-top:10px;letter-spacing:.01em}
.stats-foot{margin-top:18px;font-size:12.5px;color:var(--fg-3);display:flex;
  align-items:center;gap:10px;flex-wrap:wrap}
.stats-foot a{color:var(--fg)}.stats-foot a:hover{color:var(--accent)}
.stats-foot .pip{display:inline-flex;align-items:center;gap:6px}
.stats-foot .pip i{width:5px;height:5px;border-radius:50%;background:var(--ok);
  box-shadow:0 0 0 0 rgba(16,185,129,.55);animation:pulse 2.4s ease-out infinite}

/* Install helper popover */
.install-note{margin-top:20px;font-size:13px;color:var(--fg-2);
  background:var(--card);border:1px solid var(--border);border-radius:var(--r);
  padding:14px 18px;max-width:560px;display:none;line-height:1.65}
.install-note.open{display:block;animation:slideIn .2s ease-out}
@keyframes slideIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
.install-note ol{margin:8px 0 0 20px}
.install-note li{margin:5px 0;color:var(--fg-2)}
.install-note code{background:var(--card-hi);padding:1px 6px;border-radius:var(--r-sm);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--fg)}

@media (max-width:760px){
  .hero{padding:64px 0 48px}
  .hero h1{font-size:40px;letter-spacing:-.03em}
  .pillar{grid-template-columns:1fr;gap:8px;padding:20px}
  .pillar .n{font-size:11px}
  .pillar .status{align-self:flex-start;margin-top:4px}
  .trust{grid-template-columns:1fr}
  .stats{grid-template-columns:1fr}
  section.block{padding:48px 0}
}
@media (max-width:440px){
  .hero h1{font-size:34px}
}
`;

const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
const ICON_GH = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>`;
const ICON_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`;
const ICON_SHIELD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>`;
const ICON_LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_DB = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`;
const ICON_USER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

const HERO = `
<section class="hero">
  <span class="eyebrow"><span class="dot" aria-hidden="true"></span>${BRAND.acronym}<span style="margin:0 8px;color:var(--fg-4)">·</span>开源 ${BRAND.license}</span>
  <h1>${BRAND.name}<br><span class="sub">让 X 值得刷。</span></h1>
  <p class="lede">装上 Chrome 就能用。浏览 X 时 AI 替你拦垃圾、识水军、汇热推——无感运行，零数据上传，完全开源。</p>
  <div class="ctas">
    <a class="btn primary" href="${LINKS.RELEASE_URL}" id="installBtn" aria-label="免费装到 Chrome">${ICON_DOWNLOAD}<span>免费装到 Chrome</span></a>
    <a class="btn" href="${BRAND.repo}" aria-label="在 GitHub 上查看源码">${ICON_GH}<span>查看源码</span></a>
    <a class="btn" href="/list" aria-label="看公榜">${ICON_LIST}<span>看公榜</span></a>
  </div>
  <p class="meta">
    <span>不存身份信息</span><span class="dot" aria-hidden="true"></span>
    <span>不发追踪请求</span><span class="dot" aria-hidden="true"></span>
    <span>不用注册账号</span><span class="dot" aria-hidden="true"></span>
    <span>每行代码都可查</span>
  </p>
  <div class="install-note" id="installNote" role="status">
    <strong>开发者模式手装</strong>（商店审核中，先这样用）：
    <ol>
      <li>下载并解压最新 <code>.zip</code></li>
      <li>浏览器地址栏输 <code>chrome://extensions</code>，右上角打开「开发者模式」</li>
      <li>点「加载已解压的扩展程序」，选刚解压的目录</li>
      <li>打开 x.com，扩展自动开始干活</li>
    </ol>
  </div>
</section>
`;

const PILLARS = `
<section class="block">
  <h2>装上之后，它在你刷 X 时悄悄做这 5 件事</h2>
  <div class="pillars">
    <div class="pillar">
      <div class="n">01</div>
      <div class="body">
        <h3>自动拦垃圾</h3>
        <p>评论区的色情号、广告号被自动识别，内联打标，一键真·拉黑（直接点 X 自带的屏蔽按钮，多端同步）。3 个独立 GitHub 用户都标过的会进公榜，所有人共享。</p>
      </div>
      <span class="status live">● 已上线</span>
    </div>
    <div class="pillar">
      <div class="n">02</div>
      <div class="body">
        <h3>一秒识水军</h3>
        <p>鼠标移到任何 @handle 上，弹小卡片：注册多久、原创多少、聊什么、谁在和他互动。一眼看清是真号、营销号还是蹭流量的。</p>
      </div>
      <span class="status next">下一站</span>
    </div>
    <div class="pillar">
      <div class="n">03</div>
      <div class="body">
        <h3>历史一键看</h3>
        <p>打开任何人的主页，侧栏自动展开：他平时主要在聊什么、本月最热的几条、什么时段最活跃。关不关注，30 秒看完决定。</p>
      </div>
      <span class="status soon">规划中</span>
    </div>
    <div class="pillar">
      <div class="n">04</div>
      <div class="body">
        <h3>看清谁在带节奏</h3>
        <p>刷推时如果有「你关注的 3 个人转过」「真实传播范围」会自动提示。让重要的内容能穿过算法直达你眼前。</p>
      </div>
      <span class="status soon">规划中</span>
    </div>
    <div class="pillar">
      <div class="n">05</div>
      <div class="body">
        <h3>数据随时带走</h3>
        <p>你自己的关注、收藏、推文，一键存成 JSON 或 Markdown。整个过程在浏览器里完成，一字节不上传。</p>
      </div>
      <span class="status soon">规划中</span>
    </div>
  </div>
</section>
`;

const TRUST = `
<section class="block">
  <h2>开源透明，四项保证</h2>
  <div class="trust">
    <div class="row" style="--ic:#10b981"><span class="ic">${ICON_SHIELD}</span><div><h3>AI 不能单独「定罪」</h3><p>任何账号进公榜，必须有人工审核 或 至少 3 个独立 GitHub 用户都标过。这条规则直接写在数据库里，改不了，不靠承诺。</p></div></div>
    <div class="row" style="--ic:#38bdf8"><span class="ic">${ICON_LOCK}</span><div><h3>不存任何身份信息</h3><p>服务端只存 X 的公开数字 ID + 举报人的 GitHub 数字 ID。你的浏览历史、关注列表、Cookie，一字节都不上传。</p></div></div>
    <div class="row" style="--ic:#f59e0b"><span class="ic">${ICON_DB}</span><div><h3>每一条决策可查</h3><p>谁、什么时候、对哪个账号做了什么操作，全在 review_log 里。改主意了？删除有完整轨迹，不偷偷消失。</p></div></div>
    <div class="row" style="--ic:#a855f7"><span class="ic">${ICON_USER}</span><div><h3>上报需 GitHub 登录</h3><p>用 GitHub Device Flow，扫码即可。反刷分、反恶意举报。不强迫你单独注册账号。</p></div></div>
  </div>
</section>
`;

const LIVE = `
<section class="block">
  <h2>正在跑的数据，不是 PPT</h2>
  <div class="stats">
    <div class="stat"><div class="n" id="sCount"><span class="skel"></span></div><div class="lbl">已确认的垃圾 / 色情号</div></div>
    <div class="stat"><div class="n" id="sWeek"><span class="skel"></span></div><div class="lbl">本周新增</div></div>
    <div class="stat"><div class="n" id="sPending"><span class="skel"></span></div><div class="lbl">排队等人工复核</div></div>
  </div>
  <p class="stats-foot">
    <span class="pip"><i aria-hidden="true"></i><span id="sAgo">60 秒同步一次</span></span>
    <span class="sep">·</span>
    <a href="/list">完整公榜 →</a>
  </p>
</section>
`;

const SCRIPT = `
(function(){
  var btn=document.getElementById('installBtn'),note=document.getElementById('installNote');
  if(btn&&note){btn.addEventListener('click',function(e){if(!note.classList.contains('open')){e.preventDefault();note.classList.add('open');setTimeout(function(){window.location=btn.href},900)}})}
  var fmt=function(n){return typeof n==='number'?n.toLocaleString('zh-CN'):'—'};
  var ago=function(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<60)return s+' 秒前';var m=Math.round(s/60);if(m<60)return m+' 分钟前';var h=Math.round(m/60);if(h<24)return h+' 小时前';return Math.round(h/24)+' 天前'};
  var refresh=function(){
    fetch('/v1/list/meta').then(function(r){return r.json()}).then(function(j){
      document.getElementById('sCount').textContent=fmt(j.count);
      document.getElementById('sWeek').textContent=(j.week>0?'+':'')+fmt(j.week);
      document.getElementById('sPending').textContent=fmt(j.pending);
      document.getElementById('sAgo').textContent=j.generatedAt?('刚刚同步 '+ago(j.generatedAt)):'60 秒同步一次'
    }).catch(function(){
      ['sCount','sWeek','sPending'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='—'})
    })
  };
  refresh();
  setInterval(refresh,60000);
})();
`;

export function landingHtml(): string {
  return layout({
    title: `${BRAND.name} · ${BRAND.tagline}`,
    current: "home",
    css: CSS,
    head: `<meta name="description" content="${BRAND.name} — 一个被动的 X(Twitter) 旁路扩展：Spam 净化 + KOL 信号分 + 摘要 + 社交图谱。开源 ${BRAND.license}，不收集 PII。">`,
    body: HERO + PILLARS + TRUST + LIVE,
    script: SCRIPT,
  });
}
