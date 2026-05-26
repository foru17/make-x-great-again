// Product landing — public, zero-PII. MXGA — the passive Chrome extension
// that identifies spam / porn-ad bots on X and hands you a one-click block.
// Visual: base-ui inspired — monochrome canvas, type-led hierarchy.
import { BRAND } from "../brand";
import { ICONS, LINKS, layout } from "./_layout";

const CSS = `
/* Hero — Claude-inspired warm display: serif h1 for character, X glyph
   in the eyebrow chip to anchor "this is for X" instantly.
   .hero-row is the outer flex container with the mascot on the right;
   .hero is the text column (text/eyebrow/h1/lede/CTAs/meta/install-note). */
.hero-row{display:grid;grid-template-columns:minmax(0,1fr) 360px;align-items:start;gap:48px;
  padding:56px 0 34px;max-width:none}
.hero{min-width:0;padding:0;max-width:680px}
.hero-side{display:flex;flex-direction:column;align-items:center;gap:18px;min-width:0}
.hero-mascot{width:320px;display:flex;align-items:center;justify-content:center;
  animation:bird-bob 4s ease-in-out infinite;transform-origin:50% 100%}
.hero-mascot img{width:100%;height:auto;display:block;
  filter:drop-shadow(0 18px 32px rgba(29,161,242,.18)) drop-shadow(0 4px 10px rgba(0,0,0,.08))}
@keyframes bird-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@media (max-width:920px){
  .hero-row{grid-template-columns:1fr;gap:22px;padding:44px 0 28px}
  .hero-side{display:grid;grid-template-columns:118px minmax(0,1fr);align-items:center;
    gap:18px;max-width:560px}
  .hero-mascot{width:118px;justify-self:center}
  .hero-stats{max-width:none}
  .hero-stats .stats-foot{justify-content:flex-start}
}
@media (prefers-reduced-motion:reduce){.hero-mascot{animation:none}}
.hero .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--fg-2);padding:6px 12px;
  border:1px solid var(--border-strong);border-radius:999px;margin-bottom:26px;
  background:var(--card);box-shadow:var(--shadow-card)}
.hero .eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--ok);
  box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 50%,transparent);
  animation:pulse 2.4s ease-out infinite}
.hero .eyebrow .x{width:11px;height:11px;color:var(--fg)}
.hero .eyebrow .sep{color:var(--fg-4);margin:0 1px}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 50%,transparent)}100%{box-shadow:0 0 0 6px transparent}}
.hero h1{font-family:var(--font-serif);font-size:68px;line-height:1.04;
  letter-spacing:-.025em;font-weight:500;margin:0 0 22px;color:var(--fg)}
.hero h1 .sub{display:block;color:var(--fg-3);font-weight:400;letter-spacing:-.02em;
  font-style:italic;font-size:.85em;margin-top:4px}
.hero h1 .xmark{display:inline-flex;width:.78em;height:.78em;vertical-align:-0.06em;
  margin:0 .04em;color:var(--fg)}
.hero h1 .xmark svg{width:100%;height:100%}
.hero .eyebrow .x svg{width:100%;height:100%}
.hero .lede{font-size:17px;color:var(--fg-2);max-width:560px;margin-bottom:28px;
  line-height:1.65;letter-spacing:-.005em}
.hero .ctas{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}
.hero .meta{font-size:12.5px;color:var(--fg-4);display:flex;flex-wrap:wrap;
  gap:6px 14px;align-items:center}
.hero .meta .dot{width:3px;height:3px;border-radius:50%;background:var(--fg-4);opacity:.5}

/* Section */
section.block{padding:64px 0;border-top:1px solid var(--border)}
section.block h2{font-size:11.5px;letter-spacing:.18em;text-transform:uppercase;
  color:var(--fg-3);font-weight:600;margin-bottom:32px}

/* Pillars — vertical stack of large cells, each labeled */
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

/* First-screen stats */
.hero-stats{width:100%;max-width:380px}
.hero-stats .stats-foot{justify-content:center}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);
  border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden}
.stat{padding:16px 14px 15px;background:var(--bg);min-width:0}
.stat .n{font-size:25px;font-weight:600;letter-spacing:-.025em;font-variant-numeric:tabular-nums;
  line-height:1.05;color:var(--fg);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.stat .skel{display:inline-block;width:46px;height:26px;background:linear-gradient(90deg,
  var(--card),var(--card-hi),var(--card));
  background-size:200% 100%;animation:shim 1.4s ease-in-out infinite;border-radius:var(--r-sm);vertical-align:middle}
@keyframes shim{0%{background-position:200% 0}100%{background-position:-200% 0}}
.stat .lbl{font-size:11px;color:var(--fg-3);margin-top:8px;letter-spacing:.01em;white-space:nowrap}
.stat .n.bump{animation:bump .55s cubic-bezier(.34,1.56,.64,1)}
@keyframes bump{0%{transform:scale(1)}38%{transform:scale(1.08)}100%{transform:scale(1)}}
.stats-foot{margin-top:12px;font-size:12px;color:var(--fg-3);display:flex;
  align-items:center;gap:10px;flex-wrap:wrap}
.stats-foot a{color:var(--fg)}.stats-foot a:hover{color:var(--accent)}
.stats-foot .pip{display:inline-flex;align-items:center;gap:6px}
.stats-foot .pip i{width:5px;height:5px;border-radius:50%;background:var(--ok);
  box-shadow:0 0 0 0 rgba(16,185,129,.55);animation:pulse 2.4s ease-out infinite}

/* FEED block — sits directly under hero, no big section header.
   feed-head is a quiet eyebrow + "see all" link, then the feed itself. */
.feed-block{padding:4px 0 48px;max-width:none}
.feed-head{display:flex;align-items:center;justify-content:space-between;gap:14px;
  margin-bottom:12px;padding:0 2px}
.feed-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--fg-3)}
.feed-eyebrow .sep{color:var(--fg-4);margin:0 2px;opacity:.7}
.feed-eyebrow .live-dot{width:6px;height:6px;border-radius:50%;background:var(--ok);
  box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 50%,transparent);
  animation:pulse 2.2s ease-out infinite}
.feed-more{font-size:12.5px;color:var(--fg-2);transition:color .15s}
.feed-more:hover{color:var(--accent)}

/* Live feed — scoreboard style. Row index + monospace numerals + a slow
   vertical scan-beam crossing the panel to evoke a "board that's running". */
.feed{position:relative;display:flex;flex-direction:column;gap:1px;background:var(--border);
  border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;
  box-shadow:var(--shadow-card);font-feature-settings:"tnum","cv11"}
.feed::after{content:"";position:absolute;left:0;right:0;height:80px;pointer-events:none;
  background:linear-gradient(180deg,transparent 0%,
    color-mix(in srgb,var(--accent) 12%,transparent) 45%,
    color-mix(in srgb,var(--accent) 20%,transparent) 50%,
    color-mix(in srgb,var(--accent) 12%,transparent) 55%,transparent 100%);
  animation:scan 6s ease-in-out infinite}
@keyframes scan{
  0%{top:-80px;opacity:0}
  10%{opacity:.55}
  90%{opacity:.55}
  100%{top:100%;opacity:0}
}
@media (prefers-reduced-motion:reduce){.feed::after{display:none}}
.feed-row{position:relative;display:grid;grid-template-columns:30px 28px 1fr auto auto auto;
  gap:12px;align-items:center;padding:10px 16px 10px 18px;background:var(--bg);
  transition:background .15s;z-index:1}
.feed-row .idx{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:10.5px;font-weight:600;color:var(--fg-4);letter-spacing:.04em;
  text-align:right}
.feed-row::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;
  background:var(--ec,transparent)}
.feed-row.spam,.feed-row.likely_spam{--ec:var(--danger)}
.feed-row.porn_bot{--ec:var(--violet)}
.feed-row.uncertain{--ec:var(--fg-4)}
.feed-row.legit{--ec:var(--ok)}
.feed-row:hover{background:var(--card)}
.feed-row .av{width:28px;height:28px;border-radius:50%;overflow:hidden;background:var(--card-hi);
  display:flex;align-items:center;justify-content:center;color:var(--fg-4);font-size:11.5px;
  font-weight:600;flex-shrink:0}
.feed-row .av img{width:100%;height:100%;object-fit:cover;display:block}
.feed-row .ident{min-width:0;display:flex;align-items:baseline;gap:7px;overflow:hidden}
.feed-row .display{font-size:13px;font-weight:600;color:var(--fg);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.005em;min-width:0}
.feed-row .display a{color:inherit}.feed-row .display a:hover{color:var(--accent)}
.feed-row .handle{font-size:11.5px;color:var(--fg-3);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;flex-shrink:0;max-width:18ch}
.feed-row .vlbl{display:inline-block;font-size:10px;font-weight:600;color:var(--ec,var(--fg-3));
  text-transform:uppercase;letter-spacing:.06em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  flex-shrink:0}
.feed-row .pct{font-size:11.5px;color:var(--fg-2);font-variant-numeric:tabular-nums;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-width:32px;text-align:right}
.feed-row .t{font-size:11.5px;color:var(--fg-3);font-variant-numeric:tabular-nums;
  min-width:58px;text-align:right}
.feed-row .x-link{color:var(--fg-4);display:inline-flex;padding:5px;border-radius:var(--r-sm);
  transition:background .15s,color .15s}
.feed-row .x-link:hover{background:var(--card-hi);color:var(--fg)}
.feed-row .x-link svg{width:13px;height:13px}
/* New-row entrance animation — scoreboard split-flap inspired vertical flip */
.feed-row.new{animation:feedIn .55s cubic-bezier(.22,1.18,.36,1) both;
  transform-origin:50% 0%}
@keyframes feedIn{
  0%{opacity:0;transform:translateY(-22px) rotateX(-50deg)}
  60%{opacity:1}
  100%{opacity:1;transform:none}
}
.feed-row.new::after{content:"";position:absolute;inset:0;border-radius:0;
  background:linear-gradient(90deg,transparent,
    color-mix(in srgb,var(--accent) 22%,transparent),transparent);
  background-size:200% 100%;animation:feedFlash 1.1s ease-out;pointer-events:none}
@keyframes feedFlash{
  0%{background-position:200% 0;opacity:1}
  100%{background-position:-200% 0;opacity:0}
}
/* Staggered cascade — when many new rows arrive together, ripple them */
.feed-row.new:nth-child(2){animation-delay:.06s}
.feed-row.new:nth-child(3){animation-delay:.12s}
.feed-row.new:nth-child(4){animation-delay:.18s}
.feed-row.new:nth-child(5){animation-delay:.24s}
.feed-row.new:nth-child(6){animation-delay:.30s}
@media (prefers-reduced-motion:reduce){
  .feed-row.new{animation:none}
  .feed-row.new::after{display:none}
}
.feed-foot{margin-top:14px;font-size:12px;color:var(--fg-3);display:flex;
  align-items:center;gap:10px;flex-wrap:wrap;padding:0 2px}
.feed-foot strong{color:var(--fg);font-weight:600;font-variant-numeric:tabular-nums}
.feed-foot a{color:var(--fg)}.feed-foot a:hover{color:var(--accent)}
.feed-skel{padding:30px 20px;text-align:center;color:var(--fg-3);font-size:12.5px}

@media (max-width:560px){
  .feed-row{grid-template-columns:24px 1fr auto auto;gap:8px;padding:9px 14px 9px 16px}
  .feed-row .idx{display:none}
  .feed-row .av{width:24px;height:24px;font-size:10.5px}
  .feed-row .ident{gap:5px}
  .feed-row .handle{max-width:14ch;font-size:11px}
  .feed-row .vlbl{display:none}
  .feed-row .x-link{display:none}
}

/* Install helper — disclosure for non-Chrome browsers / dev builds.
   Lives below the hero meta as a quiet, collapsed-by-default <details>. */
.install-alt{margin-top:18px;max-width:560px;font-size:12.5px;color:var(--fg-3);
  border:1px solid var(--border);border-radius:var(--r);background:var(--card);
  padding:0 14px}
.install-alt summary{cursor:pointer;padding:11px 0;list-style:none;color:var(--fg-2);
  display:flex;align-items:center;gap:8px;font-weight:500}
.install-alt summary::-webkit-details-marker{display:none}
.install-alt summary::before{content:"›";display:inline-block;color:var(--fg-4);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;
  transition:transform .15s;width:10px;text-align:center}
.install-alt[open] summary::before{transform:rotate(90deg)}
.install-alt[open] summary{border-bottom:1px solid var(--border);margin-bottom:10px}
.install-alt ol{margin:6px 0 12px 22px;line-height:1.7}
.install-alt li{color:var(--fg-2);margin:3px 0}
.install-alt code{background:var(--card-hi);padding:1px 6px;border-radius:var(--r-sm);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--fg)}
.install-alt a{color:var(--fg);text-decoration:underline;text-decoration-color:var(--border-strong);
  text-underline-offset:2px}
.install-alt a:hover{color:var(--accent)}

@media (max-width:760px){
  .hero{padding:0}
  .hero h1{font-size:40px;letter-spacing:-.03em}
  .hero .lede{font-size:16px;margin-bottom:24px}
  .pillar{grid-template-columns:1fr;gap:8px;padding:20px}
  .pillar .n{font-size:11px}
  .pillar .status{align-self:flex-start;margin-top:4px}
  .trust{grid-template-columns:1fr}
  .stats{grid-template-columns:repeat(3,1fr)}
  .stat{padding:14px 10px}
  .stat .n{font-size:22px}
  .stat .lbl{font-size:10.5px}
  section.block{padding:48px 0}
}
@media (max-width:440px){
  .hero-row{gap:18px;padding:34px 0 24px}
  .hero .eyebrow{margin-bottom:20px}
  .hero h1{font-size:34px}
  .hero .ctas{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .hero .ctas .btn{min-height:42px;padding:10px 10px}
  .hero .ctas .btn.primary{grid-column:1/-1}
  .hero .meta{font-size:12px}
  .hero-side{grid-template-columns:72px minmax(0,1fr);gap:10px}
  .hero-mascot{width:72px}
  .hero-mascot img{filter:drop-shadow(0 10px 20px rgba(29,161,242,.14))}
  .stat{padding:10px 7px}
  .stat .n{font-size:18px}
  .stat .lbl{font-size:10px;margin-top:5px}
  .stats-foot{margin-top:9px;font-size:11.5px}
}
`;

