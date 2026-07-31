// Design system + components, all rendered inside a Shadow DOM so X's CSS
// cannot bleed in and ours cannot leak out. Vanilla DOM — no framework
// weight injected into the page. Tokens per docs/UX.md.
import { BRAND } from "./brand";
import type { ActionMode } from "./settings";
import type { Label, Verdict } from "./types";

export const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui,-apple-system,"Segoe UI",sans-serif; }
/* :host is REQUIRED here: badges/popovers each live in their own shadow
 * root, where :root/.xss match nothing — without :host every var() below
 * fails and the badge degrades to unstyled black text (the v0.5 regression). */
:host, :root, .xss {
  /* dark default (X dark mode) */
  --surface: rgba(13,17,23,.92); --border: rgba(255,255,255,.10);
  --shadow: 0 8px 28px rgba(0,0,0,.45); --text: #E6EDF3; --muted: #8B949E;
  --brand: #0EA5E9; --danger: #EF4444; --warn: #F59E0B; --neutral: #8B949E;
  --safe: #16A34A; --hover: rgba(255,255,255,.06);
}
@media (prefers-color-scheme: light) {
  :host, :root, .xss {
    --surface: rgba(255,255,255,.96); --border: rgba(15,23,42,.12);
    --shadow: 0 8px 28px rgba(15,23,42,.18); --text: #0F172A; --muted: #475569;
    --brand: #0369A1; --danger: #DC2626; --warn: #B45309; --neutral: #475569;
    --safe: #15803D; --hover: rgba(15,23,42,.06);
  }
}
.xss-bubble {
  position: fixed;
  right: max(12px, env(safe-area-inset-right));
  top: max(12px, env(safe-area-inset-top));
  z-index: 2147483000;
  color: var(--text); -webkit-font-smoothing: antialiased;
}
.xss-bubble.br {
  top: auto;
  bottom: max(12px, env(safe-area-inset-bottom));
}
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
.card {
  width: min(312px, calc(100vw - 24px));
  padding: 14px; display: none; margin-top: 10px;
}
/* Expand = the card GROWS out of the pill with a springy overshoot
 * (origin sits up near the pill), instead of teleporting into place. */
.card { transform-origin: calc(100% - 34px) -8px; }
.card.open { display: block; animation: cardin .38s cubic-bezier(.3, 1.28, .44, 1); }
@keyframes cardin {
  0% { opacity: 0; transform: translateY(-7px) scale(.9); }
  55% { opacity: 1; }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
/* Fold-back mirrors the expand: shrink toward the pill, then display:none
 * (class removed on animationend in collapse()). */
.card.closing { display: block; animation: cardout .2s ease-in forwards; }
@keyframes cardout {
  to { opacity: 0; transform: translateY(-6px) scale(.92); }
}
.hd { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.hd .x { margin-left: auto; cursor: pointer; color: var(--muted); display: flex; }
.hd .x:hover { color: var(--text); }
.sub {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px; margin: 10px 0 12px;
  font-size: 11px; color: var(--muted);
}
.metric {
  min-width: 0; height: 30px; display: flex; align-items: center; justify-content: center;
  gap: 4px; padding: 0 5px; border-radius: 8px;
  background: color-mix(in srgb, var(--muted) 7%, transparent);
  font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden;
  position: relative;
}
/* 已处理 counter pop — plays when an absorbed row lands in the chip. */
.metric.tick { animation: mtick .5s cubic-bezier(.3, 1.5, .5, 1); overflow: visible; }
@keyframes mtick {
  0% { transform: scale(1); }
  35% { transform: scale(1.16); }
  100% { transform: scale(1); }
}
.m-plus {
  position: absolute; top: -13px; right: 4px; pointer-events: none;
  font-size: 10px; font-weight: 800; color: var(--danger);
  animation: mplus .8s ease-out forwards;
}
@keyframes mplus {
  0% { opacity: 0; transform: translateY(7px); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-9px); }
}
/* Flying ghost of a settled row on its way into the 已处理 chip. */
.q-fly {
  position: fixed; z-index: 2147483002; pointer-events: none;
  display: flex; align-items: flex-start; gap: 8px; padding: 7px 6px;
  border-radius: 10px; color: var(--text);
  background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.metric b { color: var(--text); font-size: 12px; font-weight: 760; line-height: 1; }
.metric em { font-style: normal; overflow: hidden; text-overflow: ellipsis; }
.metric i { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex: none; }
/* The 已处理 chip doubles as a tab: it lists the whole-session record
 * (done rows from THIS page stay in the live queue too — v0.4 checklist). */
.metric.tab { cursor: pointer; user-select: none; transition: background .14s ease, box-shadow .14s ease; }
.metric.tab:hover { background: color-mix(in srgb, var(--muted) 16%, transparent); }
.metric.tab.on {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 38%, transparent);
}
.queue-empty {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 16px 10px; border-radius: 10px;
  font-size: 11.5px; color: var(--muted);
  background: color-mix(in srgb, var(--safe) 6%, transparent);
}
.btn {
  width: 100%; border: 0; border-radius: 10px; padding: 9px 12px;
  font-size: 13px; font-weight: 600; cursor: pointer; color: #fff;
  background: var(--danger); transition: filter .14s ease;
}
.btn:hover { filter: brightness(1.08); }
.btn:disabled { opacity: .55; cursor: default; }

/* Per-row action button — same color language as bulk btn, smaller scale. */
.xss-act {
  flex: none; border: 0; border-radius: 8px; padding: 5px 10px;
  font-size: 11.5px; font-weight: 600; cursor: pointer; color: #fff;
  background: var(--danger); transition: filter .14s ease, background .14s;
  white-space: nowrap;
}
.xss-act:hover { filter: brightness(1.08); }
.xss-act:disabled { cursor: default; }
/* Done chip stays in the danger family (v0.4 处理垃圾 = 红色语言) — tinted,
 * not solid, so it can't be mistaken for the still-clickable solid button. */
.xss-act.done {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger); opacity: .95;
}
.xss-act.queue {
  background: transparent; color: var(--brand);
  border: 1px solid var(--brand);
}
.xss-act.queue.busy { animation: xpulse 1.2s ease-in-out infinite; }
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

