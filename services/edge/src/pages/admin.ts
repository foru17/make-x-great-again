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
.btn.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.btn.ok:hover{background:color-mix(in srgb,var(--ok) 10%,transparent)}
/* blacklist = primary action on a spam queue: solid red.
   Semantic: "approve" verdict → entry goes on public board (i.e. blacklisted). */
.btn.blacklist{background:var(--danger);color:#fff;border-color:var(--danger);font-weight:600}
.btn.blacklist:hover{background:color-mix(in srgb,var(--danger) 88%,#000)}
/* muted = secondary destructive (remove from dataset, not a public action) */
.btn.muted{color:var(--fg-3);border-color:var(--border-strong)}
.btn.muted:hover{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 30%,transparent);background:var(--danger-soft)}
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

/* Batch action bar — always present so the master "全选" checkbox is
   discoverable; bulk action buttons hide until at least one row is selected. */
.batch{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:10px 14px;margin-bottom:12px;border-radius:var(--r-lg);
  background:var(--card-hi);border:1px solid var(--border-strong)}
.batch .meta{font-size:13px;color:var(--fg);display:inline-flex;align-items:center;gap:10px;
  cursor:pointer;user-select:none}
.batch .meta input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent);cursor:pointer;margin:0}
.batch .meta b{color:var(--fg);font-variant-numeric:tabular-nums}
.batch .meta .hint{color:var(--fg-3);font-size:11.5px;margin-left:6px}
.batch .actions{display:none;gap:8px;flex-wrap:wrap}
.batch.on .actions{display:flex;animation:slidein .25s ease-out}
@keyframes slidein{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
/* Load-more footer under paginated row lists */
.more-foot{text-align:center;padding:16px 0 4px;color:var(--fg-3);font-size:12.5px}
.more-foot .btn{margin-right:8px}

/* Search + advanced filter bar — lives above the chip row in the queue tab. */
.search-bar{margin-bottom:12px;display:flex;flex-direction:column;gap:8px}
.search-bar .search-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.search-bar .search-input{flex:1;min-width:240px;padding:8px 12px;border-radius:var(--r);
  border:1px solid var(--border-strong);background:var(--bg-2);color:var(--fg);
  font-size:13px;font-family:inherit}
.search-bar .search-input:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:var(--accent)}
.search-bar .search-input::placeholder{color:var(--fg-4)}
.adv-panel{background:var(--card);border:1px solid var(--border);border-radius:var(--r);
  padding:12px 14px;font-size:12.5px}
/* When collapsed (no 'open' attribute), hide the entire panel — otherwise
   its bg + border + padding render as a stray gray box between the search
   input and the verdict chips. The toggle button '更多筛选' sets 'open' via
   JS so the panel reappears as a normal block. */
.adv-panel:not([open]){display:none}
.adv-panel summary{cursor:pointer}
.adv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 14px}
.adv-grid label{display:flex;flex-direction:column;gap:4px}
.adv-grid label > span{color:var(--fg-3);font-size:11.5px;letter-spacing:.02em}
.adv-grid .adv-input{padding:6px 9px;border-radius:var(--r-sm);border:1px solid var(--border-strong);
  background:var(--bg-2);color:var(--fg);font-size:12.5px;font-family:inherit}
