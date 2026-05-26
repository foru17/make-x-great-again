// Design system + components, all rendered inside a Shadow DOM so X's CSS
// cannot bleed in and ours cannot leak out. Vanilla DOM — no framework
// weight injected into the page. Tokens per docs/UX.md.
import { BRAND } from "./brand";
import type { Label, Verdict } from "./types";

export const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui,-apple-system,"Segoe UI",sans-serif; }
:host, :root, .xss {
  /* dark default (X dark mode) */
  --surface: rgba(13,17,23,.92); --border: rgba(255,255,255,.10);
  --shadow: 0 8px 28px rgba(0,0,0,.45); --text: #E6EDF3; --muted: #8B949E;
  --brand: #0EA5E9; --danger: #EF4444; --warn: #F59E0B; --neutral: #8B949E;
  --safe: #16A34A;
  /* subtle overlays that need to invert with theme */
  --hover: rgba(255,255,255,.06);
  --shimmer: rgba(255,255,255,.18);
}
@media (prefers-color-scheme: light) {
  :host, :root, .xss {
    --surface: rgba(255,255,255,.96); --border: rgba(15,23,42,.12);
    --shadow: 0 8px 28px rgba(15,23,42,.18); --text: #0F172A; --muted: #475569;
    --brand: #0369A1; --danger: #DC2626; --warn: #B45309; --neutral: #475569;
    --safe: #15803D;
    --hover: rgba(15,23,42,.06);
    --shimmer: rgba(15,23,42,.10);
  }
}
.xss-bubble {
  position: fixed; right: 16px; top: 16px; z-index: 2147483000;
  color: var(--text); -webkit-font-smoothing: antialiased;
}
.xss-bubble.br { top: auto; bottom: 16px; }
.pill, .card {
  background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow); backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px); border-radius: 14px;
}
.pill {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-radius: 999px; cursor: pointer; transition: opacity .14s ease, transform .14s ease;
  min-width: 0; min-height: 36px;
}
.pill:hover { opacity: .94; transform: translateY(-1px); }
.pill .n {
  font-size: 12px; font-weight: 700; min-width: 16px; text-align: center;
}
.scan-pill {
  display: grid; grid-template-columns: 22px auto auto;
  align-items: center; gap: 7px; width: auto;
}
.scan-radar {
  --accent: var(--brand); --angle: 360deg;
  width: 22px; height: 22px; position: relative; display: grid; place-items: center;
  border-radius: 999px; flex: none;
  background: conic-gradient(var(--accent) var(--angle), color-mix(in srgb, var(--accent) 12%, transparent) 0deg);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
}
.scan-radar.danger { --accent: var(--danger); }
.scan-core {
  position: absolute; inset: 4px; display: grid; place-items: center;
  border-radius: inherit; background: var(--surface);
}
.scan-sweep {
  position: absolute; inset: 2px; border-radius: inherit; opacity: 0;
  background: conic-gradient(from -30deg, transparent 0 64%, color-mix(in srgb, var(--accent) 58%, transparent) 76%, transparent 92%);
}
.scan-radar.busy .scan-sweep {
  opacity: .95; animation: xradar 1.15s linear infinite;
}
.scan-radar.busy {
  animation: xbreath 1.6s ease-in-out infinite;
}
.scan-title {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 46px; font-size: 12.5px; font-weight: 750; color: var(--text);
}
.scan-meta {
  flex: none; font-size: 11px; font-weight: 650; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.card { width: 312px; padding: 14px; display: none; }
.card.open { display: block; animation: in .18s ease-out; }
@keyframes in { from { opacity: 0; transform: translateY(8px); } }
.hd { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.hd .x { margin-left: auto; cursor: pointer; color: var(--muted); display: flex; }
.hd .x:hover { color: var(--text); }
.sub { display: flex; gap: 12px; margin: 10px 0 12px; font-size: 12px; color: var(--muted); }
.dot { display: inline-flex; align-items: center; gap: 5px; }
.dot i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.btn {
  width: 100%; border: 0; border-radius: 10px; padding: 9px 12px;
  font-size: 13px; font-weight: 600; cursor: pointer; color: #fff;
  background: var(--danger); transition: filter .14s ease;
}
.btn:hover { filter: brightness(1.08); }
.btn:disabled { opacity: .55; cursor: default; }

/* Per-row block button — same color language as bulk btn, smaller scale. */
.xss-act {
  flex: none; border: 0; border-radius: 8px; padding: 5px 10px;
  font-size: 11.5px; font-weight: 600; cursor: pointer; color: #fff;
  background: var(--danger); transition: filter .14s ease, background .14s;
  white-space: nowrap;
}
.xss-act:hover { filter: brightness(1.08); }
.xss-act:disabled { cursor: default; }
.xss-act.done {
  background: var(--safe); color: #fff; opacity: .9;
}
.xss-act.retry {
  background: transparent; color: var(--warn);
  border: 1px solid var(--warn);
}

/* Per-row select checkbox — themed, replaces native browser styling. */
.xss-row-cb {
  width: 15px; height: 15px; flex: none; cursor: pointer;
  appearance: none; -webkit-appearance: none;
  border: 1.5px solid var(--border); border-radius: 4px;
  background: transparent; transition: border-color .12s, background .12s;
  position: relative; margin-top: 6px;
}
.xss-row-cb:hover { border-color: var(--danger); }
.xss-row-cb:checked {
  background: var(--danger); border-color: var(--danger);
}
.xss-row-cb:checked::after {
  content: ""; position: absolute; left: 3px; top: 0;
  width: 5px; height: 9px; border: solid #fff;
  border-width: 0 1.5px 1.5px 0; transform: rotate(45deg);
}
.xss-row-cb:disabled { opacity: .35; cursor: default; }
.row { display: flex; gap: 14px; margin-top: 10px; font-size: 12px; }
.lnk { color: var(--muted); cursor: pointer; }
.lnk:hover { color: var(--text); }
svg { display: block; }
.xss-badge {
  --badge-color: var(--muted);
  width: 20px; height: 20px; display: inline-grid; place-items: center;
  margin-left: 5px; padding: 0; border-radius: 999px; font-size: 0;
  line-height: 0; vertical-align: -4px; cursor: default; color: var(--badge-color);
  border: 1px solid color-mix(in srgb, var(--badge-color) 42%, transparent);
  background: color-mix(in srgb, var(--badge-color) 13%, transparent);
  box-shadow: 0 1px 4px rgba(15,23,42,.08);
  transition: transform .12s ease, opacity .12s ease, background .12s ease, border-color .12s ease, box-shadow .12s ease;
}
.xss-badge svg { width: 13px; height: 13px; stroke: currentColor; }
.xss-badge.labeled {
  width: auto; min-width: 20px; display: inline-flex; align-items: center; justify-content: center;
  gap: 4px; padding: 0 6px; font-size: 11px; line-height: 1; font-weight: 750;
  letter-spacing: 0; white-space: nowrap;
}
.xss-badge.labeled svg { width: 12px; height: 12px; flex: 0 0 auto; }
.xss-badge .xss-ico {
  width: 13px; height: 13px; flex: 0 0 auto; display: inline-grid; place-items: center;
  position: relative; overflow: visible;
}
.xss-badge .xss-ico svg { width: 12px; height: 12px; }
.xss-badge .xss-label { display: inline-block; }
.xss-badge:hover {
  transform: translateY(-1px); opacity: 1;
  border-color: color-mix(in srgb, var(--badge-color) 64%, transparent);
  background: color-mix(in srgb, var(--badge-color) 18%, transparent);
  box-shadow: 0 3px 10px rgba(15,23,42,.13);
}
.xss-badge.ghost {
  --badge-color: var(--brand);
  cursor: pointer; opacity: .9;
  border-color: color-mix(in srgb, var(--badge-color) 35%, transparent);
  background: color-mix(in srgb, var(--badge-color) 9%, transparent);
}
.xss-badge.ghost:hover { opacity: .95; }
.xss-badge.verdict.list {
  color: #fff;
  background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 92%, #fff), var(--danger));
  border-color: color-mix(in srgb, var(--danger) 90%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger) 14%, transparent), 0 2px 7px color-mix(in srgb, var(--danger) 18%, transparent);
}
.xss-badge.verdict.fresh {
  background: color-mix(in srgb, var(--badge-color) 16%, transparent);
  border-color: color-mix(in srgb, var(--badge-color) 46%, transparent);
}
.xss-badge.verdict.fresh { animation: xrise .22s ease-out; }
.xss-badge.verdict.spammy {
  color: #fff;
  --badge-color: var(--danger);
  background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 92%, #fff), var(--danger));
  border-color: color-mix(in srgb, var(--danger) 90%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger) 14%, transparent), 0 2px 7px color-mix(in srgb, var(--danger) 18%, transparent);
}
.xss-badge.verdict.spammy:hover,
.xss-badge.verdict.list:hover {
  background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 96%, #fff), color-mix(in srgb, var(--danger) 92%, #000));
  border-color: var(--danger);
}
.xss-badge.verdict.cache {
  opacity: .74;
}
.pop {
  position: fixed; z-index: 2147482001; width: 280px; padding: 12px;
  font-size: 12px; color: var(--text); border-radius: 12px;
  box-shadow: 0 18px 48px rgba(15,23,42,.22), 0 2px 8px rgba(15,23,42,.10);
  transform-origin: 12px 12px; animation: xpop .14s ease-out;
  pointer-events: auto;
}
.pop h4 { margin: 0 0 6px; font-size: 12.5px; font-weight: 750; }
.pop ul { margin: 6px 0; padding-left: 16px; color: var(--muted); }
.pop li { margin: 3px 0; }
.acts { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
.acts button {
  border: 1px solid var(--border); background: transparent; color: var(--text);
  border-radius: 999px; padding: 5px 10px; font-size: 11px; font-weight: 650;
  cursor: pointer; transition: transform .12s ease, background .12s ease, border-color .12s ease, color .12s ease, filter .12s ease;
}
.acts button:hover {
  transform: translateY(-1px);
  background: var(--hover);
}
.acts button[data-c] {
  color: var(--brand);
  border-color: color-mix(in srgb, var(--brand) 42%, var(--border));
  background: color-mix(in srgb, var(--brand) 8%, transparent);
}
.acts button[data-r] {
  color: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 48%, var(--border));
  background: color-mix(in srgb, var(--warn) 9%, transparent);
}
.acts button[data-b] {
  color: #fff; border-color: transparent;
  background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 92%, #fff), var(--danger));
}
.acts button[data-h] {
  color: var(--muted);
  border-color: color-mix(in srgb, var(--muted) 32%, var(--border));
}
.acts button[data-a] {
  color: var(--muted);
  border-color: transparent;
}
.acts button[data-b]:hover { filter: brightness(1.05); }
.acts button:disabled {
  cursor: default; transform: none; filter: none;
}
.acts button.done {
  color: #fff; border-color: transparent; background: var(--safe);
}
.acts button.err {
  color: #fff; border-color: transparent; background: var(--danger);
}

