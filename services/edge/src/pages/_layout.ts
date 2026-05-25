// Shared shell for the public Worker pages (/ landing, /list public board).
// Self-contained — no external fonts / JS / CSS so the page is servable
// under a strict CSP and stays well under 1.5s LCP on a cold edge.
//
// Visual language: base-ui.com inspired. Type-led hierarchy, accent reserved
// for state (focus, success, active). Sharp 6-10px corners.
// Theme: dark + light, picks system preference by default, overridable via
// the nav theme button (state persisted in localStorage as `mxga_theme`).
import { BRAND } from "../brand";

const GH_REPO = BRAND.repo;
const RELEASE_URL = BRAND.release;

/** Design tokens — dark mode defaults, light mode under media query, both
 *  overridable via [data-theme="light"|"dark"] on <html>. */
const CSS = `:root{
  color-scheme:dark light;
  /* Dark mode defaults */
  --bg:#0a0a0a;
  --bg-2:#111113;
  --fg:#fafafa;
  --fg-2:#a1a1aa;
  --fg-3:#71717a;
  --fg-4:#52525b;
  --border:rgba(255,255,255,.07);
  --border-strong:rgba(255,255,255,.14);
  --card:rgba(255,255,255,.025);
  --card-hi:rgba(255,255,255,.05);
  --accent:#38bdf8;
  --accent-soft:rgba(56,189,248,.12);
  --danger:#ef4444;
  --danger-soft:rgba(239,68,68,.08);
  --warn:#f59e0b;
  --ok:#10b981;
  --violet:#a855f7;
  --shadow-up:0 1px 0 rgba(255,255,255,.04) inset;
  --grad-top:linear-gradient(180deg,rgba(56,189,248,.04),transparent 360px);
  --r-sm:4px; --r:6px; --r-lg:10px;
}

/* Light mode — only when system says light AND user hasn't forced dark */
@media (prefers-color-scheme:light){
  :root:not([data-theme="dark"]){
    color-scheme:light;
    --bg:#ffffff;
    --bg-2:#f9fafb;
    --fg:#09090b;
    --fg-2:#3f3f46;
    --fg-3:#71717a;
    --fg-4:#a1a1aa;
    --border:rgba(0,0,0,.08);
    --border-strong:rgba(0,0,0,.18);
    --card:rgba(0,0,0,.025);
    --card-hi:rgba(0,0,0,.055);
    --accent:#0284c7;
    --accent-soft:rgba(2,132,199,.1);
    --danger:#dc2626;
    --danger-soft:rgba(220,38,38,.08);
    --warn:#d97706;
    --ok:#15803d;
    --violet:#7e22ce;
    --shadow-up:0 1px 0 rgba(0,0,0,.04) inset;
    --grad-top:linear-gradient(180deg,rgba(2,132,199,.025),transparent 360px);
  }
}

/* User force-light (regardless of system) */
:root[data-theme="light"]{
  color-scheme:light;
  --bg:#ffffff; --bg-2:#f9fafb; --fg:#09090b;
  --fg-2:#3f3f46; --fg-3:#71717a; --fg-4:#a1a1aa;
  --border:rgba(0,0,0,.08); --border-strong:rgba(0,0,0,.18);
  --card:rgba(0,0,0,.025); --card-hi:rgba(0,0,0,.055);
  --accent:#0284c7; --accent-soft:rgba(2,132,199,.1);
  --danger:#dc2626; --danger-soft:rgba(220,38,38,.08);
  --warn:#d97706; --ok:#15803d; --violet:#7e22ce;
  --shadow-up:0 1px 0 rgba(0,0,0,.04) inset;
  --grad-top:linear-gradient(180deg,rgba(2,132,199,.025),transparent 360px);
}

/* User force-dark (regardless of system) — keep :root defaults explicitly */
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0a0a0a; --bg-2:#111113; --fg:#fafafa;
  --fg-2:#a1a1aa; --fg-3:#71717a; --fg-4:#52525b;
  --border:rgba(255,255,255,.07); --border-strong:rgba(255,255,255,.14);
  --card:rgba(255,255,255,.025); --card-hi:rgba(255,255,255,.05);
  --accent:#38bdf8; --accent-soft:rgba(56,189,248,.12);
  --danger:#ef4444; --danger-soft:rgba(239,68,68,.08);
  --warn:#f59e0b; --ok:#10b981; --violet:#a855f7;
  --shadow-up:0 1px 0 rgba(255,255,255,.04) inset;
  --grad-top:linear-gradient(180deg,rgba(56,189,248,.04),transparent 360px);
}

*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg);
  font:15px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Inter","SF Pro Text","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  font-feature-settings:"cv11","ss03";
  transition:background-color .15s ease,color .15s ease}
body{min-height:100vh;background:var(--grad-top),var(--bg)}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}

/* Focus — base-ui style: inset 2px outline so the box doesn't grow */
:focus{outline:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:-1px;border-radius:var(--r)}
a:focus-visible,button:focus-visible{border-radius:var(--r)}

.wrap{max-width:1080px;margin:0 auto;padding:0 28px}

/* Nav */
.nav{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:22px 0 20px;border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.005em;font-size:15px}
.brand svg{width:22px;height:22px;color:var(--fg)}
.nav .right{display:flex;align-items:center;gap:2px}
.nav .links{display:flex;gap:2px;font-size:13.5px;color:var(--fg-3)}
.nav .links a{padding:7px 12px;border-radius:var(--r);transition:color .15s,background .15s}
.nav .links a:hover{color:var(--fg)}
.nav .links a.on{color:var(--fg);background:var(--card-hi)}

/* Theme toggle button */
.theme-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:var(--r);color:var(--fg-3);transition:color .15s,background .15s,transform .12s;margin-left:6px}
.theme-btn:hover{color:var(--fg);background:var(--card-hi)}
.theme-btn:active{transform:translateY(.5px)}
.theme-btn svg{width:15px;height:15px;flex-shrink:0}
.theme-btn .icon-auto,.theme-btn .icon-light,.theme-btn .icon-dark{display:none}
:root[data-theme="light"] .theme-btn .icon-light{display:inline}
:root[data-theme="dark"] .theme-btn .icon-dark{display:inline}
:root:not([data-theme]) .theme-btn .icon-auto{display:inline}

.muted{color:var(--fg-3)}
.tiny{font-size:12.5px;color:var(--fg-3)}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;
  padding:9px 14px;border-radius:var(--r);font-size:13.5px;font-weight:500;line-height:1;
  border:1px solid var(--border-strong);background:transparent;color:var(--fg);
  transition:background .12s,border-color .12s,color .12s,transform .08s;white-space:nowrap}
.btn:hover{background:var(--card-hi)}
.btn:active{transform:translateY(.5px)}
.btn[disabled]{opacity:.4;cursor:not-allowed}
.btn.primary{background:var(--fg);color:var(--bg);border-color:var(--fg);font-weight:600}
.btn.primary:hover{background:var(--fg);opacity:.9}
.btn.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 36%,transparent);background:transparent}
.btn.danger:hover{background:var(--danger-soft)}
.btn.sm{padding:6px 11px;font-size:12.5px;border-radius:var(--r-sm)}
.btn svg{width:15px;height:15px;flex-shrink:0}

/* Card */
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r-lg)}

/* Verdict tag */
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;
  padding:2.5px 8px;border-radius:999px;border:1px solid currentColor;line-height:1.2;
  letter-spacing:.02em}
.tag.spam,.tag.likely_spam{color:var(--danger)}
.tag.porn_bot{color:var(--violet)}
.tag.uncertain{color:var(--fg-3)}
.tag.legit{color:var(--ok)}

/* Footer */
.foot{margin-top:88px;padding:28px 0 56px;border-top:1px solid var(--border);
  font-size:13px;color:var(--fg-3);display:flex;justify-content:space-between;
  flex-wrap:wrap;gap:14px}
.foot a:hover{color:var(--fg)}
.foot .sep{color:var(--fg-4);margin:0 8px;opacity:.6}

@media (max-width:640px){
  .wrap{padding:0 18px}
  .nav .links{gap:0;font-size:12.5px}
  .nav .links a{padding:6px 10px}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}
}
`;