/* 自动处理 master switch (card header area) — themed mini toggle. */
.auto-row {
  display: flex; align-items: center; gap: 7px; margin-top: 9px;
  font-size: 11.5px; font-weight: 600; color: var(--text);
}
.auto-row .auto-hint {
  margin-left: auto; font-size: 10.5px; font-weight: 500;
  color: var(--muted); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis;
}
.xss-sw {
  position: relative; width: 30px; height: 18px; flex: none; padding: 0;
  border-radius: 999px; cursor: pointer;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--muted) 28%, transparent);
  transition: background .16s ease, border-color .16s ease;
}
.xss-sw::after {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 12px; height: 12px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.35);
  transition: transform .16s ease;
}
.xss-sw[aria-checked="true"] { background: var(--brand); border-color: var(--brand); }
.xss-sw[aria-checked="true"]::after { transform: translateX(12px); }
@media (prefers-reduced-motion: reduce) {
  .xss-sw, .xss-sw::after { transition: none; }
}
.row { display: flex; gap: 14px; margin-top: 10px; font-size: 12px; }
.lnk { color: var(--muted); cursor: pointer; }
.lnk:hover { color: var(--text); }
.block-progress {
  margin: -2px 0 13px;
}
.progress-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px; font-size: 11px; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.progress-head b {
  color: var(--text); font-size: 11px; font-weight: 750;
}
.progress-track {
  height: 9px; display: flex; overflow: hidden; border-radius: 999px;
  background: color-mix(in srgb, var(--muted) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent);
}
.progress-seg {
  height: 100%; min-width: 0; transition: width .22s ease;
}
.progress-seg + .progress-seg {
  box-shadow: inset 1px 0 0 color-mix(in srgb, var(--surface) 70%, transparent);
}
.progress-seg.done { background: linear-gradient(90deg, color-mix(in srgb, var(--danger) 78%, #fff), var(--danger)); }
.progress-seg.active {
  background:
    repeating-linear-gradient(115deg, rgba(255,255,255,.22) 0 6px, transparent 6px 12px),
    linear-gradient(90deg, color-mix(in srgb, var(--danger) 72%, #fff), var(--danger));
  animation: pbarshift .9s linear infinite;
}
.progress-seg.queued { background: linear-gradient(90deg, color-mix(in srgb, var(--brand) 76%, #fff), var(--brand)); }
.progress-seg.failed { background: linear-gradient(90deg, color-mix(in srgb, var(--warn) 76%, #fff), var(--warn)); }
.progress-seg.idle { background: color-mix(in srgb, var(--muted) 24%, transparent); }
.queue-table {
  max-height: 226px; overflow: auto; margin: 0 -4px 10px; padding: 0 4px;
  scrollbar-width: thin;
  /* Rows carry state tints now — breathing room between them, or adjacent
   * tinted rows fuse into one solid slab. */
  display: flex; flex-direction: column; gap: 5px;
}
.qrow {
  display: flex; align-items: flex-start; gap: 8px; padding: 7px 6px;
  border-radius: 10px; transform-origin: top center; flex: none;
  transition: background .14s ease, opacity .14s ease;
}
/* First render of a row slides in; on card expand every row is "new", and
 * the per-slot delays turn that into a soft cascade down the list. */
.qrow.new { animation: qrowin .26s cubic-bezier(.2,.7,.2,1) backwards; }
.qrow.new:nth-child(2) { animation-delay: .045s; }
.qrow.new:nth-child(3) { animation-delay: .09s; }
.qrow.new:nth-child(4) { animation-delay: .135s; }
.qrow.new:nth-child(n+5) { animation-delay: .18s; }
.qrow.active { background: color-mix(in srgb, var(--danger) 8%, transparent); }
.qrow.queued { background: color-mix(in srgb, var(--brand) 7%, transparent); }
.qrow.failed { background: color-mix(in srgb, var(--warn) 8%, transparent); }
/* Done rows go QUIET (neutral, not red): strikethrough + dimmed avatar
 * already say "handled", and full red tint here drowned the hierarchy —
 * red is reserved for the in-flight row and the small status accents. */
.qrow.done { background: color-mix(in srgb, var(--muted) 7%, transparent); }
.qavatar {
  width: 26px; height: 26px; border-radius: 50%; flex: none; object-fit: cover;
  transition: filter .18s ease, opacity .18s ease;
}
.qavatar.blank { background: var(--border); }
.qbody { min-width: 0; flex: 1; }
.qname {
  font-weight: 650; font-size: 12px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.qmeta { font-size: 11px; }
/* Per-row 误判 link — quiet until hovered, so it never competes with the
 * account meta but stays reachable for a wrongly-listed account. */
.qappeal {
  margin-left: 6px; color: var(--muted); cursor: pointer;
  text-decoration: none; font-weight: 600; opacity: .7;
}
.qappeal:hover { color: var(--warn); opacity: 1; text-decoration: underline; }
.qsnip {
  font-size: 11px; color: var(--muted); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
/* 命中原因 chips — tiny tags, visually separate from the content snippet. */
.qtags { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 1px; }
.qtag {
  font-size: 9.5px; font-weight: 650; line-height: 1; padding: 2.5px 6px;
  border-radius: 999px; white-space: nowrap; max-width: 160px;
  overflow: hidden; text-overflow: ellipsis;
  color: var(--muted); border: 1px solid color-mix(in srgb, var(--muted) 32%, transparent);
  background: color-mix(in srgb, var(--muted) 8%, transparent);
}
.qtag.warn {
  color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent);
  background: color-mix(in srgb, var(--warn) 9%, transparent);
}
.qnote { font-size: 11px; }
.qrow.done .qavatar {
  filter: grayscale(1); opacity: .38;
}
.qrow.done .qname,
.qrow.done .qsnip {
  text-decoration: line-through; opacity: .52;
}
/* One-shot red flash the moment a row flips to done — the checklist
 * "tick" that makes batch progress feel tangible (danger family, v0.4). */
.qrow.done.flip { animation: qdoneflash .45s ease-out; }
@keyframes qdoneflash {
  0% { background: color-mix(in srgb, var(--danger) 26%, transparent); transform: scale(1.015); }
}
svg { display: block; }
.xss-badge {
  --badge-color: var(--muted);
  display: inline-flex; align-items: center; gap: 4px; margin-left: 6px;
  padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 750;
  line-height: 1; white-space: nowrap;
  vertical-align: middle; cursor: default;
  /* Solid pill, white text — the "精致明显" badge users recognize. A subtle
   * inner highlight ring + darker edge give it the polished look; tinted
   * outline variants read as washed-out in the timeline. */
  color: #fff; background: var(--badge-color);
  border: 1px solid color-mix(in srgb, var(--badge-color) 78%, #000);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.16), 0 1px 4px rgba(15,23,42,.16);
}
.xss-badge svg { flex: none; }
.xss-badge.ghost {
  color: var(--muted); cursor: pointer;
  border-color: var(--border); background: transparent; box-shadow: none;
}
.xss-badge.ghost:hover { color: var(--text); }
/* v0.4 popover: soft 12px radius, deep layered shadow, pop-in scale. */
.pop {
  position: fixed; z-index: 2147482001; width: 280px; padding: 12px;
  margin: 0; /* .card's margin-top would shift the measured placement */
  max-width: calc(100vw - 16px);
  font-size: 12px; color: var(--text); border-radius: 12px;
  box-shadow: 0 18px 48px rgba(15,23,42,.22), 0 2px 8px rgba(15,23,42,.10);
  transform-origin: 12px 12px; animation: xpop .14s ease-out;
  pointer-events: auto;
}
.pop h4 { margin: 0 0 6px; font-size: 12.5px; font-weight: 750; }
.pop ul { margin: 6px 0; padding-left: 16px; color: var(--muted); }
.pop li { margin: 3px 0; }
/* v0.4 action buttons: pill shape with a per-action visual hierarchy —
 * data-b solid danger (primary), data-h muted outline, data-r warm outline,
 * data-a plain text link. */
.acts { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 10px; }
.acts button {
  border: 1px solid var(--border); background: transparent; color: var(--text);
  border-radius: 999px; padding: 5px 10px; font-size: 11px; font-weight: 650;
  cursor: pointer; transition: transform .12s ease, background .12s ease, border-color .12s ease, color .12s ease, filter .12s ease;
}
.acts button:hover { transform: translateY(-1px); background: var(--hover); }
.acts button[data-b] {
  color: #fff; border-color: transparent;
  background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 92%, #fff), var(--danger));
}
.acts button[data-b]:hover { filter: brightness(1.05); }
.acts button[data-h] {
  color: var(--muted);
  border-color: color-mix(in srgb, var(--muted) 32%, var(--border));
}
.acts button[data-r] {
  color: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 48%, var(--border));
  background: color-mix(in srgb, var(--warn) 9%, transparent);
}
.acts button[data-a] { color: var(--muted); border-color: transparent; }
.acts button[data-report] {
  color: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 46%, var(--border));
  background: color-mix(in srgb, var(--warn) 9%, transparent);
}
.acts button:disabled { cursor: default; transform: none; filter: none; opacity: .7; }
/* 举报 inline result line — text only, colored by outcome. */
.pop-status { margin-top: 8px; font-size: 11px; line-height: 1.5; }
.pop-status[data-kind="info"] { color: var(--muted); }
.pop-status[data-kind="ok"] { color: var(--danger); }
.pop-status[data-kind="err"] { color: var(--warn); }
@media (pointer: coarse) {
  .pill { min-height: 44px; }
  .acts button { min-height: 40px; padding-inline: 14px; }
  .xss-badge { min-height: 28px; }
}

/* ---- animated badge states (transform/opacity only) ---- */
.xss-badge.fresh { animation: xrise .22s ease-out; }
.xss-badge.known { animation: xpop .18s ease-out; }
.xss-badge .ntag {
  margin-left: 4px; padding: 0 5px; border-radius: 999px; font-size: 9px;
  font-weight: 700; color: var(--warn); border: 1px solid var(--warn);
  letter-spacing: .3px;
}
.xss-badge.analyzing {
  color: var(--muted); position: relative; overflow: hidden;
}
.xss-badge.analyzing::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent);
  transform: translateX(-100%); animation: xshim 1.1s ease-in-out infinite;
}
.xss-spin { animation: xspin .8s linear infinite; transform-origin: 50% 50%; }
/* Pending-undo badge (⏳ 5秒后处理 + 撤销) — warn-outlined, not a solid pill. */
.xss-badge.pending {
  color: var(--warn); cursor: default;
  background: color-mix(in srgb, var(--warn) 10%, transparent);
  border-color: var(--warn); box-shadow: none;
  animation: xpulse 1.6s ease-in-out infinite;
}
/* v0.4 "拉黑中" in-place badge: solid danger pill breathing on the tweet
 * while the auto queue works it, with a spinner ring around the icon —
 * THIS is the visible "the extension is doing something" moment. */
.xss-badge.acting {
  --badge-color: var(--danger);
  color: #fff; cursor: default; overflow: visible;
  background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 92%, #fff), var(--danger));
  border-color: color-mix(in srgb, var(--danger) 90%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger) 18%, transparent), 0 2px 9px color-mix(in srgb, var(--danger) 24%, transparent);
  animation: xactpulse 1.25s ease-in-out infinite;
}
.xss-badge.acting .xss-ico {
  position: relative; display: inline-flex; flex: none;
}
.xss-badge.acting .xss-ico::after {
  content: ""; position: absolute; inset: -4px; border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, #fff 30%, transparent);
  border-top-color: #fff; animation: xspin .72s linear infinite;
}
@keyframes xactpulse {
  0%,100% { transform: translateY(0); filter: brightness(1); }
  50% { transform: translateY(-1px); filter: brightness(1.1); }
}
/* Queued-for-auto badge — quiet outline, the row is waiting its turn. */
.xss-badge.actqueued {
  color: var(--danger); cursor: default;
  background: color-mix(in srgb, var(--danger) 9%, transparent);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  box-shadow: none; animation: xpulse 1.8s ease-in-out infinite;
}
@keyframes xrise { from { opacity: 0; transform: translateY(4px); } }
@keyframes xpop  { from { opacity: 0; transform: scale(.9); } }
@keyframes xspin { to { transform: rotate(360deg); } }
@keyframes xshim { to { transform: translateX(100%); } }
@keyframes xpulse { 0%,100% { opacity: .55; } 50% { opacity: .95; } }
@keyframes xradar { to { transform: rotate(360deg); } }
@keyframes xbreath { 0%,100% { filter: saturate(1); } 50% { filter: saturate(1.35); } }
@keyframes qrowin {
  from { opacity: 0; transform: translateY(-7px) scale(.985); }
}
@keyframes pbarshift {
  to { background-position: 22px 0, 0 0; }
}

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
  .card.closing { display: none; animation: none; }
  @keyframes fade { from { opacity: 0; } }
  .xss-badge.fresh, .xss-badge.known { animation: fade .18s ease-out; }
  .xss-badge.analyzing::after, .xss-spin { animation: none; }
  .xss-badge.pending { animation: none; opacity: .7; }
  .xss-badge.acting, .xss-badge.acting .xss-ico::after,
  .xss-badge.actqueued { animation: none; }
  .metric.tick, .m-plus { animation: none; }
  .m-plus { display: none; }
  .scan-radar.busy,
  .scan-radar.busy .scan-sweep,
  .qrow.new,
  .qrow.done.flip,
  .xss-act.queue.busy,
  .progress-seg.active { animation: none; }
  .pill.hit-pulse .scan-radar { animation: none; }
}
`;

/** HTML-escape untrusted text before innerHTML interpolation (reasons and
 *  display names can embed attacker-controlled strings from page content or
 *  the bundled blacklist). */
const esc = (s: string) =>
  s.replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
  );

/** Only render avatar URLs that are plainly X CDN images. */
const safeAvatarUrl = (url: string | undefined): string | undefined =>
  url && /^https:\/\/pbs\.twimg\.com\//.test(url) ? url : undefined;

/** Inline status line inside a popover (举报 result). Text-only, no HTML. */
function setPopStatus(el: HTMLElement | null | undefined, msg: string, kind: "info" | "ok" | "err") {
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
  el.hidden = false;
}

// Lucide-style 24-viewBox stroke icons. No emoji (per design system).
const P: Record<string, string> = {
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  "shield-alert": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 8v4M12 16h.01",
  "shield-x": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9.5 9.5l5 5M14.5 9.5l-5 5",
  "shield-check": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
  x: "M18 6 6 18M6 6l12 12",
};
export function icon(name: keyof typeof P | string, color = "currentColor", size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="1.75" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true"><path d="${P[name] ?? P.shield}"/></svg>`;
}

// Compact one-word badge text (v0.4) — details live in the hover popover.
export const BADGE_TEXT: Record<Label, string> = {
  spam: "垃圾",
  porn_bot: "色情",
  likely_spam: "疑似",
  uncertain: "存疑",
  legit: "正常",
};

export const LABEL: Record<Label, { zh: string; varName: string; ic: string }> = {
  spam: { zh: "垃圾", varName: "--danger", ic: "shield-x" },
  porn_bot: { zh: "色情bot", varName: "--danger", ic: "shield-x" },
  likely_spam: { zh: "疑似垃圾", varName: "--warn", ic: "shield-alert" },
  uncertain: { zh: "不确定", varName: "--neutral", ic: "shield" },
  legit: { zh: "正常", varName: "--safe", ic: "shield-check" },
};

export interface Finding {
  handle: string;
  userId?: string;
  avatarUrl?: string;
  displayName?: string;
  snippet?: string;
  source?: string;
  /** 中文类别（色情招揽/币圈投放…）— rendered as a chip on the row. */
  categoryZh?: string;
  /** List-hit provenance chip: 人工确认 (confirmed) vs 自动收录 (auto).
   *  Explains per-row why treatment differs under the tiered auto policy. */
  tier?: "confirmed" | "auto";
  /** Status id of the triggering tweet — flows into the 处理记录 audit trail. */
  tweetId?: string;
  verdict: Verdict;
}

/** Row lifecycle inside the bubble's batch panel. A key absent from the
 *  state map is "pending" (untouched, selectable). */
type RowState = "queued" | "processing" | "done" | "failed";

export interface BubbleHandlers {
  /** Process the given account keys ONE BY ONE (the caller owns pacing /
   *  real X actions) and call onProgress(key, ok) as each one finishes.
   *  The bubble advances chips + progress bar + row states on every call. */
  onProcess: (keys: string[], onProgress: (key: string, ok: boolean) => void) => void;
  onReviewEach: () => void;
  onDismiss: () => void;
  /** Per-row 误判申诉 — opens the pre-filled GitHub appeal for this account. */
  onAppeal: (appeal: { handle: string; userId?: string }) => void;
  /** 自动处理 master switch flipped from the card header. */
  onToggleAuto?: (v: boolean) => void;
}

export interface BubbleOpts {
  /** Initial 自动处理 switch state (settings.autoProcess). */
  autoProcess?: boolean;
  /** How many spam categories currently escalate beyond "badge". */
  autoCategoryCount?: number;
  /** true = auto actions fire everywhere (settings.autoScope === "all");
   *  false = replies-only (default scope). */
  autoScopeAll?: boolean;
  /** Pop the card open when the auto queue starts (settings.autoExpand).
   *  false = stay collapsed; the pill's hit-pulse is the only signal. */
  autoExpand?: boolean;
}

/** Collapsed pill ⇄ expanded card. Default resting state = pill.
 *  `verb` is the action label (隐藏 / 静音 / 拉黑) per settings.actionMode. */
export function createBubble(
  h: BubbleHandlers,
  pos: "tr" | "br" = "tr",
  verb = "隐藏",
  opts: BubbleOpts = {},
) {
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
  // Row states are keyed by account key, NOT stored on the Finding — the
  // caller replaces the findings array wholesale on update().
  const rowState = new Map<string, RowState>();
  // Unchecked keys. Default for a fresh finding = selected (checked).
  const deselected = new Set<string>();
  // Rows already rendered once — suppresses the slide-in replay on rerender.
  const seenRows = new Set<string>();
  // Rows already rendered in the done state — the red "tick" flash plays
  // only on the render where a row first flips to done.
  const doneSeen = new Set<string>();
  // A done row flies INTO the 已处理 chip (shrink + absorb + counter pop)
  // as soon as its ✓ tick has registered — the tick flash and the takeoff
  // read as ONE continuous motion, no dead wait in between. Absorbed keys
  // leave the live list and are served by the 已处理 tab instead.
  const DONE_LINGER_MS = 400;
  const absorbed = new Set<string>();
  const absorbTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Keys whose row is folding / whose ghost is flying. Renders exclude them
  // (a table rebuild must not resurrect a folding row); flyKeys() moves them
  // into `absorbed` as the ghosts land.
  const absorbing = new Set<string>();
  // Keys waiting for a SOLO flight (auto path) — geometry is measured at
  // takeoff, not enqueue time, so a shifted/scrolled list can't go stale.
  const flights: string[] = [];
  let flying = false;
  // Manual bulk: a short beat for the last ✓ to register, then the whole
  // batch flies as ONE flock.
  const BATCH_LINGER_MS = 700;
  // Rows driven by the AUTO path (per-category policy): the extension acts
  // on its own, so the checkbox and per-row button are display-only.
  const autoRows = new Set<string>();
  // Per-row auto verb (拉黑/静音/隐藏) so the row states the REAL action.
  const autoVerbs = new Map<string, string>();
  // Session archive: rows processed on EARLIER pages of this browsing
  // session. SPA navigation calls pageReset() — the card collapses, live
  // findings are dropped, and done/failed rows move here so the 已处理 tab
  // keeps the whole session until a hard page reload.
  const archive: Finding[] = [];
  const archivedKeys = new Set<string>();
  let autoOn = opts.autoProcess ?? true;
  let autoCats = opts.autoCategoryCount ?? 0;
  let autoScopeAll = opts.autoScopeAll ?? false;
  // Card list view: the live queue by default; "done" lists processed rows
  // behind the 已处理 chip so they don't pile up under the progress bar.
  let view: "queue" | "done" = "queue";
  // Feed ordering: the list reads newest-activity-first (最新处理的在最上).
  // Every meaningful event on a row — discovered, started processing,
  // finished/failed — bumps its sequence; the queue sorts descending, so the
  // action is always at the top of the list without any scroll chasing.
  const activitySeq = new Map<string, number>();
  let seqCounter = 0;
  const bump = (k: string) => activitySeq.set(k, ++seqCounter);
  const byActivity = (a: Finding, b: Finding) =>
    (activitySeq.get(rowKey(b)) ?? 0) - (activitySeq.get(rowKey(a)) ?? 0);
  // Every render rebuilds .queue-table via innerHTML (scrollTop silently
  // resets to 0 = the newest rows). If the user scrolled down into history,
  // restore their position instead of yanking them back to the top.
  let queueScrollTop = 0;

  // Must match content.ts keyOf(): userId first, `h:${handle}` fallback.
  const rowKey = (f: Finding) => f.userId || `h:${f.handle}`;
  const stateOf = (f: Finding): RowState | "pending" =>
    rowState.get(rowKey(f)) ?? "pending";
  const selectable = (f: Finding) => {
    if (autoRows.has(rowKey(f))) return false; // auto rows are not user-actionable
    if (archivedKeys.has(rowKey(f))) return false; // page context is gone
    const st = stateOf(f);
    return st === "pending" || st === "failed";
  };

  const sev = (f: Finding[]) =>
    f.some((x) => x.verdict.label === "spam" || x.verdict.label === "porn_bot")
      ? "--danger"
      : "--warn";

  function stats() {
    let done = 0;
    let processing = 0;
    let queued = 0;
    let failed = 0;
    let pending = 0;
    for (const f of findings) {
      switch (stateOf(f)) {
        case "done":
          done++;
          break;
        case "processing":
          processing++;
          break;
        case "queued":
          queued++;
          break;
        case "failed":
          failed++;
          break;
        default:
          pending++;
      }
    }
    return {
      found: findings.length,
      done,
      processing,
      queued,
      failed,
      pending,
      running: processing + queued,
    };
  }

  function progressWidth(count: number, total: number) {
    if (count <= 0 || total <= 0) return "0%";
    return `${Math.max(0, Math.min(100, (count / total) * 100)).toFixed(2)}%`;
  }

  function progressSegment(
    kind: "done" | "active" | "queued" | "failed" | "idle",
    count: number,
    total: number,
  ) {
    if (count <= 0) return "";
    return `<span class="progress-seg ${kind}" style="width:${progressWidth(count, total)}"></span>`;
  }

  function renderProgress(s: ReturnType<typeof stats>) {
    const total = Math.max(1, s.found);
    const donePct = Math.round((s.done / total) * 100);
    const remaining = s.processing + s.queued + s.pending;
    return `<div class="block-progress" aria-label="处理进度 ${donePct}%">
      <div class="progress-head">
        <span>${remaining > 0 ? `剩余 ${remaining}` : "处理完成"}</span>
        <b>${donePct}%</b>
      </div>
      <div class="progress-track">
        ${progressSegment("done", s.done, total)}
        ${progressSegment("active", s.processing, total)}
        ${progressSegment("queued", s.queued, total)}
        ${progressSegment("failed", s.failed, total)}
        ${progressSegment("idle", s.pending, total)}
      </div>
    </div>`;
  }

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
    if (findings.length) {
      const s = stats();
      if (s.running > 0) {
        pill.innerHTML = progressMarkup({
          iconName: "shield-x",
          iconColor: "var(--danger)",
          title: `${verb}中`,
          count: `${s.done}/${s.found}`,
          percent: Math.max(8, Math.round((s.done / Math.max(1, s.found)) * 100)),
          busy: true,
          danger: true,
        });
        return;
      }
      if (s.done > 0 && s.done + s.failed >= s.found) {
        // Completed batch reads in the danger family too — 处理掉的是垃圾，
        // 绿色勾会被误读成"这些账号正常"（v0.4 红色语言）。
        pill.innerHTML = progressMarkup({
          iconName: "shield-check",
          iconColor: "var(--danger)",
          title: `已${verb}`,
          count: String(s.done),
          percent: 100,
          danger: true,
        });
        return;
      }
      pill.innerHTML = progressMarkup({
        iconName: "shield-alert",
        iconColor: `var(${sev(findings)})`,
        title: "命中",
        count: String(findings.length),
        percent: 100,
        busy: scanning > 0,
        danger: true,
      });
      return;
    }
    if (scanning > 0) {
      // Visible processing feedback (esp. reply sections).
      pill.innerHTML = progressMarkup({
        iconName: "shield",
        iconColor: "var(--brand)",
        title: "检查中",
        count: String(scanning),
        percent: 0,
        busy: true,
      });
      return;
    }
    if (archive.length > 0) {
      // No live hits on THIS page, but this browsing session (and re-hydrated
      // recent history) has processed accounts — keep them one click away
      // instead of resting all the way back to 守护, so navigating off a
      // page never reads as "the records vanished".
      pill.innerHTML = progressMarkup({
        iconName: "shield-check",
        iconColor: "var(--danger)",
        title: "已处理",
        count: String(archive.length),
        percent: 100,
        danger: true,
      });
      return;
    }
    // Calm "guarding" state — confirms the extension is working even
    // when nothing suspicious is on the page (no alarm color).
    pill.innerHTML = progressMarkup({
      iconName: "shield-check",
      iconColor: "var(--brand)",
      title: "守护",
      percent: 100,
    });
  }

  /** Header-area 自动处理 switch + tiny hint showing how many categories the
   *  per-category policy currently escalates (options 页的分级策略). */
  function autoRowMarkup() {
    const hint = autoOn
      ? autoCats > 0
        ? `${autoCats} 类自动 · ${autoScopeAll ? "全局" : "仅评论区"}`
        : "全部仅标记"
      : "已暂停 · 仅标记";
    return `<div class="auto-row">
      <button class="xss-sw" data-auto role="switch" aria-checked="${autoOn}"
        aria-label="自动处理"></button>
      <span>自动处理</span>
      <span class="auto-hint">${hint}</span>
    </div>`;
  }
  function bindAutoRow() {
    card.querySelector("[data-auto]")?.addEventListener("click", () => {
      autoOn = !autoOn;
      h.onToggleAuto?.(autoOn); // persists to settings; content.ts reacts
      renderCard();
    });
  }

  function renderCard() {
    if (!findings.length && !archive.length) {
      card.innerHTML = `
        <div class="hd">${icon("shield-check", "var(--brand)", 16)}
          <span>${BRAND.acronym} 已启用</span>
          <span class="x" data-x>${icon("x", "currentColor", 14)}</span></div>
        ${autoRowMarkup()}
        <div class="sub" style="display:block;line-height:1.6">
          正在被动检查本页账号。发现可疑的垃圾/色情机器人时，会在这里提示并提供一键处理。</div>
        <div class="row"><span class="lnk" data-gov>为什么 / 治理</span></div>`;
      card.querySelector("[data-x]")?.addEventListener("click", collapseByUser);
      card.querySelector("[data-gov]")?.addEventListener("click", () =>
        window.open(BRAND.governance, "_blank", "noopener"),
      );
      bindAutoRow();
      return;
    }
    const s = stats();
    const waiting = s.queued + s.pending; // 还没轮到 / 还没动手的
    const selectedPending = findings.filter(
      (f) => selectable(f) && !deselected.has(rowKey(f)),
    ).length;
    const selectableCount = findings.filter(selectable).length;
    const batchTouched = s.done + s.processing + s.queued + s.failed > 0;
    // 已处理 tab = rows absorbed into the chip + the session archive from
    // earlier pages (an account can reappear live — the live row wins).
    const liveKeys = new Set(findings.map(rowKey));
    const archivedRows = archive.filter((a) => !liveKeys.has(rowKey(a)));
    const doneRows = [
      ...findings.filter((f) => absorbed.has(rowKey(f))),
      ...archivedRows,
    ];
    if (view === "done" && !doneRows.length) view = "queue";
    // Queue view = live feed, newest activity first. A settled row lingers
    // here for a beat (visible ✓), then flies into the 已处理 chip — the
    // absorbed ones are served by that tab instead of piling up in the feed.
    const ordered = (
      view === "done"
        ? doneRows
        : findings.filter((f) => {
            const k = rowKey(f);
            return !absorbed.has(k) && !absorbing.has(k);
          })
    ).sort(byActivity);
    card.innerHTML = `
      <div class="hd">${icon("shield-alert", "var(--brand)", 16)}
        <span>${
          findings.length
            ? selectableCount || s.running
              ? `本页发现 ${findings.length} 个可疑账号`
              : `本页已处理 ${s.done} 个账号`
            : `近期已处理 ${doneRows.length} 个账号`
        }</span>
        <span class="x" data-x>${icon("x", "currentColor", 14)}</span></div>
      ${autoRowMarkup()}
      <div class="sub">
        <span class="metric" title="本页命中的可疑账号">
          <i style="background:var(--danger)"></i><b>${s.found}</b><em>命中</em>
        </span>
        <span class="metric" title="正在处理">
          <i style="background:var(--warn)"></i><b>${s.processing}</b><em>正在</em>
        </span>
        <span class="metric" title="等待处理">
          <i style="background:var(--muted)"></i><b>${waiting}</b><em>待处理</em>
        </span>
        <span class="metric${doneRows.length ? " tab" : ""}${view === "done" ? " on" : ""}"
          data-done-chip ${doneRows.length ? `data-tab-done role="button" tabindex="0" aria-pressed="${view === "done"}"` : ""}
          title="${s.failed ? `失败 ${s.failed}，` : ""}近期已处理（含之前页面与历史记录）${doneRows.length ? " · 点击查看明细" : ""}">
          <i style="background:${s.failed ? "var(--warn)" : "var(--danger)"}"></i><b>${doneRows.length}</b><em>已处理</em>
        </span>
      </div>
      ${batchTouched ? renderProgress(s) : ""}
      <div class="queue-table">
        ${ordered.length ? "" : `<div class="queue-empty">${icon("shield-check", "var(--safe)", 13)}<span>本页暂无新命中 · 点「已处理」查看记录</span></div>`}
        ${ordered
          .map((f) => {
            const m = LABEL[f.verdict.label];
            const col = `var(${m.varName})`;
            const avUrl = safeAvatarUrl(f.avatarUrl);
            const av = avUrl
              ? `<img src="${esc(avUrl)}" class="qavatar" alt="">`
              : `<span class="qavatar blank"></span>`;
            const name = esc(f.displayName?.trim() || `@${f.handle}`);
            const snip = f.snippet
              ? esc(f.snippet.replace(/\s+/g, " ").trim()).slice(0, 60)
              : "";
            const id = rowKey(f);
            const isNew = !seenRows.has(id);
            seenRows.add(id);
            const st = stateOf(f);
            const justDone = st === "done" && !doneSeen.has(id);
            if (st === "done") doneSeen.add(id);
            const rowCls = [
              "qrow",
              isNew ? "new" : "",
              st === "processing" ? "active" : st === "pending" ? "" : st,
              justDone ? "flip" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const isAuto = autoRows.has(id);
            const canPick = selectable(f);
            const checked = canPick && !deselected.has(id);
            const actClass =
              st === "done"
                ? "xss-act done"
                : st === "processing"
                  ? "xss-act queue busy"
                  : st === "queued"
                    ? "xss-act queue"
                    : st === "failed"
                      ? "xss-act retry"
                      : "xss-act";
            // Auto rows: the button is a pure status chip, never an action.
            const actText = isAuto
              ? st === "done"
                ? "已处理"
                : st === "failed"
                  ? "失败"
                  : st === "queued"
                    ? "排队中"
                    : "处理中"
              : st === "done"
                ? `已${verb}`
                : st === "processing"
                  ? `${verb}中`
                  : st === "queued"
                    ? "待处理"
                    : st === "failed"
                      ? "重试"
                      : verb;
            const actDisabled =
              isAuto || st === "done" || st === "processing" || st === "queued";
            return `<div class="${rowCls}" data-rk="${esc(id)}">
              <input type="checkbox" class="xss-row-cb" data-sel="${esc(id)}"
                aria-label="选中 @${esc(f.handle)}"
                ${checked ? "checked" : ""} ${canPick ? "" : "disabled"}>
              ${av}
              <div class="qbody">
                <div class="qname">${name}</div>
                <div class="qmeta" style="color:${col}">@${esc(f.handle)} · ${m.zh} ${(f.verdict.confidence * 100).toFixed(0)}%<a class="qappeal" data-appeal-h="${esc(f.handle)}"${f.userId ? ` data-appeal-u="${esc(f.userId)}"` : ""} title="误判？提交申诉（已预填账号信息）">误判</a></div>
                ${(() => {
                  // 命中原因 chips — small tags kept apart from the content
                  // line: source (公榜 / 规则 / 缓存) + category, plus a
                  // 需手动 hint for rule hits outside the auto scope. The chip
                  // says 规则, never which one: the spammer sees this row too.
                  const tags: string[] = [];
                  if (f.source === "local-index") {
                    tags.push(`<span class="qtag">公榜</span>`);
                    if (f.tier)
                      tags.push(
                        `<span class="qtag">${f.tier === "confirmed" ? "人工确认" : "自动收录"}</span>`,
                      );
                  } else if (f.source === "local-rule") tags.push(`<span class="qtag">规则</span>`);
                  else if (f.source === "cache") tags.push(`<span class="qtag">缓存</span>`);
                  if (f.categoryZh) tags.push(`<span class="qtag">${esc(f.categoryZh)}</span>`);
                  if (f.source === "local-rule" && !isAuto)
                    tags.push(`<span class="qtag warn">需手动</span>`);
                  return tags.length
                    ? `<div class="qtags" title="${esc(f.verdict.reasons.join("\n"))}">${tags.join("")}</div>`
                    : "";
                })()}
                ${snip ? `<div class="qsnip">${snip}</div>` : ""}
                ${st === "processing" ? `<div class="qnote" style="color:var(--danger)">${isAuto ? `自动${autoVerbs.get(id) ?? "处理"}中…` : `正在${verb}…`}</div>` : ""}
                ${st === "queued" ? `<div class="qnote" style="color:var(--brand)">排队等待处理</div>` : ""}
                ${st === "failed" ? `<div class="qnote" style="color:var(--warn)">${isAuto ? `自动${autoVerbs.get(id) ?? "处理"}失败` : "处理失败"} · <a href="https://x.com/${esc(f.handle)}" target="_blank" rel="noopener" style="color:var(--warn)">手动处理</a></div>` : ""}
                ${st === "done" ? `<div class="qnote" style="color:var(--danger)">✓ 已${isAuto ? `自动${autoVerbs.get(id) ?? "处理"}` : verb}</div>` : ""}
              </div>
              <button class="${actClass}" data-one="${esc(id)}"${actDisabled ? " disabled" : ""}>${actText}</button>
            </div>`;
          })
          .join("")}
      </div>
      ${
        !findings.length
          ? ""
          : s.running > 0
            ? `<button class="btn" disabled style="background:var(--brand)">${verb}中 · 正在 ${s.processing} · 待 ${s.queued}</button>`
            : selectableCount === 0
              ? `<button class="btn" disabled style="background:color-mix(in srgb, var(--danger) 12%, transparent);color:var(--danger);opacity:1">✓ 已全部处理 (${s.done})</button>`
              : selectedPending === 0
                ? `<button class="btn" disabled style="opacity:.55">未选中任何账号 (剩余 ${selectableCount})</button>`
                : `<button class="btn" data-run>一键${verb}选中 ${selectedPending}${s.done ? ` · 已完成 ${s.done}` : ""}${selectedPending < selectableCount ? ` · 跳过 ${selectableCount - selectedPending}` : ""}</button>`
      }
      <div class="row"><span class="lnk" data-each>逐个查看处理</span>
        <span class="lnk" data-ign>忽略本页</span></div>`;
    bindAutoRow();
    card.querySelector("[data-x]")?.addEventListener("click", collapseByUser);
    card.querySelector("[data-ign]")?.addEventListener("click", () => {
      h.onDismiss();
      root.remove();
    });
    card.querySelector("[data-each]")?.addEventListener("click", h.onReviewEach);
    for (const a of card.querySelectorAll<HTMLElement>("[data-appeal-h]")) {
      a.addEventListener("click", () => {
        const handle = a.dataset.appealH;
        if (!handle) return;
        const userId = a.dataset.appealU;
        h.onAppeal({ handle, ...(userId ? { userId } : {}) });
      });
    }
    const doneTab = card.querySelector<HTMLElement>("[data-tab-done]");
    const toggleDone = () => {
      view = view === "done" ? "queue" : "done";
      renderCard();
    };
    doneTab?.addEventListener("click", toggleDone);
    doneTab?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleDone();
      }
    });
    // Per-row select toggle — uncheck excludes from the bulk action so the
    // user can opt-out specific accounts before "一键处理".
    card.querySelectorAll<HTMLInputElement>("[data-sel]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.sel;
        if (!id) return;
        if (cb.checked) deselected.delete(id);
        else deselected.add(id);
        renderCard(); // re-render so the bulk button count updates immediately
      });
    });
    card.querySelectorAll<HTMLElement>("[data-one]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.one;
        const f = findings.find((x) => rowKey(x) === id);
        if (f && selectable(f)) startBatch([rowKey(f)]);
      });
    });
    // Newest rows render at the top, which is exactly where a rebuilt table
    // rests (scrollTop 0) — so following the action needs no scrolling at
    // all. Only restore the position when the user had scrolled down into
    // history, so re-renders don't yank them back up.
    const table = card.querySelector<HTMLElement>(".queue-table");
    if (table && view === "queue") {
      if (queueScrollTop > 0) table.scrollTop = queueScrollTop;
      table.addEventListener(
        "scroll",
        () => {
          queueScrollTop = table.scrollTop;
        },
        { passive: true },
      );
    }
    const b = card.querySelector<HTMLButtonElement>("[data-run]");
    b?.addEventListener("click", () => {
      b.disabled = true;
      b.textContent = "处理中…";
      // Bulk only processes the SELECTED, untouched findings.
      const keys = findings
        .filter((f) => selectable(f) && !deselected.has(rowKey(f)))
        .map(rowKey);
      startBatch(keys);
    });
  }

  /** A row settled: let it linger visibly, then absorb it into the chip. */
  function scheduleAbsorb(key: string) {
    if (absorbed.has(key) || absorbTimers.has(key)) return;
    absorbTimers.set(
      key,
      setTimeout(() => {
        absorbTimers.delete(key);
        absorb(key);
      }, DONE_LINGER_MS),
    );
  }

  /** Absorb entry point (linger timer fired): queue a SOLO flight. */
  function absorb(key: string) {
    if (absorbed.has(key) || absorbing.has(key) || flights.includes(key)) return;
    flights.push(key);
    void runFlights();
  }

  /** One solo flight at a time: glide into the chip → +1 → short beat →
   *  next. Keeps a trickle of settles readable. */
  async function runFlights() {
    if (flying) return;
    flying = true;
    try {
      while (flights.length) {
        const key = flights.shift();
        if (!key) break;
        await flyKeys([key]);
        await new Promise((r) => setTimeout(r, 160));
      }
    } finally {
      flying = false;
    }
  }

  /** Fly settled rows into the 已处理 chip — geometry measured NOW, at
   *  takeoff, so positions are always current. keys.length === 1 is the auto
   *  path's solo glide; more = a manual batch flying as one flock (small
   *  per-ghost stagger, ONE chip pop with a +N floater at the end). Rows
   *  scrolled out of the list viewport skip the theater and just land —
   *  a ghost taking off from outside the card reads as a glitch. */
  function flyKeys(rawKeys: string[]): Promise<void> {
    const keys = rawKeys.filter((k) => !absorbed.has(k) && !absorbing.has(k));
    if (!keys.length) return Promise.resolve();
    for (const k of keys) absorbing.add(k); // renders exclude them from here on
    const landAll = () => {
      for (const k of keys) {
        absorbing.delete(k);
        absorbed.add(k);
      }
      if (open) renderCard();
    };
    const chip = card.querySelector<HTMLElement>("[data-done-chip]");
    const table = card.querySelector<HTMLElement>(".queue-table");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!open || view !== "queue" || !chip || !table || reduced) {
      landAll(); // bookkeeping only — the card isn't showing the queue
      return Promise.resolve();
    }
    const r1 = chip.getBoundingClientRect();
    const tb = table.getBoundingClientRect();
    if (!r1.width) {
      landAll();
      return Promise.resolve();
    }
    const jobs: Promise<void>[] = [];
    let slot = 0;
    for (const key of keys) {
      const row = card.querySelector<HTMLElement>(`[data-rk="${CSS.escape(key)}"]`);
      const r0 = row?.getBoundingClientRect();
      const visible =
        !!row && !!r0?.width && r0.bottom > tb.top + 4 && r0.top < tb.bottom - 4;
      if (!row || !r0 || !visible) continue; // lands with the group, no ghost
      // Ghost lives on the bubble root: the queue-table clips overflow, so
      // the real row could never fly past the card edge.
      const ghost = row.cloneNode(true) as HTMLElement;
      ghost.className = "q-fly";
      ghost.style.left = `${r0.left}px`;
      ghost.style.top = `${r0.top}px`;
      ghost.style.width = `${r0.width}px`;
      // The real row folds shut as its ghost lifts off, closing the gap
      // smoothly; if a re-render kills the element the gap closes instantly
      // (the key is already excluded — it can't come back either way).
      row.style.overflow = "hidden";
      row.animate(
        [
          { height: `${r0.height}px`, opacity: 1 },
          { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" },
        ],
        { duration: 380, easing: "ease-in", fill: "forwards" },
      );
      const dx = r1.left + r1.width / 2 - (r0.left + r0.width / 2);
      const dy = r1.top + r1.height / 2 - (r0.top + r0.height / 2);
      const delay = slot++ * 70; // flock: staggered takeoff, same destination
      root.appendChild(ghost);
      jobs.push(
        new Promise((res) => {
          ghost.animate(
            [
              { transform: "translate(0,0) scale(1)", opacity: 1 },
              { transform: `translate(${dx}px,${dy}px) scale(.06)`, opacity: 0.25 },
            ],
            {
              duration: 520,
              delay,
              easing: "cubic-bezier(.55,-.05,.75,.35)",
              fill: "both",
            },
          ).onfinish = () => {
            ghost.remove();
            res();
          };
        }),
      );
    }
    const finish = () => {
      landAll();
      // Land: counter pops once and floats a +N (+1 for solo flights).
      const c = card.querySelector<HTMLElement>("[data-done-chip]");
      if (!c) return;
      c.classList.remove("tick");
      void c.offsetWidth; // restart the pop for rapid consecutive landings
      c.classList.add("tick");
      const plus = document.createElement("span");
      plus.className = "m-plus";
      plus.textContent = `+${keys.length}`;
      c.appendChild(plus);
      setTimeout(() => plus.remove(), 850);
    };
    if (!jobs.length) {
      // Nothing visible to animate — land instantly, still pop the counter.
      finish();
      return Promise.resolve();
    }
    return Promise.all(jobs).then(finish);
  }

  /** Kick off a batch: mark rows, then hand the keys to the caller. The
   *  caller processes them sequentially and reports back per key; each
   *  report advances chips, progress bar and row states in place. */
  function startBatch(keys: string[]) {
    if (!keys.length) return;
    // The user just acted on the card: a fold-back armed by an EARLIER auto
    // batch must not yank it away mid-run — manual engagement makes the
    // open sticky (until the user closes it themselves).
    autoOpened = false;
    clearTimeout(collapseTimer);
    // Reverse-bump so keys[0] (processed first) lands highest in the feed.
    for (const k of [...keys].reverse()) bump(k);
    keys.forEach((k, i) => {
      rowState.set(k, i === 0 ? "processing" : "queued");
      deselected.delete(k);
    });
    renderPill();
    if (open) renderCard();
    // Manual batch: rows do NOT absorb one by one — the whole batch lingers
    // with its ✓s visible, then flies into the chip as one flock (+N pop).
    const batchDone: string[] = [];
    let reported = 0;
    h.onProcess(keys, (key, ok) => {
      rowState.set(key, ok ? "done" : "failed");
      bump(key);
      if (ok) batchDone.push(key);
      reported++;
      if (reported >= keys.length && batchDone.length) {
        setTimeout(() => void flyKeys([...batchDone]), BATCH_LINGER_MS);
      }
      // Sequential batch: promote the next queued row to "processing".
      const next = keys.find((k) => rowState.get(k) === "queued");
      if (next) {
        rowState.set(next, "processing");
        bump(next); // the in-flight row leads the feed
      }
      renderPill();
      if (open) renderCard();
    });
  }

  function expand() {
    open = true;
    // Opening onto an empty live queue when history exists (e.g. right after
    // navigating off the page that had the hits) would show a blank panel —
    // land on the 已处理 record instead so the user finds what they processed.
    if (!findings.length && archive.length) view = "done";
    card.classList.remove("closing");
    card.classList.add("open");
    renderCard();
  }
  function collapse() {
    const wasOpen = open;
    open = false;
    card.classList.remove("open");
    // Fold back toward the pill instead of vanishing (cardout keyframes);
    // animationend clears the class → display:none. Reduced-motion CSS
    // hides .closing instantly, so a missing animationend can't strand it.
    if (wasOpen) card.classList.add("closing");
  }
  card.addEventListener("animationend", (e) => {
    if ((e as AnimationEvent).animationName === "cardout")
      card.classList.remove("closing");
  });
  // Auto-show while the extension works: the card pops open when the AUTO
  // path starts acting, stays for the whole batch, then folds back a few
  // seconds after the last row settles — the user sees the product working
  // without ever clicking. A manual close wins: no more auto-opens on this
  // page (reset on SPA navigation).
  let autoOpened = false;
  let userClosed = false;
  let autoExpand = opts.autoExpand !== false;
  let collapseTimer: ReturnType<typeof setTimeout> | undefined;
  function collapseByUser() {
    userClosed = true;
    autoOpened = false;
    clearTimeout(collapseTimer);
    collapse();
  }
  function scheduleAutoCollapse() {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      if (autoOpened && open && stats().running === 0) {
        autoOpened = false;
        collapse();
      }
    }, 6000);
  }
  // Hovering the card = the user is reading; hold it open. Leaving with the
  // batch settled re-arms the fold-back.
  card.addEventListener("pointerenter", () => clearTimeout(collapseTimer));
  card.addEventListener("pointerleave", () => {
    if (autoOpened && open && stats().running === 0) scheduleAutoCollapse();
  });
  pill.addEventListener("click", () => {
    if (open) {
      collapseByUser();
    } else {
      // Manual open: sticky — never auto-folded.
      userClosed = false;
      autoOpened = false;
      clearTimeout(collapseTimer);
      expand();
    }
  });
  root.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") collapseByUser();
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
      // content.ts restarts its findings array on SPA navigation, so this
      // replace is wholesale — but rows the auto queue owns must survive it:
      // the paced X-action drain keeps running across navigations, and rows
      // it finished on a PREVIOUS page (done/failed, absorbed, not yet
      // archived) are only reachable through `findings` until the next
      // pageReset() archives them. Untouched (pending) rows still die with
      // their page as before.
      const incoming = new Set(f.map(rowKey));
      const held = findings.filter((x) => {
        const k = rowKey(x);
        return !incoming.has(k) && autoRows.has(k) && !archivedKeys.has(k) && rowState.has(k);
      });
      const merged = [...f, ...held];
      const grew = merged.length > findings.length;
      if (grew) view = "queue"; // new hits pull focus back to the live queue
      // Newly discovered rows enter the feed at the top.
      for (const x of merged) {
        const k = rowKey(x);
        if (!activitySeq.has(k)) bump(k);
      }
      findings = merged;
      // Prune state for rows that left the page — but keep everything the
      // session archive still renders (its rows read rowState/autoRows too).
      const live = new Set([...merged.map(rowKey), ...archivedKeys]);
      for (const k of [...rowState.keys()]) if (!live.has(k)) rowState.delete(k);
      for (const k of [...deselected]) if (!live.has(k)) deselected.delete(k);
      for (const k of [...seenRows]) if (!live.has(k)) seenRows.delete(k);
      for (const k of [...doneSeen]) if (!live.has(k)) doneSeen.delete(k);
      for (const k of [...autoRows]) if (!live.has(k)) autoRows.delete(k);
      for (const k of [...autoVerbs.keys()]) if (!live.has(k)) autoVerbs.delete(k);
      for (const k of [...activitySeq.keys()]) if (!live.has(k)) activitySeq.delete(k);
      for (const k of [...absorbed]) if (!live.has(k)) absorbed.delete(k);
      for (const k of [...absorbing]) if (!live.has(k)) absorbing.delete(k);
      for (const [k, t] of [...absorbTimers]) {
        if (!live.has(k)) {
          clearTimeout(t);
          absorbTimers.delete(k);
        }
      }
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
    /** SPA navigation: move this page's SETTLED rows into the session
     *  archive (viewable via the 已处理 tab until a hard reload) and drop
     *  the untouched ones with the page. Rows the auto queue still owns
     *  (queued/processing) are CARRIED OVER instead: the paced X-action
     *  drain in content.ts survives SPA navigation and keeps firing, so
     *  dropping its rows here made every surface read 已处理 while blocks
     *  were still pending — the card only folds once nothing is running. */
    pageReset() {
      const carriedKeys = new Set<string>();
      const carried: Finding[] = [];
      for (const f of findings) {
        const k = rowKey(f);
        const st = rowState.get(k);
        if ((st === "done" || st === "failed") && !archivedKeys.has(k)) {
          archivedKeys.add(k);
          archive.push(f);
        } else if (autoRows.has(k) && (st === "queued" || st === "processing")) {
          carriedKeys.add(k);
          carried.push(f);
        }
      }
      findings = carried;
      const keep = (k: string) => archivedKeys.has(k) || carriedKeys.has(k);
      for (const k of [...rowState.keys()]) if (!keep(k)) rowState.delete(k);
      for (const k of [...autoRows]) if (!keep(k)) autoRows.delete(k);
      for (const k of [...autoVerbs.keys()]) if (!keep(k)) autoVerbs.delete(k);
      for (const k of [...seenRows]) if (!keep(k)) seenRows.delete(k);
      for (const k of [...doneSeen]) if (!keep(k)) doneSeen.delete(k);
      for (const k of [...activitySeq.keys()]) if (!keep(k)) activitySeq.delete(k);
      deselected.clear();
      view = "queue";
      queueScrollTop = 0;
      // Archived rows are served by the 已处理 tab directly — pending
      // absorb theater dies with the page. (Carried rows are pre-absorb
      // by definition: queued/processing only.)
      for (const t of absorbTimers.values()) clearTimeout(t);
      absorbTimers.clear();
      absorbed.clear();
      absorbing.clear();
      flights.length = 0; // ghosts self-remove on animation finish
      // New page = a fresh conversation: auto-open is allowed again even if
      // the user dismissed the card on the previous page.
      userClosed = false;
      if (open && carried.length) {
        // Mid-batch navigation with the card up: the live queue it shows is
        // still true — folding it was the "看起来处理完了" lie. Keep it open
        // (autoOpened survives, so it still folds once the batch settles).
        clearTimeout(collapseTimer);
        renderCard();
      } else {
        autoOpened = false;
        clearTimeout(collapseTimer);
        collapse();
      }
      renderPill();
    },
    /** AUTO path: content.ts pushed the finding, then drives its row state
     *  here as the X action progresses. Marks the row as auto-driven —
     *  checkbox disabled, per-row button becomes a status chip. Chips,
     *  progress bar and the radar pill all re-derive from rowState. */
    markAuto(
      key: string,
      st: "queued" | "processing" | "done" | "failed",
      verbLabel?: string,
    ) {
      autoRows.add(key);
      if (verbLabel) autoVerbs.set(key, verbLabel);
      rowState.set(key, st);
      bump(key); // every auto transition leads the feed
      clearTimeout(collapseTimer); // fresh activity holds the card open
      if ((st === "queued" || st === "processing") && autoExpand && !open && !userClosed) {
        // Show the work as it happens — pop the card open the moment the
        // auto queue starts building; it folds back once the batch settles.
        autoOpened = true;
        open = true;
        card.classList.add("open");
      }
      renderPill();
      if (open) renderCard();
      if (st === "done") scheduleAbsorb(key); // linger, then fly into the chip
      if (autoOpened && open && stats().running === 0) scheduleAutoCollapse();
    },
    /** Manual popover hide of a listed account: drive the live bubble row to
     *  "done" so it stops showing an actionable 隐藏 button (the tweet is
     *  already gone) and joins the 已处理 record — matching the auto path.
     *  No-op if the account isn't a current finding (e.g. a ghost hide). */
    markManual(key: string, verbLabel: string) {
      if (!findings.some((f) => rowKey(f) === key)) return;
      autoVerbs.set(key, verbLabel);
      rowState.set(key, "done");
      autoRows.add(key);
      bump(key);
      renderPill();
      if (open) renderCard();
      scheduleAbsorb(key);
    },
    /** Sync the header switch when settings change elsewhere (options page
     *  or another tab). Optionally refresh the category-count/scope hint. */
    setAutoProcess(v: boolean, categoryCount?: number, scopeAll?: boolean) {
      autoOn = v;
      if (categoryCount !== undefined) autoCats = categoryCount;
      if (scopeAll !== undefined) autoScopeAll = scopeAll;
      if (open) renderCard();
    },
    /** settings.actionMode changed: every rendered 隐藏/静音/拉黑 label must
     *  follow, or the batch button would state one action and run another. */
    setVerb(v: string) {
      verb = v;
      renderPill();
      if (open) renderCard();
    },
    /** Live-sync settings.autoExpand (options page or another tab). Only
     *  affects future auto-opens; an already-open card is left alone. */
    setAutoExpand(v: boolean) {
      autoExpand = v;
    },
  };
}