/* ---- animated badge states (transform/opacity only) ---- */
.xss-badge.known { animation: xpop .18s ease-out; }
.xss-badge .kdot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--brand);
  flex: none;
}
.xss-badge .ndot {
  width: 6px; height: 6px; border-radius: 50%; flex: none;
  border: 1.5px solid var(--warn); box-sizing: border-box;
}
.xss-badge .ntag {
  margin-left: 4px; padding: 0 5px; border-radius: 999px; font-size: 9px;
  font-weight: 700; color: var(--warn); border: 1px solid var(--warn);
  letter-spacing: .3px;
}
/* Source-tier mini-tag — appended to spammy badges so the user can tell
   公榜命中 / 本地缓存 / AI 现场判定 apart. Same shape as .ntag, varied color. */
.xss-badge .stag {
  margin-left: 4px; padding: 0 5px; border-radius: 999px; font-size: 9px;
  font-weight: 700; letter-spacing: .3px; line-height: 1.55;
}
.xss-badge .stag.list  { color: #fff; background: var(--danger); }
.xss-badge .stag.cache { color: var(--muted); border: 1px solid var(--border); }
.xss-badge .stag.fresh { color: var(--warn); border: 1px solid var(--warn); }
/* Whitelist badge — green checkmark, no popover content beyond the badge itself */
.xss-badge.whitelist {
  --badge-color: var(--safe);
  background: color-mix(in srgb, var(--badge-color) 16%, transparent);
  border-color: color-mix(in srgb, var(--badge-color) 50%, transparent);
}
.xss-badge.whitelist .wdot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--safe); flex: none;
}
.xss-badge.analyzing {
  --badge-color: var(--brand);
  overflow: visible;
}
.xss-badge.analyzing .xss-ico::after {
  content: ""; position: absolute; inset: -3px; border-radius: 999px;
  border: 1.5px solid transparent; border-top-color: var(--badge-color);
  animation: xspin .7s linear infinite;
}
.xss-badge.pending {
  --badge-color: var(--muted);
  cursor: default;
  animation: xpulse 1.6s ease-in-out infinite;
}
@keyframes xrise { from { opacity: 0; transform: translateY(4px); } }
@keyframes xpop  { from { opacity: 0; transform: scale(.9); } }
@keyframes xspin { to { transform: rotate(360deg); } }
@keyframes xshim { to { transform: translateX(100%); } }
@keyframes xpulse { 0%,100% { opacity: .55; } 50% { opacity: .95; } }
@keyframes xradar { to { transform: rotate(360deg); } }
@keyframes xbreath { 0%,100% { filter: saturate(1); } 50% { filter: saturate(1.35); } }