const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>`;
const ICON_AUTO = `<svg class="icon-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 3a9 9 0 0 1 0 18" fill="currentColor"/></svg>`;
const ICON_LIGHT = `<svg class="icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const ICON_DARK = `<svg class="icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`;

/** HTML-escape user-rendered strings. */
export function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface LayoutOpts {
  title: string;
  current: "home" | "list" | "github";
  css?: string;
  head?: string;
  body: string;
  script?: string;
}

/** Inline script that runs before paint to avoid FOUC when forcing a theme. */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('mxga_theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

/** Cycle theme: auto → light → dark → auto. Exposed as window.__mxgaTheme(). */
const THEME_TOGGLE_JS = `window.__mxgaTheme=function(){var d=document.documentElement;var cur=d.getAttribute('data-theme');var next=cur===null||cur===''?'light':cur==='light'?'dark':null;try{if(next){d.setAttribute('data-theme',next);localStorage.setItem('mxga_theme',next)}else{d.removeAttribute('data-theme');localStorage.removeItem('mxga_theme')}}catch(e){}};`;

export function layout(o: LayoutOpts): string {
  const navItem = (key: LayoutOpts["current"], href: string, label: string) =>
    `<a href="${href}"${o.current === key ? ' class="on"' : ""}>${label}</a>`;
  return `<!doctype html><html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>${esc(o.title)}</title>
<script>${THEME_BOOT}</script>
${o.head ?? ""}
<style>${CSS}${o.css ?? ""}</style>
</head><body>
<header class="wrap nav" role="banner">
  <a class="brand" href="/" aria-label="${BRAND.name} 首页">${LOGO_SVG}<span>${BRAND.acronym}</span></a>
  <div class="right">
    <nav class="links" aria-label="主导航">
      ${navItem("list", "/list", "公榜")}
      ${navItem("github", BRAND.repo, "GitHub")}
    </nav>
    <button class="theme-btn" type="button" onclick="window.__mxgaTheme()" aria-label="切换亮/暗主题（auto → light → dark）" title="切换主题">${ICON_AUTO}${ICON_LIGHT}${ICON_DARK}</button>
  </div>
</header>
<main class="wrap" role="main">
${o.body}
</main>
<footer class="wrap foot" role="contentinfo">
  <span>${BRAND.owner}<span class="sep">·</span>${BRAND.license}</span>
  <span>
    <a href="${BRAND.repo}">仓库</a><span class="sep">·</span>
    <a href="${BRAND.governance}">治理</a><span class="sep">·</span>
    <a href="${BRAND.privacy}">隐私</a><span class="sep">·</span>
    <a href="${BRAND.issues}">反馈</a>
  </span>
</footer>
<script>${THEME_TOGGLE_JS}${o.script ?? ""}</script>
</body></html>`;
}

export const LINKS = { GH_REPO, RELEASE_URL };
