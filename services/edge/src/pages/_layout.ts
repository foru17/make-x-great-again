import { CSS } from "../_generated-css";
import { googleAnalyticsHead } from "../analytics";
import { BRAND } from "../brand";

// Shared shell for the public Worker pages (/ landing, /list public board).
// Self-contained CSS; analytics is injected from a small shared module so the
// tracker id is not duplicated across pages.
//
// Visual language: base-ui.com inspired. Type-led hierarchy, accent reserved
// for state (focus, success, active). Sharp 6-10px corners.
// Theme: dark + light, picks system preference by default, overridable via
// the nav theme button (state persisted in localStorage as `mxga_theme`).

const GH_REPO = BRAND.repo;
const RELEASE_URL = BRAND.release;

/** Design tokens — Claude-inspired warm palette:
 *  dark mode = slightly warm near-black; light mode = cream/off-white
 *  (#fafaf7) instead of pure white; soft shadow tokens on cards instead
 *  of bare 1px borders. Overridable via [data-theme="light"|"dark"]. */

/** X logo (the X.com / Twitter wordmark glyph) — used in brand + hero
 *  to anchor "this is for X". Official X mark is a flat black square with
 *  a stylised crossed X; here we render just the X stroke at currentColor
 *  so it tints with the foreground. */
const X_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
/** Nav icons — Lucide-style 24-vb stroke icons, sized down to 14px in
 *  the nav. `list` for the public board, `github` for the repo link. */
const LIST_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`;
const DB_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`;
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
  current: "home" | "list" | "data" | "github";
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
${googleAnalyticsHead()}
${o.head ?? ""}
<style>${CSS}${o.css ?? ""}</style>
</head><body>
<header class="wrap nav" role="banner">
  <a class="brand" href="/" aria-label="${BRAND.name} 首页"><img class="mark" src="/mxga-mark.png" alt="" width="32" height="32"><span>${BRAND.acronym}</span></a>
  <div class="right">
    <nav class="links" aria-label="主导航">
      ${navItem("list", "/list", `${LIST_SVG}<span>名单</span>`)}
      ${navItem("data", `${BRAND.repo}/tree/data-mirror/data`, `${DB_SVG}<span>公开数据</span>`)}
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