/** v0.4-style in-place auto-processing badge for the tweet row: a pulsing
 *  solid "拉黑中" pill with a spinner while the queue works this account,
 *  or a quiet "待拉黑" outline while it waits its turn. */
export function createActingBadge(verb: string, queued = false): HTMLElement {
  const el = document.createElement("span");
  el.className = `xss-badge ${queued ? "actqueued" : "acting"}`;
  el.setAttribute("aria-label", queued ? `等待自动${verb}` : `自动${verb}中`);
  el.innerHTML = `<span class="xss-ico">${icon("shield-x", "currentColor", 12)}</span><span>${
    queued ? `待${esc(verb)}` : `${esc(verb)}中`
  }</span>`;
  return el;
}

/** In-place progress state while a locally unknown account is being checked
 * by the authenticated online classifier. */
export function createAnalyzingBadge(): HTMLElement {
  const el = document.createElement("span");
  el.className = "xss-badge analyzing";
  el.setAttribute("aria-label", "在线 AI 检测中");
  el.innerHTML = `<span class="xss-spin">${icon("shield", "currentColor", 12)}</span><span>检测中</span>`;
  return el;
}

export interface BadgeActions {
  /** Run one action against this account in the given mode. The popover
   *  exposes the full ladder (隐藏 / 静音 / 拉黑); the caller's configured
   *  actionMode is only the DEFAULT (rendered as the primary button), so a
   *  user on 本地隐藏 can still one-off 拉黑 without visiting options. */
  onAct: (mode: ActionMode) => void;
  onAppeal: () => void;
  /** Report this account to the public queue (GitHub-authed contribution).
   *  Only offered for accounts NOT already on the community list. Resolves to
   *  a short user-facing result the popover shows inline; the network call,
   *  GitHub-auth gating and abuse feedback all live in the caller. */
  onReport?: () => Promise<{ ok: boolean; message: string }>;
}