.adv-grid .adv-input:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:var(--accent)}
.adv-hint{margin-top:8px;color:var(--fg-4);font-size:11px}

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
.qrow .who .name a{color:inherit}.qrow .who .name a:hover{color:var(--accent)}
.qrow .who .name .vlbl{margin-left:6px;font-size:10.5px;font-weight:500;color:var(--ec,var(--fg-3));
  text-transform:uppercase;letter-spacing:.06em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.qrow .who .sub{font-size:11.5px;color:var(--fg-3);margin-top:3px;display:flex;
  align-items:center;gap:6px;flex-wrap:wrap}
.qrow .who .sub a{color:var(--fg-2)}.qrow .who .sub a:hover{color:var(--accent)}
.qrow .who .sub .sep{color:var(--fg-4);opacity:.5}
.qrow .who .sub .id-chip{display:inline-flex;align-items:center;max-width:24ch;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:10.5px;color:var(--fg-2);padding:1px 6px;border-radius:var(--r-sm);
  background:var(--card);border:1px solid var(--border)}
.qrow .who .ev{margin-top:5px;font-size:11.5px;color:var(--fg-2);font-style:italic;
  line-height:1.45;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;max-width:560px}
/* Confidence cell — single line: big % colored by verdict severity.
   We removed an earlier fat bar (it left a blank-looking rectangle below
   the % in light mode). Conf% IS the entire signal. */
.qrow .conf{display:flex;align-items:baseline;gap:6px;min-width:80px;justify-content:flex-start}
.qrow .conf .pct{font-size:18px;color:var(--ec,var(--fg));font-weight:700;font-variant-numeric:tabular-nums;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1;letter-spacing:-.01em}
.qrow .conf .pct .lbl{font-size:9.5px;color:var(--fg-3);margin-left:4px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-family:inherit}
/* Reporters cell — chip when ≥3, muted text otherwise */
.qrow .rep{font-size:12px;color:var(--fg-3);font-variant-numeric:tabular-nums;text-align:right}
.qrow .rep .chip-ok{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;
  border-radius:999px;color:var(--ok);border:1px solid color-mix(in srgb,var(--ok) 40%,transparent);
  background:color-mix(in srgb,var(--ok) 8%,transparent);font-weight:600;font-size:11.5px;letter-spacing:.02em}
.qrow .acts{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}

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
/* approve == "blacklist": entry goes on the public board → danger red.
   whitelist_add == admin marks safe → ok green. */
.lrow .act.approve,.lrow .act.auto_confirm{color:var(--danger)}
.lrow .act.whitelist_add,.lrow .act.whitelist{color:var(--ok)}
.lrow .act.reject,.lrow .act.remove,.lrow .act.whitelist_remove{color:var(--fg-3)}
.lrow .actor{color:var(--fg-3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.lrow .h a{color:var(--fg)}.lrow .h a:hover{color:var(--accent)}
.lrow .n{color:var(--fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.empty{padding:60px 20px;text-align:center;color:var(--fg-3);border:1px dashed var(--border);
  border-radius:var(--r-lg)}
.status{color:var(--fg-3);font-size:12px}

/* ──────────────────────────────────────────────────────────────────────
   Modal (mxModal) — replaces window.confirm / prompt so destructive
   actions (拉黑 / 移除白名单 / 退出) share the admin design language.
   Backdrop blur, themed card, focus-trap, Esc-cancel, Enter-confirm.
   ────────────────────────────────────────────────────────────────────── */
.mx-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);
  display:flex;align-items:center;justify-content:center;z-index:9999;
  animation:mxfade .14s ease-out;padding:16px}
.mx-card{width:min(440px,100%);background:var(--bg);color:var(--fg);
  border:1px solid var(--border-strong);border-radius:var(--r-lg);
  box-shadow:0 24px 64px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.2);
  animation:mxpop .18s cubic-bezier(.16,1,.3,1);overflow:hidden}
.mx-card h3{padding:20px 22px 6px;font-size:15px;font-weight:600;letter-spacing:-.005em;color:var(--fg)}
.mx-card .body{padding:4px 22px 18px;font-size:13px;color:var(--fg-2);line-height:1.65}
.mx-card .body p{margin-bottom:6px}.mx-card .body p:last-child{margin-bottom:0}
.mx-card .body b{color:var(--fg);font-weight:600}
.mx-card .fields{padding:4px 22px 16px;display:flex;flex-direction:column;gap:12px}
.mx-card .fld label{display:block;font-size:11px;color:var(--fg-3);margin-bottom:5px;
  letter-spacing:.04em;text-transform:uppercase;font-weight:600}
.mx-card .fld label .req{color:var(--danger);margin-left:2px}
.mx-card .fld input{width:100%;padding:8px 12px;font-size:13px}
.mx-card .fld .hint{margin-top:5px;font-size:11px;color:var(--fg-4);line-height:1.5}
.mx-card .foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px 18px;
  border-top:1px solid var(--border);background:var(--card)}
.mx-card .foot .btn{min-width:72px}
@keyframes mxfade{from{opacity:0}to{opacity:1}}
@keyframes mxpop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.mx-bg,.mx-card{animation-duration:.001ms!important}}

