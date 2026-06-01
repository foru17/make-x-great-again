import { useEffect, useState } from "react";
import { BRAND } from "../../lib/brand";
import { getSettings } from "../../lib/settings";
import type { BgResponse } from "../../lib/types";

function bg<T = Record<string, unknown>>(msg: unknown): Promise<BgResponse & { data?: T }> {
  return new Promise((r) =>
    chrome.runtime.sendMessage(msg, (resp) => r(resp ?? { ok: false })),
  );
}

interface LocalStats {
  scanned: number;
  hitPublic: number;
  blocked: number;
  firstUsedAt: number;
}

// 小蓝 mascot — same PNG that powers the toolbar icon; using the runtime
// URL helper so the popup picks up theme-correct + retina-correct rendering
// without bundling a duplicate asset.
const MASCOT_URL = chrome.runtime.getURL("icon/128.png");

function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}
function daysWith(ms: number): number {
  if (!ms) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      title={hint}
      className={`rounded-md border px-2 py-1.5 ${
        accent ? "border-ok/30 bg-ok-soft" : "border-border bg-card-hi"
      }`}
    >
      <div className={`text-[10px] font-medium ${accent ? "text-ok" : "text-fg-3"} tracking-tight`}>
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-[15px] font-semibold leading-none tabular-nums ${
          accent ? "text-ok" : "text-fg"
        }`}
      >
        {fmt(value)}
      </div>
    </div>
  );
}

// Onboarding banner — shown only when user isn't signed in AND hasn't
// explicitly dismissed it. Encourages GitHub login as the path to real-time
// AI scanning; without login the extension falls back to public-board hits
// only (lower coverage). Dismissal is persistent so the popup stops nagging.
const LOGIN_BANNER_KEY = "mxga_login_banner_dismissed_v1";
async function getBannerDismissed(): Promise<boolean> {
  return new Promise((r) =>
    chrome.storage.local.get(LOGIN_BANNER_KEY, (g) =>
      r(!!g?.[LOGIN_BANNER_KEY]),
    ),
  );
}
async function setBannerDismissed(): Promise<void> {
  return new Promise((r) =>
    chrome.storage.local.set({ [LOGIN_BANNER_KEY]: true }, () => r()),
  );
}

function LoginBanner({
  onLogin,
  onDismiss,
}: {
  onLogin: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-accent/30 bg-accent-soft p-3">
      <div className="flex items-start gap-2">
        <span className="mt-px text-accent" aria-hidden>
          {/* shield-lock icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" />
            <rect x="9" y="10" width="6" height="5" rx="1" />
            <path d="M10.5 10V8.5a1.5 1.5 0 0 1 3 0V10" />
          </svg>
        </span>
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold text-fg">解锁 AI 实时识别</div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-2">
            登录 GitHub 后，扩展会在你刷 X 时调用 AI 实时识别 spam / 水军，命中率比离线公榜匹配高得多。
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="不再提示"
          className="ml-1 cursor-pointer rounded p-1 text-fg-4 transition hover:bg-card-hi hover:text-fg"
          title="不再提示（继续仅用公榜）"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={onLogin}
          className="cursor-pointer rounded-md border border-fg bg-fg px-2 py-1.5 text-[12px] font-semibold text-bg transition hover:opacity-90 active:translate-y-px"
        >
          用 GitHub 登录
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="cursor-pointer rounded-md border border-border-2 px-2 py-1.5 text-[12px] text-fg-2 transition hover:bg-card-hi hover:text-fg"
        >
          仅用公榜
        </button>
      </div>

      <ul className="mt-2.5 space-y-0.5 text-[10.5px] leading-relaxed text-fg-3">
        <li>· 只读取你的 GitHub 数字 ID（防滥用计数）</li>
        <li>· 不读邮箱 · 不发推 · 不写任何数据</li>
        <li>· Device Flow 登录，扩展里不存任何 secret</li>
      </ul>
    </div>
  );
}

export function App() {
  const [status, setStatus] = useState<{ ok: boolean; n: number } | null>(null);
  const [stats, setStats] = useState<LocalStats | null>(null);
  const [whitelist, setWhitelist] = useState<{ count: number; lastSyncedAt: number } | null>(null);
  const [edgeBase, setEdgeBase] = useState<string>(BRAND.edgeBase);
  const [login, setLogin] = useState<string>("");
  const [bannerDismissed, setBannerDismissed_] = useState<boolean>(false);

  function dismissBanner() {
    void setBannerDismissed();
    setBannerDismissed_(true);
  }
  function startLogin() {
    // Device Flow needs the user to enter a code on github.com/login/device.
    // Popups close when the user switches tabs, which would lose the code,
    // so we hand off to the options page — it owns the full polling loop.
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html?tab=settings&login=1") });
    window.close();
  }

  useEffect(() => {
    bg<{ records: number }>({ type: "health" }).then((h) =>
      setStatus(h.ok && h.data ? { ok: true, n: h.data.records } : { ok: false, n: 0 }),
    );
    bg<LocalStats>({ type: "stats" }).then((r) => {
      if (r.ok && r.data) setStats(r.data);
    });
    bg<{ count: number; lastSyncedAt: number }>({ type: "whitelist_status" }).then((r) => {
      if (r.ok && r.data) setWhitelist(r.data);
    });
    bg<{ login: string }>({ type: "gh_status" }).then((r) => {
      if (r.ok && r.data) setLogin(r.data.login || "");
    });
    getBannerDismissed().then(setBannerDismissed_);
    getSettings().then((s) => {
      if (s.edgeBase) setEdgeBase(s.edgeBase);
    });
  }, []);

  const totalAssist = stats ? stats.scanned + stats.hitPublic + stats.blocked : 0;
  const days = stats ? daysWith(stats.firstUsedAt) : 0;
  const showBanner = !login && !bannerDismissed;

  return (
    <div className="p-4">
      <header className="flex items-center gap-2">
        <img
          src={MASCOT_URL}
          alt=""
          width={26}
          height={26}
          className="rounded-md"
          // Crisp at retina; keep the cute shadow flat against light popup bg.
        />
        <b className="text-[14px] font-semibold tracking-[-.005em]">{BRAND.acronym}</b>
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-4">{BRAND.name}</span>
        <span
          aria-label={status === null ? "检查中" : status.ok ? "服务在线" : "服务不可达"}
          className={`ml-auto inline-flex h-2 w-2 rounded-full ${
            status === null ? "bg-fg-4" : status.ok ? "bg-ok" : "bg-danger"
          }`}
        />
      </header>

      {showBanner ? (
        <LoginBanner onLogin={startLogin} onDismiss={dismissBanner} />
      ) : null}

      {/* Achievement hero — the line the user actually feels proud about. */}
      <div className="mt-3 rounded-md border border-border bg-card px-3 py-2.5">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-3">
          小蓝陪你
          <span className="mx-1 font-mono text-fg-2 tabular-nums">{fmt(days)}</span>
          天 · 一起干掉
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="font-mono text-[26px] font-bold leading-none tabular-nums tracking-tight text-fg">
            {fmt(totalAssist)}
          </span>
          <span className="text-[11.5px] text-fg-3">个垃圾号</span>
        </div>
      </div>

      {/* Per-stat breakdown */}
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <Stat label="AI 扫描" value={stats?.scanned ?? 0} hint="新账号 LLM 判定次数" />
        <Stat label="命中公榜" value={stats?.hitPublic ?? 0} hint="直接处理，零成本" accent />
        <Stat label="亲手处理" value={stats?.blocked ?? 0} hint="你按的账号处理按钮" />
      </div>

      {whitelist && whitelist.count > 0 ? (
        <div
          className="mt-2 flex items-center justify-between rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-fg-3"
          title={
            whitelist.lastSyncedAt
              ? `最近同步：${new Date(whitelist.lastSyncedAt).toLocaleString("zh-CN", { hour12: false })}`
              : "尚未同步"
          }
        >
          <span>本地白名单</span>
          <span className="font-mono text-fg-2 tabular-nums">{fmt(whitelist.count)} 个号 · 每 6h 同步</span>
        </div>
      ) : null}

      {/* GH login state row — single line, click to re-open the login flow.
          Visible always (collapsible signal): logged-in shows handle + 退出,
          not-logged-in + dismissed shows the "仅用公榜" reminder so the user
          can recover from accidental dismissal. */}
      <div className="mt-2 flex items-center justify-between rounded-md border border-border bg-card px-3 py-1.5 text-[11px]">
        {login ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-ok">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />
              已登录 GitHub
            </span>
            <span className="font-mono text-fg-2 tabular-nums" title={`@${login}`}>@{login}</span>
          </>
        ) : (
          <>
            <span className="text-fg-3">未登录 · 仅用公榜匹配</span>
            <button
              type="button"
              onClick={startLogin}
              className="cursor-pointer text-accent hover:underline"
            >
              登录
            </button>
          </>
        )}
      </div>

      <div
        className={`mt-3 flex items-baseline justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
          status?.ok
            ? "border-border bg-card text-fg"
            : status?.ok === false
              ? "border-danger/30 bg-danger-soft text-danger"
              : "border-border bg-card text-fg-3"
        }`}
      >
        {status === null ? (
          <span>检查服务…</span>
        ) : status.ok ? (
          <>
            <span className="text-fg-3">公共名单</span>
            <span className="font-mono text-[13px] font-semibold tabular-nums tracking-tight">
              {fmt(status.n)}
              <span className="ml-1 font-sans text-[11px] font-normal text-fg-3">条</span>
            </span>
          </>
        ) : (
          <span>服务不可达 · 检查网络</span>
        )}
      </div>

      <button
        type="button"
        onClick={() =>
          chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })
        }
        className="mt-3 w-full cursor-pointer rounded-md border border-fg bg-fg px-3 py-2.5 text-[13px] font-semibold text-bg transition hover:opacity-90 active:translate-y-px"
      >
        打开管理面板
      </button>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <a
          href={`${edgeBase}/list`}
          target="_blank"
          rel="noopener"
          className="rounded-md border border-border-2 px-2.5 py-1.5 text-center text-[12px] text-fg-2 transition hover:bg-card-hi hover:text-fg"
        >
          看公榜
        </a>
        <a
          href={BRAND.repo}
          target="_blank"
          rel="noopener"
          className="rounded-md border border-border-2 px-2.5 py-1.5 text-center text-[12px] text-fg-2 transition hover:bg-card-hi hover:text-fg"
        >
          GitHub
        </a>
      </div>

      <footer className="mt-3 border-t border-border pt-2.5 text-[11px] leading-[1.6] text-fg-3">
        <a
          href={BRAND.governance}
          target="_blank"
          rel="noopener"
          className="text-fg-2 hover:text-fg"
        >
          为什么 / 治理
        </a>
        <span className="ml-1">— AI 判定永不自动公开，须人工或社区共识确认</span>
      </footer>
    </div>
  );
}