/** The manual action ladder shown in the popover, weakest → strongest.
 *  The configured mode is styled as primary; the rest are secondary chips. */
const ACTION_LADDER: { mode: ActionMode; verb: string }[] = [
  { mode: "local", verb: "隐藏" },
  { mode: "mute", verb: "静音" },
  { mode: "block", verb: "拉黑" },
];

/** Inline pill on the author row; hover/focus → popover with reasons. */
/** source: 'fresh' = just classified (rise-in); 'list'/'cache' = already on
 *  record → instant calm "known" marker, no processing implied. */
export type BadgeSource = "fresh" | "list" | "cache" | "rule";

// Popover overlay — a singleton shadow host attached directly under
// <html>. Popovers must NOT live inside the badge's own shadow root: X's
// virtualized timeline wraps rows in transformed containers, and a
// position:fixed element inside a transformed ancestor is positioned
// relative to that ancestor, not the viewport — which made popovers drift
// wildly. At the documentElement level there is no transformed ancestor.
let overlayShadow: ShadowRoot | null = null;
function overlay(): ShadowRoot {
  if (overlayShadow?.host.isConnected) return overlayShadow;
  const host = document.createElement("div");
  host.setAttribute("data-xss-overlay", "");
  host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483001;";
  document.documentElement.appendChild(host);
  overlayShadow = host.attachShadow({ mode: "open" });
  const st = document.createElement("style");
  st.textContent = STYLE;
  overlayShadow.appendChild(st);
  return overlayShadow;
}