/* New-hit motion: one compact radar lap, slow at first then faster. */
.pill.hit-pulse .scan-radar {
  animation: xhitspin .82s cubic-bezier(.62, 0, 1, .62) 1, xhitglow .9s ease-out 1;
}
@keyframes xhitspin {
  0% { transform: rotate(0deg) scale(1); }
  42% { transform: rotate(72deg) scale(1.08); }
  100% { transform: rotate(360deg) scale(1); }
}
@keyframes xhitglow {
  0% { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent), 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); }
  32% { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent), 0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent); }
  100% { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent), 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .card.open { animation: fade .18s ease-out; }
  @keyframes fade { from { opacity: 0; } }
  .xss-badge.fresh, .xss-badge.known { animation: fade .18s ease-out; }
  .xss-badge.analyzing .xss-ico::after, .scan-radar.busy, .scan-radar.busy .scan-sweep { animation: none; }
  .xss-badge.pending { animation: none; opacity: .7; }
  .pill.hit-pulse .scan-radar { animation: none; }
}
@media (max-width: 720px) {
  .xss-badge.labeled {
    width: 20px; padding: 0; gap: 0;
  }
  .xss-badge.labeled .xss-label { display: none; }
}
`;

// Lucide-style 24-viewBox stroke icons. No emoji (per design system).
const P: Record<string, string[]> = {
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  "shield-alert": [
    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    "M12 8v4",
    "M12 16h.01",
  ],
  "shield-x": [
    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    "M9.5 9.5l5 5",
    "M14.5 9.5l-5 5",
  ],
  "shield-check": [
    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    "M9 12l2 2 4-4",
  ],
  x: ["M18 6 6 18", "M6 6l12 12"],
};
export function icon(name: keyof typeof P | string, color = "currentColor", size = 16): string {
  const paths = P[name] ?? P.shield ?? [];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="2.15" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
}

export const LABEL: Record<Label, { zh: string; varName: string; ic: string }> = {
  spam: { zh: "垃圾", varName: "--danger", ic: "shield-x" },
  porn_bot: { zh: "色情bot", varName: "--danger", ic: "shield-x" },
  likely_spam: { zh: "疑似垃圾", varName: "--warn", ic: "shield-alert" },
  uncertain: { zh: "不确定", varName: "--neutral", ic: "shield" },
  legit: { zh: "正常", varName: "--safe", ic: "shield-check" },
};

/**
 * HTML-escape any string we interpolate into innerHTML inside our Shadow
 * DOMs. The popover and card bodies render content sourced from:
 *   - X's own backend (display names, bios, avatar URLs) — usually safe but
 *     attacker-controlled at the source.
 *   - Our LLM Worker's `reasons` array — text we asked the model to write,
 *     so technically prompt-injectable via a malicious user's bio.
 * Neither source is allowed to reach innerHTML un-escaped. Shadow DOM does
 * NOT sandbox script execution: an `<img src=x onerror=...>` injected into
 * a content-script shadow root still runs in the isolated world, which has
 * chrome.storage / chrome.runtime / first-party x.com fetch access. So we
 * keep this strict and use it everywhere user-derived text touches HTML.
 */
function escHtml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

const BADGE_TEXT: Record<Label, string> = {
  spam: "垃圾",
  porn_bot: "色情",
  likely_spam: "疑似",
  uncertain: "存疑",
  legit: "正常",
};

export interface Finding {
  handle: string;
  userId?: string;
  avatarUrl?: string;
  displayName?: string;
  snippet?: string;
  blockFailed?: boolean;
  /** Set by drain() after a successful block — used by the card to strike
   *  the row through and replace the per-row button with "已拉黑". */
  blocked?: boolean;
  /** Selection state for the bulk-block action. Undefined → treated as
   *  selected (the default for a fresh finding). User uncheck → false →
   *  bulk skips it; user can still per-row block manually. */
  selected?: boolean;
  verdict: Verdict;
}

export interface BubbleHandlers {
  onBlockAll: (f: Finding[]) => void;
  onBlockOne: (f: Finding) => void;
  onReviewEach: () => void;
  onDismiss: () => void;
}

/** Collapsed pill ⇄ expanded card. Default resting state = pill. */
export function createBubble(h: BubbleHandlers, pos: "tr" | "br" = "tr") {
  const root = document.createElement("div");
  root.className = `xss xss-bubble${pos === "br" ? " br" : ""}`;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const pill = document.createElement("button");
  pill.className = "pill";
  pill.setAttribute("aria-label", `${BRAND.acronym} 本页可疑账号`);

  const card = document.createElement("div");
  card.className = "card";

  root.append(pill, card);
  let open = false;
  let findings: Finding[] = [];
  let scanning = 0; // accounts currently being checked (visible progress)
  // Total accounts we've gotten a verdict (or skip-decision) on this page.
  // Lets the pill say "已扫 N · 检查中 M · 命中 K" so the user feels the
  // scan in motion, not just a static "守护中" until something pops.
  let scanned = 0;

  const sev = (f: Finding[]) =>
    f.some((x) => x.verdict.label === "spam" || x.verdict.label === "porn_bot")
      ? "--danger"
      : "--warn";

  function progressMarkup(opts: {
    iconName: string;
    iconColor: string;
    title: string;
    count?: string;
    percent: number;
    busy?: boolean;
    danger?: boolean;
  }) {
    const percent = Math.max(0, Math.min(100, opts.percent));
    const angle = Math.round(percent * 3.6);
    return `<span class="scan-pill">
      <span class="scan-radar ${opts.busy ? "busy" : ""} ${opts.danger ? "danger" : ""}" style="--angle:${angle}deg">
        <span class="scan-sweep"></span>
        <span class="scan-core">${icon(opts.iconName, opts.iconColor, 11)}</span>
      </span>
      <span class="scan-title">${opts.title}</span>
      ${opts.count ? `<span class="scan-meta">${opts.count}</span>` : ""}
    </span>`;
  }

  function renderPill() {
    const total = scanned + scanning;
    const progress = scanning > 0
      ? Math.max(8, Math.round((scanned / Math.max(1, total)) * 100))
      : scanned > 0
        ? 100
        : 0;
    // Spammy findings present → alarm tone takes priority, shows count.
    if (findings.length) {
      const c = `var(${sev(findings)})`;
      pill.innerHTML = progressMarkup({
        iconName: "shield-alert",
        iconColor: c,
        title: "命中",
        count: String(findings.length),
        percent: progress || 100,
        busy: scanning > 0,
        danger: true,
      });
      return;
    }
    // Active scanning, nothing flagged yet.
    if (scanning > 0 || scanned > 0) {
      pill.innerHTML = progressMarkup({
        iconName: scanning > 0 ? "shield" : "shield-check",
        iconColor: "var(--brand)",
        title: scanning > 0 ? "扫描" : "已扫",
        count: String(scanning > 0 ? scanning : scanned),
        percent: progress,
        busy: scanning > 0,
      });
      return;
    }
    // Calm "guarding" — page is idle, no signal in either direction.
    pill.innerHTML = progressMarkup({
      iconName: "shield-check",
      iconColor: "var(--brand)",
      title: "守护",
      percent: 100,
    });
  }

  function renderCard() {
    if (!findings.length) {
      card.innerHTML = `
        <div class="hd">${icon("shield-check", "var(--brand)", 16)}
          <span>${BRAND.acronym} 已启用</span>
          <span class="x" data-x>${icon("x", "currentColor", 14)}</span></div>
        <div class="sub" style="display:block;line-height:1.6">
          正在被动检查本页账号。发现可疑的垃圾/色情机器人时，会在这里提示并提供一键处理。</div>
        <div class="row"><span class="lnk" data-gov>为什么 / 治理</span></div>`;
      card.querySelector("[data-x]")?.addEventListener("click", collapse);
      card.querySelector("[data-gov]")?.addEventListener("click", () =>
        window.open(BRAND.governance, "_blank", "noopener"),
      );
      return;
    }
    const danger = findings.filter(
      (x) => x.verdict.label === "spam" || x.verdict.label === "porn_bot",
    ).length;
    const warn = findings.length - danger;
    const pendingCount = findings.filter((x) => !x.blocked).length;
    const doneCount = findings.length - pendingCount;
    // Bulk action operates on the subset the user has left checked.
    // Default state of a fresh finding is selected (selected !== false).
    const selectedPending = findings.filter((x) => !x.blocked && x.selected !== false).length;
    card.innerHTML = `
      <div class="hd">${icon("shield-alert", "var(--brand)", 16)}
        <span>本页发现 ${findings.length} 个可疑账号</span>
        <span class="x" data-x>${icon("x", "currentColor", 14)}</span></div>
      <div class="sub">
        ${danger ? `<span class="dot"><i style="background:var(--danger)"></i>${danger} 色情/垃圾bot</span>` : ""}
        ${warn ? `<span class="dot"><i style="background:var(--warn)"></i>${warn} 疑似</span>` : ""}
      </div>
      <div style="max-height:208px;overflow:auto;margin:0 -4px 10px">
        ${findings
          .map((f) => {
            const m = LABEL[f.verdict.label];
            const col = `var(${m.varName})`;
            // X serves avatar URLs as https://pbs.twimg.com/profile_images/...
            // We still defense-in-depth escape the URL because attacker-
            // controlled fields shouldn't reach attribute context raw.
            const av = f.avatarUrl
              ? `<img src="${escHtml(f.avatarUrl)}" width="26" height="26" style="border-radius:50%;flex:none" alt="">`
              : `<span style="width:26px;height:26px;border-radius:50%;flex:none;background:var(--border)"></span>`;
            const name = escHtml(f.displayName?.trim() || `@${f.handle}`);
            const snip = f.snippet
              ? escHtml(f.snippet.replace(/\s+/g, " ").trim()).slice(0, 60)
              : "";
            const id = f.userId || `h:${f.handle}`;
            const checked = f.blocked ? false : f.selected !== false;
            const actClass = f.blocked
              ? "xss-act done"
              : f.blockFailed
                ? "xss-act retry"
                : "xss-act";
            const actText = f.blocked ? "已拉黑" : f.blockFailed ? "重试" : "拉黑";
            return `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 4px">
              <input type="checkbox" class="xss-row-cb" data-sel="${id}"
                aria-label="选中 @${escHtml(f.handle)}"
                ${checked ? "checked" : ""} ${f.blocked ? "disabled" : ""}>
              ${av}
              <div style="min-width:0;flex:1">
                <div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${f.blocked ? ";text-decoration:line-through;opacity:.55" : ""}">${name}</div>
                <div style="font-size:11px;color:${col}">@${escHtml(f.handle)} · ${m.zh} ${(f.verdict.confidence * 100).toFixed(0)}%</div>
                ${snip ? `<div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap${f.blocked ? ";text-decoration:line-through;opacity:.55" : ""}">${snip}</div>` : ""}
                ${f.blockFailed ? `<div style="font-size:11px;color:var(--warn)">自动屏蔽失败 · <a href="https://x.com/${escHtml(f.handle)}" target="_blank" rel="noopener" style="color:var(--warn)">手动屏蔽</a></div>` : ""}
                ${f.blocked ? `<div style="font-size:11px;color:var(--safe)">✓ 已拉黑</div>` : ""}
              </div>
              <button class="${actClass}" data-one="${id}"${f.blocked ? " disabled" : ""}>${actText}</button>
            </div>`;
          })
          .join("")}
      </div>
      ${
        pendingCount === 0
          ? `<button class="btn" disabled style="background:var(--safe)">✓ 已全部处理 (${doneCount})</button>`
          : selectedPending === 0
            ? `<button class="btn" disabled style="opacity:.55">未选中任何账号 (剩余 ${pendingCount})</button>`
            : `<button class="btn" data-block>一键拉黑选中 ${selectedPending}${doneCount ? ` · 已完成 ${doneCount}` : ""}${selectedPending < pendingCount ? ` · 跳过 ${pendingCount - selectedPending}` : ""}</button>`
      }
      <div class="row"><span class="lnk" data-each>逐个查看处理</span>
        <span class="lnk" data-ign>忽略本页</span></div>`;
    card.querySelector("[data-x]")?.addEventListener("click", collapse);
    card.querySelector("[data-ign]")?.addEventListener("click", () => {
      h.onDismiss();
      root.remove();
    });
    card.querySelector("[data-each]")?.addEventListener("click", h.onReviewEach);
    card.querySelectorAll<HTMLElement>("[data-one]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.one;
        const f = findings.find((x) => (x.userId || `h:${x.handle}`) === id);
        if (f) {
          h.onBlockOne(f);
          btn.textContent = "已拉黑";
          btn.classList.remove("retry");
          btn.classList.add("done");
          (btn as HTMLButtonElement).disabled = true;
        }
      });
    });
    // Per-row select toggle — uncheck excludes from the bulk action so the
    // user can opt-out specific accounts before "一键拉黑".
    card.querySelectorAll<HTMLInputElement>("[data-sel]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.sel;
        const f = findings.find((x) => (x.userId || `h:${x.handle}`) === id);
        if (f) {
          f.selected = cb.checked;
          renderCard(); // re-render so bulk button count updates immediately
        }
      });
    });
    const b = card.querySelector<HTMLButtonElement>("[data-block]");
    b?.addEventListener("click", () => {
      b.disabled = true;
      b.textContent = "处理中…";
      // Bulk only blocks the SELECTED, unblocked findings. The drain() in
      // content.ts will get a curated array, not "all findings".
      h.onBlockAll(findings.filter((x) => !x.blocked && x.selected !== false));
    });
  }

  function expand() {
    open = true;
    card.classList.add("open");
    renderCard();
  }
  function collapse() {
    open = false;
    card.classList.remove("open");
  }
  pill.addEventListener("click", () => (open ? collapse() : expand()));
  root.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") collapse();
  });

  // Always-visible calm pill from the start, so the user has feedback that
  // the extension is active. First run: auto-expand the intro once.
  renderPill();
  try {
    if (!localStorage.getItem("xss_onboarded")) {
      localStorage.setItem("xss_onboarded", "1");
      expand();
      setTimeout(() => {
        if (!findings.length) collapse();
      }, 6000);
    }
  } catch {
    /* localStorage may be blocked; non-fatal */
  }

  return {
    el: root,
    update(f: Finding[]) {
      const grew = f.length > findings.length;
      findings = f;
      root.style.display = "";
      renderPill();
      if (open) renderCard();
      if (grew) {
        // New finding: replay one compact radar lap without resizing the pill.
        pill.classList.remove("hit-pulse");
        void pill.offsetWidth; // restart the animation
        pill.classList.add("hit-pulse");
        setTimeout(() => pill.classList.remove("hit-pulse"), 950);
      }
    },
    setScanning(n: number) {
      scanning = Math.max(0, n);
      if (!open) renderPill();
    },
    /** Bump the "X accounts evaluated this page" counter. Drives the pill's
     *  scan-progress label so the user sees motion on big reply threads even
     *  when most accounts come back clean. */
    bumpScanned() {
      scanned++;
      if (!open) renderPill();
    },
  };
}

