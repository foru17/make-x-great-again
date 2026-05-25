// Shared shell for the public Worker pages (/ landing, /list public board).
// Self-contained — no external fonts / JS / CSS so the page is servable
// under a strict CSP and stays well under 1.5s LCP on a cold edge.
//
// Visual language: base-ui.com inspired. Dark monochrome canvas, neutral
// borders, type-led hierarchy, accent reserved for state (focus, success,
// active). Sharp 6-10px corners, no halo decorations.
import { BRAND } from "../brand";

const GH_REPO = BRAND.repo;
// Latest GitHub Release; the redirect resolves to the newest .zip asset.
const RELEASE_URL = BRAND.release;

/** Design tokens shared across both Worker pages and extension UI. */
const CSS = `:root{
  color-scheme:dark;
  /* Surfaces */
  --bg:#0a0a0a;
  --bg-2:#111113;
  /* Text ramp — neutral, high contrast at the top */
  --fg:#fafafa;
  --fg-2:#a1a1aa;
  --fg-3:#71717a;
  --fg-4:#52525b;
  /* Borders — subtle by default, strong on hover */
  --border:rgba(255,255,255,.07);
  --border-strong:rgba(255,255,255,.14);
  /* Cards — almost transparent, no backdrop-filter (cleaner on dark) */
  --card:rgba(255,255,255,.025);
  --card-hi:rgba(255,255,255,.05);
  /* Accent — state indicator only (focus rings, selected, success);
     primary buttons use the foreground, not the accent */
  --accent:#38bdf8;
  --accent-soft:rgba(56,189,248,.12);
  --danger:#ef4444;
  --danger-soft:rgba(239,68,68,.08);
  --warn:#f59e0b;
  --ok:#10b981;
  --violet:#a855f7;
  /* Radius — small, technical feel */
  --r-sm:4px; --r:6px; --r-lg:10px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg);
  font:15px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Inter","SF Pro Text","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  font-feature-settings:"cv11","ss03"}
body{min-height:100vh;background:linear-gradient(180deg,rgba(56,189,248,.04),transparent 360px),var(--bg)}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}

/* Focus — base-ui style: inset 2px outline so the box doesn't grow */
:focus{outline:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:-1px;border-radius:var(--r)}
a:focus-visible,button:focus-visible{border-radius:var(--r)}

.wrap{max-width:1080px;margin:0 auto;padding:0 28px}

/* Nav — barely there divider, no accent */
.nav{display:flex;align-items:center;justify-content:space-between;padding:22px 0 20px;border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.005em;font-size:15px}
.brand svg{width:22px;height:22px;color:var(--fg)}
.nav .links{display:flex;gap:2px;font-size:13.5px;color:var(--fg-3)}
.nav .links a{padding:7px 12px;border-radius:var(--r);transition:color .15s,background .15s}
.nav .links a:hover{color:var(--fg)}
.nav .links a.on{color:var(--fg);background:var(--card-hi)}

.muted{color:var(--fg-3)}
.tiny{font-size:12.5px;color:var(--fg-3)}

/* Buttons — primary is high-contrast white, no halo. Accent is only for
   focus rings and confirmed-state — not a decoration. */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;
  padding:9px 14px;border-radius:var(--r);font-size:13.5px;font-weight:500;line-height:1;
  border:1px solid var(--border-strong);background:transparent;color:var(--fg);
  transition:background .12s,border-color .12s,color .12s,transform .08s;white-space:nowrap}
.btn:hover{background:var(--card-hi);border-color:rgba(255,255,255,.22)}
.btn:active{transform:translateY(.5px)}
.btn[disabled]{opacity:.4;cursor:not-allowed}
.btn.primary{background:var(--fg);color:var(--bg);border-color:var(--fg);font-weight:600}
.btn.primary:hover{background:#fff;border-color:#fff}
.btn.danger{color:#fca5a5;border-color:rgba(239,68,68,.32);background:transparent}
.btn.danger:hover{background:var(--danger-soft);border-color:rgba(239,68,68,.5);color:#fecaca}
.btn.sm{padding:6px 11px;font-size:12.5px;border-radius:var(--r-sm)}
.btn svg{width:15px;height:15px;flex-shrink:0}

/* Card — 1px border, slight surface, no blur */
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

export function layout(o: LayoutOpts): string {
  const navItem = (key: LayoutOpts["current"], href: string, label: string) =>
    `<a href="${href}"${o.current === key ? ' class="on"' : ""}>${label}</a>`;
  return `<!doctype html><html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${esc(o.title)}</title>
${o.head ?? ""}
<style>${CSS}${o.css ?? ""}</style>
</head><body>
<header class="wrap nav" role="banner">
  <a class="brand" href="/" aria-label="${BRAND.name} 首页">${LOGO_SVG}<span>${BRAND.acronym}</span></a>
  <nav class="links" aria-label="主导航">
    ${navItem("list", "/list", "公榜")}
    ${navItem("github", BRAND.repo, "GitHub")}
  </nav>
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
${o.script ? `<script>${o.script}</script>` : ""}
</body></html>`;
}

export const LINKS = { GH_REPO, RELEASE_URL };