export function createBadge(
  v: Verdict | null,
  a: BadgeActions,
  note?: string,
  source: BadgeSource = "fresh",
  mode: ActionMode = "local",
): HTMLElement {
  const el = document.createElement("span");
  el.tabIndex = 0;
  // v0.4 visual language: every spammy tier renders in full danger red — the
  // amber likely_spam pill read as washed-out next to v0.4's badges.
  const spammy = !!v && (v.label === "spam" || v.label === "porn_bot" || v.label === "likely_spam");
  const color = !v ? "var(--muted)" : spammy ? "var(--danger)" : `var(${LABEL[v.label].varName})`;
  if (!v) {
    // Unhit ghost — still INTERACTIVE: hover/focus opens the 手动处理
    // popover (v0.4 behavior the v0.5 rewrite dropped). "Not on the list"
    // is exactly when the user needs a manual handle on an obvious spammer.
    el.className = "xss-badge ghost";
    el.setAttribute("aria-label", "MXGA：未命中名单 · 悬停可手动处理");
    el.innerHTML = `${icon("shield", "currentColor", 13)}<span>检查</span>`;
  } else {
    const meta = LABEL[v.label];
    const known = source === "list" || source === "cache" || source === "rule";
    el.className = `xss-badge ${known ? "known" : "fresh"}`;
    // Tinted pill: bg/border derive from --badge-color via color-mix in STYLE.
    el.style.setProperty("--badge-color", color);
    const tip =
      source === "list"
        ? "命中公共名单"
        : source === "rule"
          ? "命中官方关键词规则（本机比对）"
          : source === "cache"
            ? "本地缓存命中"
            : "首次发现（本机首次判定，已记录待人工确认）";
    // No native title: the hover popover already carries the details, and the
    // OS tooltip floating next to it reads as visual noise.
    el.setAttribute("aria-label", `${meta.zh} ${(v.confidence * 100).toFixed(0)}% · ${tip}`);
    // Badge = icon + ONE short label word (色情/垃圾/疑似) on a solid pill —
    // the compact shape users recognize. Source (公榜/规则/缓存) plus
    // category/confidence/provenance all live in the hover popover.
    const tag = known ? "" : `<span class="ntag">首发</span>`;
    el.innerHTML = `${icon(meta.ic, "currentColor", 12)}<span>${BADGE_TEXT[v.label]}</span>${tag}`;
  }

  let pop: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  /** Unconditional teardown — bypasses the :hover keep-open rule. */
  const close = () => {
    clearTimeout(hideTimer);
    cancelAnimationFrame(raf);
    pop?.remove();
    pop = null;
    window.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  };
  const onScroll = () => {
    // A fixed popover detaches visually from its anchor the moment the page
    // scrolls — close it instead of letting it float over unrelated content.
    close();
  };
  const onOutsidePointerDown = (event: PointerEvent) => {
    if (!pop) return;
    const path = event.composedPath();
    if (path.includes(el) || path.includes(pop)) return;
    hide(true);
  };
  const hide = (force = false) => {
    if (!force && pop?.matches(":hover")) {
      // Cursor is on the popover (e.g. blur fired mid-click) — stay open.
      scheduleHide();
      return;
    }
    close();
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 120);
  };
  const cancelHide = () => clearTimeout(hideTimer);
  const show = () => {
    cancelHide();
    if (pop) return;
    pop = document.createElement("div");
    pop.className = "xss pop card";
    pop.style.display = "block";
    // Action ladder: 隐藏 / 静音 / 拉黑, the configured mode as primary
    // (data-b), the rest as secondary chips. A one-off 拉黑 is reachable
    // here even for a 本地隐藏 user — the block/mute fetch is same-origin
    // (this script already runs on x.com), so no fresh permission prompt.
    const ladder = ACTION_LADDER.map(
      (m) =>
        `<button data-act="${m.mode}"${m.mode === mode ? " data-b" : ""}>${esc(m.verb)}</button>`,
    ).join("");
    // 举报 = contribute an unlisted account to the public review queue. Only
    // offered for accounts NOT already on the community list/official rules
    // (reporting those is a no-op). GitHub-auth gating + abuse feedback are
    // the caller's job; the popover only shows the inline result.
    const canReport = !!a.onReport && source !== "list" && source !== "rule";
    const reportBtn = canReport
      ? `<button data-report title="举报给公共名单人工审核（需 GitHub 授权）">举报为spam</button>`
      : "";
    pop.innerHTML = v
      ? `
      <h4 style="color:${color}">${LABEL[v.label].zh} · ${(v.confidence * 100).toFixed(0)}%</h4>
      <ul>${v.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      ${note ? `<div style="color:var(--muted)">${esc(note)}</div>` : ""}
      <div class="acts">
        ${spammy ? ladder : ""}
        ${reportBtn}
        <button data-a title="打开 GitHub 提交误判申诉 issue（已预填账号信息）">误判申诉</button>
      </div>
      <div class="pop-status" data-report-status hidden></div>`
      : `
      <h4>手动处理</h4>
      <div style="color:var(--muted);line-height:1.55">
        未命中公共名单与官方规则。确认是垃圾/骚扰账号时，可手动处理（5 秒内可撤销），或举报给公共名单。</div>
      <div class="acts">${ladder}${reportBtn}</div>
      <div class="pop-status" data-report-status hidden></div>`;
    for (const b of pop.querySelectorAll<HTMLElement>("[data-act]"))
      b.addEventListener("click", () => a.onAct(b.dataset.act as ActionMode));
    pop.querySelector("[data-a]")?.addEventListener("click", a.onAppeal);
    // 举报: stays open to show the inline result, so it is NOT wired to close.
    const reportEl = pop.querySelector<HTMLButtonElement>("[data-report]");
    if (reportEl && a.onReport) {
      const onReport = a.onReport;
      reportEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        cancelHide();
        const statusEl = pop?.querySelector<HTMLElement>("[data-report-status]");
        reportEl.disabled = true;
        reportEl.textContent = "举报中…";
        setPopStatus(statusEl, "正在提交举报…", "info");
        let res: { ok: boolean; message: string };
        try {
          res = await onReport();
        } catch {
          res = { ok: false, message: "举报失败，请稍后重试" };
        }
        if (!pop) return; // popover closed while the request was in flight
        setPopStatus(statusEl, res.message, res.ok ? "ok" : "err");
        reportEl.textContent = res.ok ? "已举报" : "举报为spam";
        reportEl.disabled = res.ok;
        // Let the result read, then fold.
        clearTimeout(hideTimer);
        hideTimer = setTimeout(close, res.ok ? 2600 : 3600);
      });
    }
    // Any OTHER action click ends the popover's job: the flow continues in the
    // inline ⏳撤销 pending badge (or a new tab, for 误判). Leaving it open
    // strands a fixed panel over whatever row slides in after the layout
    // shifts. Registered AFTER the action handlers so those run first.
    for (const b of pop.querySelectorAll("button:not([data-report])"))
      b.addEventListener("click", close);
    // Keep the popover open while the cursor is over it, so its buttons are
    // actually reachable.
    pop.addEventListener("mouseenter", cancelHide);
    pop.addEventListener("mouseleave", scheduleHide);
    // Mount in the top-level overlay (viewport-true fixed positioning),
    // then measure and place: clamp to the viewport's right edge, flip
    // above the badge when there is no room below.
    overlay().appendChild(pop);
    const place = (r: DOMRect) => {
      if (!pop) return;
      const W = pop.offsetWidth || 260;
      const H = pop.offsetHeight || 120;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8);
      const below = r.bottom + 6;
      const top = below + H > window.innerHeight - 8 ? Math.max(8, r.top - H - 6) : below;
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    };
    place(el.getBoundingClientRect());
    // The page reflows under an open popover without any scroll event —
    // the auto queue collapses a tweet above, a pending badge changes the
    // row's width, X re-virtualizes cells. Track the badge every frame
    // while open: follow it through layout shifts, and die with it the
    // moment it leaves the DOM (action clicked → badge replaced) or its
    // container is hidden. Runs only while a popover exists.
    const track = () => {
      if (!pop) return;
      const r = el.getBoundingClientRect();
      if (!el.isConnected || (!r.width && !r.height)) {
        close();
        return;
      }
      place(r);
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
  };
  let touchInteraction = false;
  el.addEventListener("pointerdown", (event) => {
    touchInteraction = event.pointerType !== "mouse";
  });
  el.addEventListener("click", (event) => {
    if (!touchInteraction) return;
    event.preventDefault();
    event.stopPropagation();
    if (pop) hide(true);
    else show();
    touchInteraction = false;
  });
  el.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") show();
  });
  el.addEventListener("focus", () => {
    if (!touchInteraction) show();
  });
  el.addEventListener("mouseleave", scheduleHide);
  el.addEventListener("blur", scheduleHide);
  return el;
}
