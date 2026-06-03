// Design system + components, all rendered inside a Shadow DOM so X's CSS
// cannot bleed in and ours cannot leak out. Vanilla DOM — no framework
// weight injected into the page. Tokens per docs/UX.md.
import { BRAND } from "./brand";
import type { Label, Verdict } from "./types";

export const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui,-apple-system,"Segoe UI",sans-serif; }
:root, .xss {
  /* dark default (X dark mode) */
  --surface: rgba(13,17,23,.92); --border: rgba(255,255,255,.10);
  --shadow: 0 8px 28px rgba(0,0,0,.45); --text: #E6EDF3; --muted: #8B949E;
  --brand: #0EA5E9; --danger: #EF4444; --warn: #F59E0B; --neutral: #8B949E;
  --safe: #16A34A;
}
@media (prefers-color-scheme: light) {
  :root, .xss {
    --surface: rgba(255,255,255,.96); --border: rgba(15,23,42,.12);
    --shadow: 0 8px 28px rgba(15,23,42,.18); --text: #0F172A; --muted: #475569;
    --brand: #0369A1; --danger: #DC2626; --warn: #B45309; --neutral: #475569;
    --safe: #15803D;
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
  display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-radius: 999px; cursor: pointer; transition: opacity .14s ease;
}
.pill:hover { opacity: .92; }
.pill .n {
  font-size: 12px; font-weight: 700; min-width: 16px; text-align: center;
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
.row { display: flex; gap: 14px; margin-top: 10px; font-size: 12px; }
.lnk { color: var(--muted); cursor: pointer; }
.lnk:hover { color: var(--text); }
svg { display: block; }
.xss-badge {
  display: inline-flex; align-items: center; gap: 5px; margin-left: 6px;
  padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
  vertical-align: middle; cursor: default; color: var(--text);
  border: 1px solid var(--border);
}
.xss-badge.ghost { color: var(--muted); cursor: pointer; }
.xss-badge.ghost:hover { color: var(--text); }
.pop {
  position: fixed; z-index: 2147482001; width: 260px; padding: 12px;
  font-size: 12px; color: var(--text);
}
.pop h4 { margin: 0 0 6px; font-size: 12px; font-weight: 700; }
.pop ul { margin: 6px 0; padding-left: 16px; color: var(--muted); }
.pop li { margin: 3px 0; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.acts button {
  border: 1px solid var(--border); background: transparent; color: var(--text);
  border-radius: 8px; padding: 4px 9px; font-size: 11px; cursor: pointer;
}
.acts button:hover { background: rgba(255,255,255,.06); }

/* ---- animated badge states (transform/opacity only) ---- */
.xss-badge.fresh { animation: xrise .22s ease-out; }
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
.xss-badge.analyzing {
  color: var(--muted); position: relative; overflow: hidden;
}
.xss-badge.analyzing::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent);
  transform: translateX(-100%); animation: xshim 1.1s ease-in-out infinite;
}
.xss-spin { animation: xspin .8s linear infinite; transform-origin: 50% 50%; }
.xss-badge.pending {
  color: var(--muted); cursor: default;
  animation: xpulse 1.6s ease-in-out infinite;
}
@keyframes xrise { from { opacity: 0; transform: translateY(4px); } }
@keyframes xpop  { from { opacity: 0; transform: scale(.9); } }
@keyframes xspin { to { transform: rotate(360deg); } }
@keyframes xshim { to { transform: translateX(100%); } }
@keyframes xpulse { 0%,100% { opacity: .55; } 50% { opacity: .95; } }

/* refined attention flash when a NEW spam account is found */
.pill.flash { animation: xflash 1s ease-out 2; }
@keyframes xflash {
  0% { box-shadow: var(--shadow); transform: scale(1); }
  18% { box-shadow: 0 0 0 4px rgba(239,68,68,.35), var(--shadow); transform: scale(1.06); }
  60% { box-shadow: 0 0 0 0 rgba(239,68,68,0), var(--shadow); transform: scale(1); }
  100% { box-shadow: var(--shadow); transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .card.open { animation: fade .18s ease-out; }
  @keyframes fade { from { opacity: 0; } }
  .xss-badge.fresh, .xss-badge.known { animation: fade .18s ease-out; }
  .xss-badge.analyzing::after, .xss-spin { animation: none; }
  .xss-badge.pending { animation: none; opacity: .7; }
  .pill.flash { animation: none; }
}
`;

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
  verdict: Verdict;
}

export interface BubbleHandlers {
  onHideAll: (keys: string[]) => void;
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
  pill.setAttribute("aria-label", "x-spam-sentinel 本页可疑账号");

  const card = document.createElement("div");
  card.className = "card";

  root.append(pill, card);
  let open = false;
  let findings: Finding[] = [];
  let scanning = 0; // accounts currently being checked (visible progress)

  const sev = (f: Finding[]) =>
    f.some((x) => x.verdict.label === "spam" || x.verdict.label === "porn_bot")
      ? "--danger"
      : "--warn";

  function renderPill() {
    if (!findings.length && scanning > 0) {
      // Visible processing feedback (esp. reply sections).
      pill.innerHTML = `${icon("shield", "var(--brand)", 16)}<span class="n" style="font-weight:600;color:var(--muted)">检查中 ${scanning}…</span>`;
      return;
    }
    if (!findings.length) {
      // Calm "guarding" state — confirms the extension is working even
      // when nothing suspicious is on the page (no alarm color).
      pill.innerHTML = `${icon("shield-check", "var(--brand)", 16)}<span class="n" style="font-weight:600;color:var(--muted)">守护中</span>`;
      return;
    }
    const c = `var(${sev(findings)})`;
    pill.innerHTML = `${icon("shield-alert", c, 16)}<span class="n">${findings.length}</span>`;
  }

  function renderCard() {
    if (!findings.length) {
      card.innerHTML = `
        <div class="hd">${icon("shield-check", "var(--brand)", 16)}
          <span>x-spam-sentinel 已启用</span>
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
            const av = f.avatarUrl
              ? `<img src="${f.avatarUrl}" width="26" height="26" style="border-radius:50%;flex:none" alt="">`
              : `<span style="width:26px;height:26px;border-radius:50%;flex:none;background:var(--border)"></span>`;
            const esc = (s: string) =>
              s.replace(/[<>&"]/g, (c) =>
                ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
              );
            const name = esc(f.displayName?.trim() || `@${f.handle}`);
            const snip = f.snippet
              ? esc(f.snippet.replace(/\s+/g, " ").trim()).slice(0, 60)
              : "";
            const src = f.source
              ? `<div style="font-size:10px;color:var(--muted)">${esc(f.source)}</div>`
              : "";
            return `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 4px">
              ${av}
              <div style="min-width:0;flex:1">
                <div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
                <div style="font-size:11px;color:${col}">@${esc(f.handle)} · ${m.zh} ${(f.verdict.confidence * 100).toFixed(0)}%</div>
                ${snip ? `<div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${snip}</div>` : ""}
                ${src}
              </div>
              <button class="xss-act" data-hide="${f.userId || "h:" + f.handle}">隐藏</button>
            </div>`;
          })
          .join("")}
      </div>
      <button class="btn" data-hide-all>一键隐藏全部 (${findings.length})</button>
      <div class="row"><span class="lnk" data-each>逐个查看</span>
        <span class="lnk" data-ign>忽略本页</span></div>`;
    card.querySelector("[data-x]")?.addEventListener("click", collapse);
    card.querySelector("[data-ign]")?.addEventListener("click", () => {
      h.onDismiss();
      root.remove();
    });
    card.querySelector("[data-each]")?.addEventListener("click", h.onReviewEach);
    card.querySelectorAll<HTMLElement>("[data-hide]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.hide;
        if (id) {
          h.onHideAll([id]);
          btn.textContent = "已隐藏";
          (btn as HTMLButtonElement).disabled = true;
        }
      });
    });
    const b = card.querySelector<HTMLButtonElement>("[data-hide-all]");
    b?.addEventListener("click", () => {
      b.disabled = true;
      b.textContent = "处理中…";
      h.onHideAll(findings.map((f) => f.userId || `h:${f.handle}`));
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
        // refined double flash on a newly-found spam account
        pill.classList.remove("flash");
        void pill.offsetWidth; // restart the animation
        pill.classList.add("flash");
        setTimeout(() => pill.classList.remove("flash"), 2100);
      }
    },
    setScanning(n: number) {
      scanning = Math.max(0, n);
      if (!open) renderPill();
    },
  };
}

export interface BadgeActions {
  onHide: () => void;
  onAppeal: () => void;
}

/** Inline pill on the author row; hover/focus → popover with reasons. */
/** source: 'fresh' = just classified (rise-in); 'list'/'cache' = already on
 *  record → instant calm "known" marker, no processing implied. */
export type BadgeSource = "fresh" | "list" | "cache";

/** Animated transient states for newly-found accounts. */
export function createStatusBadge(kind: "analyzing" | "pending"): HTMLElement {
  const el = document.createElement("span");
  if (kind === "analyzing") {
    el.className = "xss-badge analyzing";
    el.innerHTML = `<span class="xss-spin">${icon("shield", "var(--brand)", 13)}</span><span>分析中…</span>`;
  } else {
    el.className = "xss-badge pending";
    el.innerHTML = `${icon("shield", "currentColor", 13)}<span>排队检测…</span>`;
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
  if (!v) {
    el.className = "xss-badge ghost";
    el.innerHTML = `${icon("shield", "currentColor", 13)}<span>检查</span>`;
    return el;
  }
  const meta = LABEL[v.label];
  const color = `var(${meta.varName})`;
  const known = source === "list" || source === "cache";
  el.className = `xss-badge ${known ? "known" : "fresh"}`;
  el.style.borderColor = color;
  const tip =
    source === "list"
      ? "命中公共名单"
      : source === "cache"
        ? "本地缓存命中"
        : "首次发现（本机首次判定，已记录待人工确认）";
  el.title = tip;
  // known → solid brand dot; fresh → hollow "first discovery" ring + 首发 tag
  const mark = known
    ? `<span class="kdot" title="${tip}"></span>`
    : `<span class="ndot" title="${tip}"></span>`;
  const tag = known ? "" : `<span class="ntag" title="${tip}">首发</span>`;
  el.innerHTML =
    `${mark}${icon(meta.ic, color, 13)}<span style="color:${color}">${meta.zh} ${(v.confidence * 100).toFixed(0)}%</span>${tag}`;

  let pop: HTMLElement | null = null;
  const show = () => {
    if (pop) return;
    pop = document.createElement("div");
    pop.className = "xss pop card";
    pop.style.display = "block";
    const spammy = ["spam", "porn_bot", "likely_spam"].includes(v.label);
    pop.innerHTML = `
      <h4 style="color:${color}">${meta.zh} · ${(v.confidence * 100).toFixed(0)}%</h4>
      <ul>${v.reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
      ${note ? `<div style="color:var(--muted)">${note}</div>` : ""}
      <div class="acts">
        ${spammy ? '<button data-h>隐藏</button>' : ""}
        <button data-a>误判?</button>
      </div>`;
    const r = el.getBoundingClientRect();
    pop.style.left = `${Math.max(8, r.left)}px`;
    pop.style.top = `${r.bottom + 6}px`;
    pop.querySelector("[data-h]")?.addEventListener("click", a.onHide);
    pop.querySelector("[data-a]")?.addEventListener("click", a.onAppeal);
    el.getRootNode().appendChild?.(pop);
  };
  const hide = () => {
    pop?.remove();
    pop = null;
  };
  el.addEventListener("mouseenter", show);
  el.addEventListener("focus", show);
  el.addEventListener("mouseleave", () => setTimeout(hide, 120));
  el.addEventListener("blur", hide);
  return el;
}