// Lucide-style Chrome glyph: outer circle + inner circle + three spokes.
// Monochrome stroke to match the rest of the design system; we don't use the
// brand multi-color disc on this surface because it'd clash with our type-led
// hierarchy. The official CWS page is the user's visual confirmation of brand.
const ICON_CHROME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/><line x1="10.88" y1="21.94" x2="15.46" y2="14"/></svg>`;
const ICON_GH = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>`;
const ICON_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`;
const ICON_SHIELD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>`;
const ICON_LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_DB = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`;
const ICON_USER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

const HERO_STATS = `
<div class="hero-stats" aria-label="当前运行数据">
  <div class="stats">
    <div class="stat"><div class="n" id="sCount" data-v="0"><span class="skel"></span></div><div class="lbl">已确认</div></div>
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
    Chrome 扩展<span class="sep">·</span>${BRAND.license} 开源
  </span>
  <h1>Make <span class="xmark">${ICONS.X}</span> Great Again<br><span class="sub">少看垃圾，多看人话。</span></h1>
  <p class="lede">广告号、色情引流先标出；拉黑由你确认。</p>
  <div class="ctas">
    <a class="btn primary" href="${BRAND.chromeWebStore}" target="_blank" rel="noopener" aria-label="从 Chrome Web Store 安装扩展">${ICON_CHROME}<span>从 Chrome 商店安装</span></a>
    <a class="btn" href="/list" aria-label="看公开名单">${ICON_LIST}<span>看公开名单</span></a>
    <a class="btn" href="${BRAND.repo}" aria-label="在 GitHub 上查看源码">${ICON_GH}<span>看源码</span></a>
  </div>
  <p class="meta">
    <span>已上架 Chrome Web Store</span><span class="dot" aria-hidden="true"></span>
    <span>手动拉黑</span><span class="dot" aria-hidden="true"></span>
    <span>不存身份</span><span class="dot" aria-hidden="true"></span>
    <span>开源</span>
  </p>
  <details class="install-alt">
    <summary>用 Edge / Brave / Arc，或想跑开发版？</summary>
    <ol>
      <li>从 <a href="${LINKS.RELEASE_URL}" target="_blank" rel="noopener">GitHub Release</a> 下载最新 <code>.zip</code> 并解压</li>
      <li>打开 <code>chrome://extensions</code>，开启「开发者模式」</li>
      <li>点「加载已解压的扩展程序」</li>
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
    <div class="row" style="--ic:#f59e0b"><span class="ic">${ICON_DB}</span><div><h3>操作留痕</h3><p>加入、移除、白名单、驳回都有记录；完整数据每 6h 同步到 <a href="${BRAND.repo}/tree/main/data" target="_blank" rel="noopener" style="color:var(--accent)">仓库 data/</a>，git history 可审计。</p></div></div>
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
  function ago(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<10)return'刚刚';if(s<60)return s+'s';var m=Math.round(s/60);if(m<60)return m+'m';var h=Math.round(m/60);if(h<24)return h+'h';return Math.round(h/24)+'d'}
  function agoLong(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<60)return s+' 秒前';var m=Math.round(s/60);if(m<60)return m+' 分钟前';var h=Math.round(m/60);if(h<24)return h+' 小时前';return Math.round(h/24)+' 天前'}

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
      countTo(document.getElementById('sWeek'),(j.week>0?'+':'')+j.week,650);
      countTo(document.getElementById('sPending'),j.pending,650);
      document.getElementById('sAgo').textContent=j.generatedAt?('刚刚同步 '+agoLong(j.generatedAt)):'每分钟同步'
    }).catch(function(){
      ['sCount','sWeek','sPending'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='—'})
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
  loadInitial();
  setInterval(refreshMeta,60000);
  setInterval(pollFeed,20000);
  // Keep relative timestamps fresh every 30s without hitting the API
  setInterval(function(){if(rows.length){feedEl.querySelectorAll('.feed-row').forEach(function(el,i){var t=el.querySelector('.t');if(t&&rows[i])t.textContent=ago(rows[i].published_at)});feedAgo.textContent='上次 '+agoLong(lastPollAt)}},30000);
})();
`;

export function landingHtml(): string {
  return layout({
    title: `${BRAND.name} · ${BRAND.tagline}`,
    current: "home",
    css: CSS,
    head: `<meta name="description" content="MXGA 是开源 X 扩展：标出广告号和色情引流号，拉黑由你确认。">`,
    body: HERO + FEED + PILLARS + TRUST,
    script: SCRIPT,
  });
}