export interface BadgeActions {
  onBlock: () => void;
  onHide: () => void;
  onReport: () => void | Promise<void>;
  onAppeal: () => void;
  onCheck?: () => void; // present => ghost manual-check state
  canReport?: boolean;
}

/** Inline pill on the author row; hover/focus → popover with reasons. */
/** Where a verdict came from. Drives badge color + tag so the user can tell
 *  「公榜确认 / 本地缓存 / AI 现场判定 / 维护者白名单」apart at a glance.
 *  - `list`      → human-confirmed public blacklist hit  → red 公榜 tag
 *  - `whitelist` → maintainer-curated safe list hit       → green 白名单 badge
 *  - `cache`     → local L2 cache hit (no network call)   → muted 缓存 tag
 *  - `fresh`     → just classified by the AI this session → amber AI tag */
export type BadgeSource = "fresh" | "list" | "cache" | "whitelist";

type PopPoint = { x: number; y: number };
let popoverShadow: ShadowRoot | null = null;

function getPopoverRoot(): ShadowRoot {
  if (popoverShadow && popoverShadow.host.isConnected) return popoverShadow;
  const host = document.createElement("mxga-popovers");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.zIndex = "2147482001";
  host.style.pointerEvents = "none";
  host.style.overflow = "visible";
  const root = host.attachShadow({ mode: "open" });
  const st = document.createElement("style");
  st.textContent = STYLE;
  root.append(st);
  (document.documentElement || document.body).appendChild(host);
  popoverShadow = root;
  return root;
}

