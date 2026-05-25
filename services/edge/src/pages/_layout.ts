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

/** Design tokens — Claude-inspired warm palette:
 *  dark mode = slightly warm near-black; light mode = cream/off-white
 *  (#fafaf7) instead of pure white; soft shadow tokens on cards instead
 *  of bare 1px borders. Overridable via [data-theme="light"|"dark"]. */
const CSS = `:root{
  color-scheme:dark light;
  /* Dark mode defaults — warmer than pure #0a0a0a */
  --bg:#0b0a09;
  --bg-2:#13110f;
  --fg:#fafaf7;
  --fg-2:#a8a59f;
  --fg-3:#76736d;
  --fg-4:#56534e;
  --border:rgba(255,250,235,.07);
  --border-strong:rgba(255,250,235,.14);
  --card:rgba(255,250,235,.025);
  --card-hi:rgba(255,250,235,.055);
  --accent:#38bdf8;
  --accent-soft:rgba(56,189,248,.13);
  --danger:#ef4444;
  --danger-soft:rgba(239,68,68,.09);
  --warn:#f59e0b;
  --ok:#10b981;
  --violet:#a855f7;
  --shadow-card:0 1px 0 rgba(255,250,235,.04) inset, 0 1px 3px rgba(0,0,0,.25);
  --shadow-elev:0 1px 3px rgba(0,0,0,.3), 0 8px 24px -6px rgba(0,0,0,.35);
  --grad-top:linear-gradient(180deg,rgba(56,189,248,.04),transparent 420px);
  --r-sm:4px; --r:6px; --r-lg:10px; --r-xl:14px;
  --font-serif:'Copernicus','Source Serif Pro',ui-serif,Georgia,'Times New Roman',serif;
}

/* Light mode — Claude-style warm cream, only when system says light AND
   user hasn't forced dark */
@media (prefers-color-scheme:light){
  :root:not([data-theme="dark"]){
    color-scheme:light;
    --bg:#fafaf7;
    --bg-2:#f3f1ec;
    --fg:#1a1813;
    --fg-2:#4a4640;
    --fg-3:#807a70;
    --fg-4:#a8a39a;
    --border:rgba(60,50,30,.09);
    --border-strong:rgba(60,50,30,.18);
    --card:rgba(255,255,255,.7);
    --card-hi:rgba(255,255,255,.95);
    --accent:#0284c7;
    --accent-soft:rgba(2,132,199,.1);
    --danger:#b91c1c;
    --danger-soft:rgba(185,28,28,.06);
    --warn:#a16207;
    --ok:#15803d;
    --violet:#7e22ce;
    --shadow-card:0 1px 2px rgba(60,40,10,.04), 0 4px 16px -6px rgba(60,40,10,.05);
    --shadow-elev:0 1px 3px rgba(60,40,10,.06), 0 12px 32px -10px rgba(60,40,10,.1);
    --grad-top:linear-gradient(180deg,rgba(180,140,60,.04),transparent 420px);
  }
}

/* User force-light (regardless of system) */
:root[data-theme="light"]{
  color-scheme:light;
  --bg:#fafaf7; --bg-2:#f3f1ec;
  --fg:#1a1813; --fg-2:#4a4640; --fg-3:#807a70; --fg-4:#a8a39a;
  --border:rgba(60,50,30,.09); --border-strong:rgba(60,50,30,.18);
  --card:rgba(255,255,255,.7); --card-hi:rgba(255,255,255,.95);
  --accent:#0284c7; --accent-soft:rgba(2,132,199,.1);
  --danger:#b91c1c; --danger-soft:rgba(185,28,28,.06);
  --warn:#a16207; --ok:#15803d; --violet:#7e22ce;
  --shadow-card:0 1px 2px rgba(60,40,10,.04), 0 4px 16px -6px rgba(60,40,10,.05);
  --shadow-elev:0 1px 3px rgba(60,40,10,.06), 0 12px 32px -10px rgba(60,40,10,.1);
  --grad-top:linear-gradient(180deg,rgba(180,140,60,.04),transparent 420px);
}

/* User force-dark (regardless of system) — explicit dark restore */
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0b0a09; --bg-2:#13110f;
  --fg:#fafaf7; --fg-2:#a8a59f; --fg-3:#76736d; --fg-4:#56534e;
  --border:rgba(255,250,235,.07); --border-strong:rgba(255,250,235,.14);
  --card:rgba(255,250,235,.025); --card-hi:rgba(255,250,235,.055);
  --accent:#38bdf8; --accent-soft:rgba(56,189,248,.13);
  --danger:#ef4444; --danger-soft:rgba(239,68,68,.09);
  --warn:#f59e0b; --ok:#10b981; --violet:#a855f7;
  --shadow-card:0 1px 0 rgba(255,250,235,.04) inset, 0 1px 3px rgba(0,0,0,.25);
  --shadow-elev:0 1px 3px rgba(0,0,0,.3), 0 8px 24px -6px rgba(0,0,0,.35);
  --grad-top:linear-gradient(180deg,rgba(56,189,248,.04),transparent 420px);
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
.brand .mark{width:32px;height:32px;display:block;flex-shrink:0;
  filter:drop-shadow(0 1px 2px rgba(29,161,242,.2))}
.nav .right{display:flex;align-items:center;gap:2px}
.nav .links{display:flex;gap:2px;font-size:13.5px;color:var(--fg-3)}
.nav .links a{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;
  border-radius:var(--r);transition:color .15s,background .15s}
.nav .links a:hover{color:var(--fg)}
.nav .links a.on{color:var(--fg);background:var(--card-hi)}
.nav .links a svg{width:14px;height:14px;opacity:.85}

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

/* Card — soft elevation, Claude-style */
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-card)}

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

/** X logo (the X.com / Twitter wordmark glyph) — used in brand + hero
 *  to anchor "this is for X". Official X mark is a flat black square with
 *  a stylised crossed X; here we render just the X stroke at currentColor
 *  so it tints with the foreground. */
const X_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
/** Nav icons — Lucide-style 24-vb stroke icons, sized down to 14px in
 *  the nav. `list` for the public board, `github` for the repo link. */
const LIST_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`;
const GH_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>`;
const SHIELD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>`;
/** Brand mark: a shield with the X glyph nested inside — signals
 *  "spam shield, for X". */
const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path d="M9.4 9 12 11.6 14.6 9M9.4 14.4 12 11.8 14.6 14.4" stroke-linecap="round"/></svg>`;
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
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/icon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:image" content="${BRAND.edgeBase}/og.png">
<meta property="og:type" content="website">
<meta property="og:url" content="${BRAND.edgeBase}/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${BRAND.edgeBase}/og.png">
<script>${THEME_BOOT}</script>
${o.head ?? ""}
<style>${CSS}${o.css ?? ""}</style>
</head><body>
<header class="wrap nav" role="banner">
  <a class="brand" href="/" aria-label="${BRAND.name} 首页"><img class="mark" src="/mxga-mark.png" alt="" width="32" height="32"><span>${BRAND.acronym}</span></a>
  <div class="right">
    <nav class="links" aria-label="主导航">
      ${navItem("list", "/list", `${LIST_SVG}<span>公榜</span>`)}
      ${navItem("github", BRAND.repo, `${GH_SVG}<span>GitHub</span>`)}
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
export const ICONS = { X: X_SVG, SHIELD: SHIELD_SVG };