@media (max-width:880px){
  .wrap{padding:18px 18px 48px}
  .qrow{grid-template-columns:22px 36px 1fr 80px auto;gap:10px;padding:10px 12px 10px 14px}
  .qrow .conf{min-width:70px}
  .qrow .conf .bar{width:70px}
  .qrow .rep{display:none}
  .lrow{grid-template-columns:1fr;gap:4px;padding:10px 12px}
  .lrow.head{display:none}
}
@media (max-width:640px){
  .wrap{padding:14px 12px 38px}
  .bar{align-items:flex-start;margin-bottom:16px;padding-bottom:16px}
  .bar h1{font-size:15px;line-height:1.35}
  .bar h1 svg{width:18px;height:18px}
  .bar .sub{font-size:12px;line-height:1.65}
  .bar .right{width:100%;justify-content:space-between}
  .tabs{margin:0 -12px 14px;padding:0 12px 6px;overflow-x:auto;scrollbar-width:none}
  .tabs::-webkit-scrollbar{display:none}
  .tabs button{flex:0 0 auto;min-height:38px;padding:8px 12px}
  .toolbar{align-items:stretch;padding:10px;margin-bottom:12px}
  .toolbar .r{width:100%;justify-content:space-between}
  .toolbar select{flex:1;min-width:0}
  .chips{width:100%;flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
  .chips::-webkit-scrollbar{display:none}
  .chip{flex:0 0 auto;min-height:34px}
  .batch{align-items:stretch;flex-direction:column;padding:10px;margin-bottom:10px}
  .batch .actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
  .batch .actions .btn{min-height:38px;padding:0 8px}
  .qrow{grid-template-columns:22px 34px minmax(0,1fr) 58px;
    grid-template-areas:"check av who conf" ". . acts acts";
    align-items:start;gap:8px 10px;padding:12px 10px 12px 13px}
  .qrow input[type=checkbox]{grid-area:check;margin-top:9px}
  .qrow .av{grid-area:av;width:34px;height:34px;font-size:12px}
  .qrow .who{grid-area:who}
  .qrow .who .name{font-size:13px}
  .qrow .who .name .vlbl{display:block;width:max-content;margin:4px 0 0}
  .qrow .who .sub{font-size:11px;gap:5px;line-height:1.45}
  .qrow .who .ev{font-size:11.5px;line-height:1.5;max-width:none;-webkit-line-clamp:2}
  .qrow .conf{grid-area:conf;min-width:0;justify-content:flex-end;text-align:right}
  .qrow .conf .pct{font-size:15px}
  .qrow .conf .pct .lbl{display:block;margin:3px 0 0;font-size:9px}
  .qrow > span:empty{display:none}
  .qrow .acts{grid-area:acts;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
    gap:6px;width:100%;justify-content:stretch;margin-top:2px}
  .qrow .acts .btn{min-height:40px;padding:0 8px;white-space:normal;line-height:1.15}
  .locked{align-items:flex-start;padding-top:12vh}
  .locked .card{padding:28px 22px}
  .locked .card .form{flex-direction:column}
  .locked .card .form .btn{min-height:42px}
  .lrow .n{white-space:normal;overflow-wrap:anywhere}
  .mx-card .foot{display:grid;grid-template-columns:1fr 1fr}
  .mx-card .foot .btn{min-height:40px}
}
@media (max-width:420px){
  .wrap{padding-left:10px;padding-right:10px}
  .tabs{margin-left:-10px;margin-right:-10px;padding-left:10px;padding-right:10px}
  .qrow{grid-template-columns:20px 32px minmax(0,1fr) 52px;gap:8px;
    padding:11px 9px 11px 12px}
  .qrow .av{width:32px;height:32px}
  .qrow .conf .pct{font-size:14px}
  .qrow .acts .btn{font-size:11.5px}
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
  var queueCursor=null;
  var whitelist=[];
  var wlCursor=null;
  var blacklist=[];
  var blCursor=null;
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
  // Build the query string for /v1/admin/queue from the current filter state.
  // Empty values are omitted entirely so the URL stays compact and the backend
  // treats them as "no filter on this dimension".
  function queueQs(){
    var parts=['limit=100'];
    if(queueCursor)parts.push('before='+encodeURIComponent(queueCursor));
    Object.keys(qFilters).forEach(function(k){
      var v=qFilters[k];
      if(v)parts.push(k+'='+encodeURIComponent(v));
    });
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
          return '<div class="fld"><label for="mxf_'+f.name+'">'+E(f.label||f.name)+(f.required?'<span class="req">*</span>':'')+'</label>'
            +'<input id="mxf_'+f.name+'" name="'+f.name+'" type="'+E(f.type||'text')+'"'
            +' placeholder="'+E(f.placeholder||'')+'" autocomplete="off"'+(f.required?' required':'')+'>'
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
      +'<div class="sub">守门员才能进 · <b style="color:var(--danger)">拉黑</b>=进公榜 · <b style="color:var(--ok)">白名单</b>=永不扫 · 驳回/移除=不公开 · 规则见 <a href="'+GH+'/blob/main/docs/GOVERNANCE.md" target="_blank">GOVERNANCE</a></div></div>'
      +'<div class="right"><span class="ok">已认证</span><button class="btn sm" onclick="window.__xss.logout()">退出</button>'+themeBtnHtml()+'</div>'
      +'</div>'
      +'<div class="tabs">'
      +'<button class="on" data-v="queue" onclick="window.__xss.tab(\'queue\')">待审队列 <span class="count" id="cQ">—</span></button>'
      +'<button data-v="blacklist" onclick="window.__xss.tab(\'blacklist\')">黑名单 <span class="count" id="cB">—</span></button>'
      +'<button data-v="whitelist" onclick="window.__xss.tab(\'whitelist\')">白名单 <span class="count" id="cW">—</span></button>'
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
      +'<p>把 <code style="background:var(--card-hi);padding:1px 6px;border-radius:var(--r-sm);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--fg)">ADMIN_TOKEN</code> 粘进来，仅在本浏览器 localStorage 保存。</p>'
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
      if(r.status===403){TOK='';localStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      stats=j;
      var cQ=$('cQ');if(cQ)cQ.textContent=fmtN(j.queue);
      var cB=$('cB');if(cB)cB.textContent=fmtN(j.blacklist);
      var cW=$('cW');if(cW)cW.textContent=fmtN(j.whitelist);
    }).catch(function(){});
  }
  function loadQueue(more){
    if(!more){queue=[];queueCursor=null;sel.clear();lastSelIdxQ=-1}
    setStatus('加载中…');
    api('/v1/admin/queue'+queueQs()).then(function(r){
      if(r.status===403){TOK='';localStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      queue=queue.concat(j.queue||[]);
      queueCursor=j.nextBefore;
      // Sync filter inputs back from the server-echoed appliedFilters — this
      // catches the "user typed a numeric q, server rewrote it to uid" case.
      if(j.appliedFilters){
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
    // Advanced filter panel is collapsed by default; show it open if any of
    // the explicit per-field filters are already populated (e.g. from a
    // "find similar" click that targeted a specific field).
    var anyExplicit=qFilters.uid||qFilters.handle||qFilters.evidence||qFilters.display_name||qFilters.reasons;
    var advOpen=!!anyExplicit;
    var nActive=activeFilterCount();
    v.innerHTML=
      '<div class="search-bar">'
        +'<div class="search-row">'
          +'<input id="qSearch" class="search-input" type="search" autocomplete="off" placeholder="搜 handle / uid / 推文内容 / 理由 …（回车搜索）" value="'+E(qFilters.q||'')+'">'
          +'<button class="btn sm" id="qSearchBtn" type="button">搜索</button>'
          +'<button class="btn sm muted" id="qAdvToggle" type="button" aria-expanded="'+(advOpen?'true':'false')+'">'
            +'更多筛选'+(nActive?' · <b>'+nActive+'</b>':'')
          +'</button>'
          +(nActive?'<button class="btn sm" id="qClearAll" type="button">清空全部</button>':'')
        +'</div>'
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
      +'<div class="rows" id="rows"></div>'
      +'<div class="more-foot" id="qmoreFoot"></div>';
    Array.prototype.forEach.call(v.querySelectorAll('.chip'),function(b){
      b.addEventListener('click',function(){filter=b.dataset.f;lastSelIdxQ=-1;renderRows()})
    });
    $('sort').addEventListener('change',function(e){sort=e.target.value;lastSelIdxQ=-1;renderRows()});
    $('selAllQ').addEventListener('change',function(){
      var rows=filteredQueue();
      if(this.checked)rows.forEach(function(a){sel.add(key(a))})
      else rows.forEach(function(a){sel.delete(key(a))});
      lastSelIdxQ=-1;renderRows();
    });
    // Search wiring — Enter or button click commits the fuzzy q filter.
    var qInput=$('qSearch');
    function commitQ(){qFilters.q=qInput.value.trim();loadQueue(false)}
    qInput.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();commitQ()}});
    $('qSearchBtn').addEventListener('click',commitQ);
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
      .then(function(){
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
      });
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
      setStatus('批量'+label+'…');
      var done=0;
      function next(){
        if(done>=ks.length){sel.clear();lastSelIdxQ=-1;renderQueue();refreshStats();setStatus('完成 · '+done+' 条');setTimeout(function(){setStatus('')},2500);return}
        var k=ks[done++],parts=k.split('|');
        api('/v1/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:parts[1],xUserId:parts[0]||undefined,action:action})})
          .then(function(){
            queue=queue.filter(function(a){return key(a)!==k});
            if(stats.queue!=null){stats.queue=Math.max(0,stats.queue-1);var c=$('cQ');if(c)c.textContent=fmtN(stats.queue)}
            setStatus('批量'+label+' '+done+'/'+ks.length);
            next();
          })
          .catch(function(){next()})
      }
      next();
    });
  }
  function clearSel(){sel.clear();lastSelIdxQ=-1;renderRows()}

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

  function loadWhitelist(more){
    if(!more){whitelist=[];wlCursor=null}
    setStatus('加载中…');
    api('/v1/admin/whitelist?limit=100'+(wlCursor?'&before='+wlCursor:'')).then(function(r){
      if(r.status===403){TOK='';localStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      whitelist=whitelist.concat(j.list||[]);
      wlCursor=j.nextBefore;
      setStatus('');
      // Truth lives in stats; this is just a quick fallback before /v1/admin/stats arrives.
      var c=$('cW');if(c&&stats.whitelist==null)c.textContent=whitelist.length+(wlCursor?'+':'');
      renderWhitelist();
    });
  }
  function renderWhitelist(){
    var v=$('view');
    var totalLbl=(stats&&stats.whitelist!=null)?fmtN(stats.whitelist):(whitelist.length+(wlCursor?'+':''));
    v.innerHTML=
      '<div class="toolbar">'
        +'<div class="status">共 <b style="color:var(--fg)">'+totalLbl+'</b> 个白名单账号 · 它们不会再被 AI 扫描，也不接受举报</div>'
        +'<div class="r">'
          +'<button class="btn sm primary" onclick="window.__xss.wlAdd()">+ 加入白名单</button>'
        +'</div>'
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
        +(stats.whitelist!=null?'<span>'+(wlCursor?'已加载 '+fmtN(whitelist.length)+' / 共 '+fmtN(stats.whitelist):'已加载全部 '+fmtN(whitelist.length))+' 条</span>':'')
      +'</div>';
    var box=$('wlrows');
    if(!whitelist.length){box.innerHTML='<div class="empty">还没有白名单账号。<br><br>点击右上角 <b>+ 加入白名单</b>，或在「待审队列」对某行点 <b>白名单</b> 按钮把它直接挪过来。</div>';wlRefreshBatch();return}
    box.innerHTML=whitelist.map(function(a,i){
      var k=(a.x_user_id||'')+'|'+a.handle;
      var av=a.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(a.handle));
      var fb=E((a.handle||'?').slice(0,1).toUpperCase());
      var note='';
      try{var rs=JSON.parse(a.reasons||'[]');note=Array.isArray(rs)?rs.filter(function(x){return x&&x!=='whitelisted by admin'}).join(' · '):''}catch(e){}
      return '<div class="qrow legit'+(wlSel.has(k)?' sel':'')+'" data-k="'+E(k)+'" data-idx="'+i+'" data-h="'+E(a.handle)+'" data-u="'+E(a.x_user_id||'')+'">'
        +'<input type="checkbox"'+(wlSel.has(k)?' checked':'')+' aria-label="选中 @'+E(a.handle)+'">'
        +'<div class="av"><img src="'+E(av)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\''+fb+'\'}))"></div>'
        +'<div class="who">'
          +'<div class="name">'+nameLink(a)+'<span class="vlbl">白名单</span></div>'
          +'<div class="sub">'
            +handleLink(a.handle)
            +idChip(a.x_user_id)
            +(note?'<span class="sep">·</span><span>'+E(note)+'</span>':'')
            +'<span class="sep">·</span><span>'+ago(a.last_scored)+'</span>'
          +'</div>'
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
      setStatus('批量移出…');
      var done=0;
      function next(){
        if(done>=ks.length){wlSel.clear();lastSelIdxW=-1;loadWhitelist(false);refreshStats();setStatus('完成 · '+done+' 条');setTimeout(function(){setStatus('')},2500);return}
        var k=ks[done++],parts=k.split('|'),handle=parts[1],xUserId=parts[0]||null;
        var q='?handle='+encodeURIComponent(handle)+(xUserId?'&xUserId='+encodeURIComponent(xUserId):'');
        api('/v1/admin/whitelist'+q,{method:'DELETE'}).then(function(){setStatus('批量移出 '+done+'/'+ks.length);next()}).catch(function(){next()})
      }
      next();
    });
  }

  function loadBlacklist(more){
    if(!more){blacklist=[];blCursor=null;blSel.clear()}
    setStatus('加载中…');
    api('/v1/admin/blacklist?limit=100'+(blCursor?'&before='+blCursor:'')).then(function(r){
      if(r.status===403){TOK='';localStorage.removeItem('xss_admin');renderLocked();return null}
      return r.json();
    }).then(function(j){
      if(!j)return;
      blacklist=blacklist.concat(j.list||[]);
      blCursor=j.nextBefore;
      setStatus('');
      // Truth lives in stats; this is just a quick fallback before /v1/admin/stats arrives.
      var c=$('cB');if(c&&stats.blacklist==null)c.textContent=blacklist.length+(blCursor?'+':'');
      renderBlacklist();
    });
  }
  function renderBlacklist(){
    var v=$('view');
    var totalLbl=(stats&&stats.blacklist!=null)?fmtN(stats.blacklist):(blacklist.length+(blCursor?'+':''));
    v.innerHTML=
      '<div class="toolbar">'
        +'<div class="status">共 <b style="color:var(--fg)">'+totalLbl+'</b> 个已公榜账号 · 在 <a href="/list" target="_blank">/list</a> 公开可见 · 误判直接 → 白名单 / 驳回</div>'
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
        +(stats.blacklist!=null?'<span>'+(blCursor?'已加载 '+fmtN(blacklist.length)+' / 共 '+fmtN(stats.blacklist):'已加载全部 '+fmtN(blacklist.length))+' 条</span>':'')
      +'</div>';
    var box=$('blrows');
    if(!blacklist.length){box.innerHTML='<div class="empty">公榜还没有账号。<br><br>在「待审队列」点 <b style="color:var(--danger)">拉黑</b> 把判定结果送进公榜。</div>';blRefreshBatch();return}
    box.innerHTML=blacklist.map(function(a,i){
      var k=(a.x_user_id||'')+'|'+a.handle;
      var av=a.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(a.handle));
      var fb=E((a.handle||'?').slice(0,1).toUpperCase());
      var conf=Math.round((a.confidence||0)*100);
      var lbl=a.verdict_label||'spam';
      var lblZh={spam:'垃圾营销',porn_bot:'色情广告',likely_spam:'疑似垃圾',uncertain:'不确定',legit:'正常'}[lbl]||lbl;
      var reps=a.reporters||0;
      return '<div class="qrow '+E(lbl)+(blSel.has(k)?' sel':'')+'" data-k="'+E(k)+'" data-idx="'+i+'" data-h="'+E(a.handle)+'" data-u="'+E(a.x_user_id||'')+'">'
        +'<input type="checkbox"'+(blSel.has(k)?' checked':'')+' aria-label="选中 @'+E(a.handle)+'">'
        +'<div class="av"><img src="'+E(av)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\''+fb+'\'}))"></div>'
        +'<div class="who">'
          +'<div class="name">'+nameLink(a)+'<span class="vlbl">'+E(lblZh)+'</span></div>'
          +'<div class="sub">'
            +handleLink(a.handle)
            +idChip(a.x_user_id)
            +'<span class="sep">·</span><span>已公榜 '+ago(a.published_at)+'</span>'
          +'</div>'
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
      setStatus('批量'+label+'…');
      var done=0;
      function next(){
        if(done>=ks.length){blSel.clear();lastSelIdxB=-1;loadBlacklist(false);refreshStats();setStatus('完成 · '+done+' 条');setTimeout(function(){setStatus('')},2500);return}
        var k=ks[done++],parts=k.split('|');
        api('/v1/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:parts[1],xUserId:parts[0]||undefined,action:action})})
          .then(function(){setStatus('批量'+label+' '+done+'/'+ks.length);next()}).catch(function(){next()})
      }
      next();
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
        .then(function(){
          queue=queue.filter(function(a){return key(a)!==k});sel.delete(k);
          if(stats.queue!=null){stats.queue=Math.max(0,stats.queue-1);var c=$('cQ');if(c)c.textContent=fmtN(stats.queue)}
          renderRows();
          refreshStats();
        });
    });
  }

  function tab(v){
    if(VIEW===v)return;VIEW=v;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(b){b.classList.toggle('on',b.dataset.v===v)});
    if(v==='queue')loadQueue(false);
    else if(v==='whitelist')loadWhitelist(false);
    else if(v==='blacklist')loadBlacklist(false);
    else loadLog(false);
    // Refresh chips on every tab switch — chips show counts for tabs the user
    // isn't currently looking at, and those counts change as the queue drains.
    refreshStats();
  }
  function save(){
    var t=$('t');if(!t)return;
    var v=t.value.trim();if(!v)return;
    TOK=v;localStorage.setItem('xss_admin',v);renderShell();
  }
  function logout(){
    mxModal.confirm({
      title:'退出审核台',
      body:'清除本浏览器保存的 <code>ADMIN_TOKEN</code>，回到锁屏。',
      okLabel:'退出',
      okVariant:'muted'
    }).then(function(ok){
      if(!ok)return;
      TOK='';localStorage.removeItem('xss_admin');renderLocked();
    });
  }

  window.__xss={
    tab:tab,save:save,logout:logout,
    batch:batch,clearSel:clearSel,
    wlAdd:wlAdd,wlBatch:wlBatch,wlClearSel:wlClearSel,
    blBatch:blBatch,blClearSel:blClearSel,
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
</head><body>
<div class="wrap"><div id="app" aria-live="polite"><div class="locked"><div class="card"><div class="lock"></div><h2>加载中…</h2></div></div></div></div>
<div class="wrap" style="padding-top:0;color:var(--fg-4);font-size:11.5px;display:flex;justify-content:space-between"><span id="status"></span><span>v1 · /admin</span></div>
<script>${THEME_TOGGLE_JS}${SCRIPT}</script>
</body></html>`;
}