function popPoint(ev: Event | undefined, el: HTMLElement): PopPoint {
  if (ev instanceof MouseEvent) return { x: ev.clientX, y: ev.clientY };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.bottom };
}

function placePopover(pop: HTMLElement, point: PopPoint): void {
  const pad = 8;
  const gap = 10;
  pop.style.left = `${Math.round(point.x + gap)}px`;
  pop.style.top = `${Math.round(point.y + gap)}px`;
  requestAnimationFrame(() => {
    const r = pop.getBoundingClientRect();
    const width = r.width || pop.offsetWidth || 280;
    const height = r.height || pop.offsetHeight || 120;
    let left = point.x + gap;
    let top = point.y + gap;
    if (left + width + pad > window.innerWidth) left = point.x - width - gap;
    if (top + height + pad > window.innerHeight) top = point.y - height - gap;
    const maxLeft = Math.max(pad, window.innerWidth - width - pad);
    const maxTop = Math.max(pad, window.innerHeight - height - pad);
    pop.style.left = `${Math.round(Math.min(Math.max(pad, left), maxLeft))}px`;
    pop.style.top = `${Math.round(Math.min(Math.max(pad, top), maxTop))}px`;
  });
}

async function runReportButton(btn: HTMLButtonElement, action: () => void | Promise<void>) {
  if (btn.disabled) return;
  const original = btn.textContent || "上报";
  btn.disabled = true;
  btn.classList.remove("done", "err");
  btn.textContent = "上报中";
  btn.title = "";
  try {
    await action();
    btn.classList.add("done");
    btn.textContent = "已上报";
  } catch (e) {
    btn.disabled = false;
    btn.classList.add("err");
    btn.textContent = "失败";
    btn.title = e instanceof Error ? e.message : String(e);
    window.setTimeout(() => {
      btn.classList.remove("err");
      btn.textContent = original;
    }, 1800);
  }
}

/** Animated transient states for newly-found accounts. */
export function createStatusBadge(kind: "analyzing" | "pending"): HTMLElement {
  const el = document.createElement("span");
  if (kind === "analyzing") {
    el.className = "xss-badge analyzing labeled";
    el.setAttribute("aria-label", "MXGA 正在分析");
    el.innerHTML = `<span class="xss-ico">${icon("shield", "currentColor", 12)}</span><span class="xss-label">分析</span>`;
  } else {
    el.className = "xss-badge pending labeled";
    el.setAttribute("aria-label", "MXGA 排队检测");
    el.innerHTML = `<span class="xss-ico">${icon("shield", "currentColor", 12)}</span><span class="xss-label">排队</span>`;
  }
  return el;
}

export function createBadge(
  v: Verdict | null,
  a: BadgeActions,
  note?: string,
  source: BadgeSource = "fresh",
): HTMLElement {
  const el = document.createElement("span");
  el.tabIndex = 0;
  // Maintainer whitelist hit — short-circuit to a green "已加入白名单" badge.
  // Doesn't pop a verdict card; the user just needs to know "this account is
  // explicitly vetted, don't worry about it".
  if (source === "whitelist") {
    el.className = "xss-badge whitelist labeled";
    el.setAttribute("aria-label", "MXGA 维护者已确认安全（白名单）");
    el.innerHTML = `<span class="xss-ico">${icon("shield-check", "currentColor", 12)}</span><span class="xss-label">白名单</span>`;
    return el;
  }
  if (!v) {
    el.className = "xss-badge ghost labeled";
    el.setAttribute("aria-label", a.canReport ? "MXGA：检查、上报或拉黑并上报" : "MXGA 手动检查");
    el.innerHTML = `<span class="xss-ico">${icon("shield", "currentColor", 12)}</span><span class="xss-label">检查</span>`;
    if (!a.canReport) {
      el.addEventListener("click", () => a.onCheck?.());
      return el;
    }
    let manualPop: HTMLElement | null = null;
    let manualHideTimer: number | undefined;
    const hideManual = () => {
      if (manualHideTimer) window.clearTimeout(manualHideTimer);
      manualHideTimer = undefined;
      manualPop?.remove();
      manualPop = null;
    };
    const cancelManualHide = () => {
      if (manualHideTimer) window.clearTimeout(manualHideTimer);
      manualHideTimer = undefined;
    };
    const scheduleManualHide = () => {
      cancelManualHide();
      manualHideTimer = window.setTimeout(hideManual, 180);
    };
    const showManual = (ev?: Event) => {
      cancelManualHide();
      if (!manualPop) {
        manualPop = document.createElement("div");
        manualPop.className = "xss pop card";
        manualPop.style.display = "block";
        manualPop.innerHTML = `
          <h4>手动处理</h4>
          <div style="color:var(--muted);line-height:1.55">未命中公榜时，可主动检查；确认可疑后再上报或拉黑并上报。</div>
          <div class="acts">
            <button data-c>检查</button>
            <button data-r>上报</button>
            <button data-b>拉黑并上报</button>
          </div>`;
        manualPop.querySelector("[data-c]")?.addEventListener("click", () => {
          a.onCheck?.();
          hideManual();
        });
        manualPop.querySelector<HTMLButtonElement>("[data-r]")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const btn = ev.currentTarget as HTMLButtonElement;
          void runReportButton(btn, a.onReport).then(() => {
            if (btn.classList.contains("done")) window.setTimeout(hideManual, 600);
          });
        });
        manualPop.querySelector("[data-b]")?.addEventListener("click", () => {
          a.onBlock();
          hideManual();
        });
        manualPop.addEventListener("mouseenter", cancelManualHide);
        manualPop.addEventListener("mouseleave", scheduleManualHide);
        getPopoverRoot().appendChild(manualPop);
      }
      placePopover(manualPop, popPoint(ev, el));
    };
    el.addEventListener("click", showManual);
    el.addEventListener("mouseenter", showManual);
    el.addEventListener("focus", showManual);
    el.addEventListener("mouseleave", scheduleManualHide);
    el.addEventListener("blur", scheduleManualHide);
    return el;
  }
  const meta = LABEL[v.label];
  const known = source === "list" || source === "cache";
  const spammy = v.label === "spam" || v.label === "porn_bot" || v.label === "likely_spam";
  const color = spammy ? "var(--danger)" : `var(${meta.varName})`;
  el.className = `xss-badge labeled verdict ${source} ${spammy ? "spammy" : ""} ${known ? "known" : "fresh"}`;
  el.style.setProperty("--badge-color", color);
  // Tier-specific tooltip + tag — tells the user exactly which gate matched.
  const tip =
    source === "list"
      ? "公榜确认：≥1 个维护者已经把此账号公开拉黑"
      : source === "cache"
        ? "本地缓存命中：本机之前已经判过这个号"
        : "AI 现场判定：本次会话首次扫描，已记录待人工确认";
  el.setAttribute("aria-label", `${tip}：${meta.zh} ${(v.confidence * 100).toFixed(0)}%`);
  const badgeText = source === "list" ? "公榜" : BADGE_TEXT[v.label];
  el.innerHTML = `<span class="xss-ico">${icon(meta.ic, "currentColor", 12)}</span><span class="xss-label">${badgeText}</span>`;

  let pop: HTMLElement | null = null;
  let hideTimer: number | undefined;
  const hide = () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = undefined;
    pop?.remove();
    pop = null;
  };
  const cancelHide = () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = undefined;
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer = window.setTimeout(hide, 160);
  };
  const show = (ev?: Event) => {
    cancelHide();
    if (!pop) {
      pop = document.createElement("div");
      pop.className = "xss pop card";
      pop.style.display = "block";
      const spammy = ["spam", "porn_bot", "likely_spam"].includes(v.label);
      // reasons come from the LLM Worker — technically prompt-injectable via
      // a malicious user's bio. Escape unconditionally. note is a server-
      // controlled debug string ("数字ID未解析…") but escape it too for
      // consistency with the rest of the popover.
      pop.innerHTML = `
        <h4 style="color:${color}">${meta.zh} · ${(v.confidence * 100).toFixed(0)}%</h4>
        <ul>${v.reasons.map((r) => `<li>${escHtml(r)}</li>`).join("")}</ul>
        ${note ? `<div style="color:var(--muted)">${escHtml(note)}</div>` : ""}
        <div class="acts">
          ${spammy ? '<button data-b>拉黑</button><button data-h>隐藏</button>' : ""}
          ${a.canReport ? '<button data-r>上报</button>' : ""}
          <button data-a>误判?</button>
        </div>`;
      pop.querySelector("[data-b]")?.addEventListener("click", a.onBlock);
      pop.querySelector("[data-h]")?.addEventListener("click", a.onHide);
      pop.querySelector<HTMLButtonElement>("[data-r]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void runReportButton(ev.currentTarget as HTMLButtonElement, a.onReport);
      });
      pop.querySelector("[data-a]")?.addEventListener("click", a.onAppeal);
      pop.addEventListener("mouseenter", cancelHide);
      pop.addEventListener("mouseleave", scheduleHide);
      getPopoverRoot().appendChild(pop);
    }
    placePopover(pop, popPoint(ev, el));
  };
  el.addEventListener("click", show);
  el.addEventListener("mouseenter", show);
  el.addEventListener("focus", show);
  el.addEventListener("mouseleave", scheduleHide);
  el.addEventListener("blur", scheduleHide);
  return el;
}
