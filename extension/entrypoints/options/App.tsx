import { useEffect, useMemo, useRef, useState } from "react";
import { clearGh, getGhLogin, getGhToken, ghUser, setGh } from "../../lib/auth";
import { BRAND } from "../../lib/brand";
import { CATEGORY_ZH, SPAM_CATEGORIES, type SpamCategory } from "../../lib/category";
import { categorizeReason, categorizeReasons } from "../../lib/reason-category";
import {
  type ActionMode,
  type CategoryAction,
  type Settings,
  getSettings,
  setCategoryAction,
  setSetting,
} from "../../lib/settings";
import { getStoredList, getStoredWhitelist } from "../../lib/list-sync";
import {
  type BlockRecord,
  type CacheRow,
  clearAllLocal,
  getBlocklist,
  getCacheRows,
  getStats,
  removeBlock,
  tweetUrl,
} from "../../lib/store";
import type { Label } from "../../lib/types";
import {
  ensureXPermission as ensureXHostPermission,
  isFirefoxAndroid,
} from "../../lib/x-permission";

const REPO = BRAND.repo;
const EDGE_DEFAULT = BRAND.edgeBase;

/** Pre-filled GitHub false-positive appeal for a listed account — matches the
 *  content-script's openAppeal so both entries land on the same filled form. */
function appealUrl(handle: string, userId?: string): string {
  const p = new URLSearchParams();
  p.set("handle", `@${handle}`);
  if (userId && /^\d+$/.test(userId)) p.set("userid", userId);
  p.set("title", `[Appeal] @${handle} wrongly listed`);
  return `${BRAND.appealNewIssue}&${p.toString()}`;
}

const whenFull = (ts: number) => new Date(ts).toLocaleString("zh-CN", { hour12: false });
/** Table-cell timestamp: current-year dates drop the year, no seconds —
 *  keeps the 时间 column narrow; hover (title=whenFull) has the rest. */
const when = (ts: number) => {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("zh-CN", {
    hour12: false,
    ...(sameYear ? {} : { year: "numeric" }),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};
const idTail = (id: string, h: string) =>
  /^\d+$/.test(id) && id !== h && !/^\d+$/.test(h) ? ` · ${id}` : "";

const TAG: Record<Label, [string, string]> = {
  spam: ["text-danger", "垃圾"],
  porn_bot: ["text-violet", "色情bot"],
  likely_spam: ["text-warn", "疑似垃圾"],
  uncertain: ["text-fg-3", "不确定"],
  legit: ["text-ok", "正常"],
};
const Tag = ({ label, conf }: { label: Label; conf?: number }) => {
  const [cls, zh] = TAG[label] ?? ["text-fg-3", label];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-current px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] ${cls}`}
    >
      {zh}
      {conf !== undefined ? (
        <span className="font-mono text-[10.5px] opacity-80">
          {(conf * 100).toFixed(0)}%
        </span>
      ) : null}
    </span>
  );
};

/**
 * Themed confirm modal — replaces native window.confirm so destructive
 * actions read in the same visual language as the rest of the options panel.
 * Backdrop-blur card; Esc cancels, Enter confirms; focus trap on the
 * primary button after mount; respects prefers-reduced-motion via CSS.
 */
function ConfirmDialog({
  open,
  title,
  body,
  okLabel = "确认",
  cancelLabel = "取消",
  variant = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  okLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger" | "ok";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => okRef.current?.focus(), 40);
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    }
    document.addEventListener("keydown", key, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, onCancel, onConfirm]);

  if (!open) return null;
  const okClass =
    variant === "danger"
      ? "bg-danger text-white border-danger hover:opacity-90 font-semibold"
      : variant === "ok"
        ? "border-ok/40 text-ok hover:bg-ok-soft"
        : "bg-fg text-bg border-fg hover:opacity-90 font-semibold";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mxgaConfirmTitle"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[420px] overflow-hidden rounded-lg border border-border-2 bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
        <h3
          id="mxgaConfirmTitle"
          className="px-5 pb-1.5 pt-5 text-[15px] font-semibold tracking-tight"
        >
          {title}
        </h3>
        <div className="px-5 pb-4 text-[13px] leading-relaxed text-fg-2">{body}</div>
        <div className="flex justify-end gap-2 border-t border-border bg-card px-5 py-3.5">
          <button
            type="button"
            className="rounded-md border border-border-2 px-3 py-1.5 text-[12px] text-fg-2 transition hover:bg-card-hi"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={okRef}
            type="button"
            className={`rounded-md border px-3 py-1.5 text-[12px] transition min-w-[72px] ${okClass}`}
            onClick={onConfirm}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const Avatar = ({ url, name }: { url?: string; name?: string }) => {
  const mono = (name || "?").replace(/^@/, "").charAt(0).toUpperCase();
  return url ? (
    <img
      src={url}
      referrerPolicy="no-referrer"
      alt=""
      className="h-7 w-7 flex-none rounded-full bg-card-hi object-cover"
    />
  ) : (
    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-card-hi text-xs font-bold text-fg-3">
      {mono}
    </span>
  );
};

/** Avatar wrapped in an X profile link — supports manual review by click. */
const AvatarLink = ({ handle, url, name }: { handle: string; url?: string; name?: string }) => (
  <a
    href={`https://x.com/${encodeURIComponent(handle)}`}
    target="_blank"
    rel="noopener"
    className="flex-none rounded-full ring-offset-1 transition hover:ring-2 hover:ring-accent/50"
    title={`去 @${handle} 的 X 主页`}
  >
    <Avatar url={url} name={name} />
  </a>
);

/** Plain @handle link with hover-to-accent. */
const HandleLink = ({ handle, className = "" }: { handle: string; className?: string }) => (
  <a
    href={`https://x.com/${encodeURIComponent(handle)}`}
    target="_blank"
    rel="noopener"
    className={`transition hover:text-accent ${className}`}
    title={`去 @${handle} 的 X 主页`}
  >
    @{handle}
  </a>
);

/** Display chip for a verdict reason — categorizes the raw English LLM
 *  output into a small Chinese class. The full reason is in title= for hover. */
const ReasonChip = ({
  raw,
  reasons,
}: {
  raw?: string | null;
  reasons?: readonly (string | null | undefined)[];
}) => {
  const cat = reasons ? categorizeReasons(reasons) : categorizeReason(raw);
  const display = (reasons?.filter(Boolean) as string[] | undefined)?.join("\n") || raw || "";
  // Tone → explicit classes (Tailwind v4 needs literal strings to detect)
  const tone =
    cat.tone === "violet"
      ? "text-violet border-violet/40 bg-violet/[0.08]"
      : cat.tone === "warn"
        ? "text-warn border-warn/40 bg-warn/[0.08]"
        : cat.tone === "danger"
          ? "text-danger border-danger/40 bg-danger/[0.08]"
          : cat.tone === "amber"
            ? "text-warn border-warn/30 bg-warn/[0.06]"
            : cat.tone === "neutral"
              ? "text-fg-2 border-border-2 bg-card-hi"
              : "text-fg-3 border-border bg-card";
  return (
    <span
      title={display || "无原因记录"}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.02em] ${tone}`}
    >
      {cat.zh}
    </span>
  );
};

type BtnTier = "primary" | "default" | "ghost" | "danger";
function Btn({
  tier = "default",
  size = "md",
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tier?: BtnTier;
  size?: "sm" | "md";
}) {
  const tone =
    tier === "primary"
      ? "bg-fg text-bg border-fg hover:opacity-90 font-semibold"
      : tier === "danger"
        ? "border-danger/35 bg-transparent text-danger hover:bg-danger-soft hover:border-danger/55"
        : tier === "ghost"
          ? "border-transparent bg-transparent text-fg-2 hover:bg-card-hi hover:text-fg"
          : "border-border-2 bg-transparent text-fg hover:bg-card-hi hover:border-fg-3";
  const px = size === "sm" ? "px-2.5 py-1 text-[12px] rounded-sm" : "px-3 py-1.5 text-[13px] rounded-md";
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 border font-medium leading-none transition-[background,border-color,transform,color] active:translate-y-px ${px} ${tone} ${className}`}
    >
      {children}
    </button>
  );
}

const Page = ({
  title,
  sub,
  children,
}: { title: string; sub?: string; children?: React.ReactNode }) => (
  <main className="mxga-page w-full min-w-0 max-w-[1160px] flex-1 px-4 py-5 sm:px-6 md:px-9 md:py-8">
    <h1 className="text-[26px] font-semibold tracking-[-0.015em] text-fg">{title}</h1>
    {sub && <div className="mb-7 mt-1.5 text-[13px] text-fg-3">{sub}</div>}
    {children}
  </main>
);

const SectionH = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-4 mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-3">
    {children}
  </h2>
);

const td = "border-b border-border px-3 py-2.5 align-middle whitespace-nowrap";
const th = `${td} text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-3`;
const trHover = "transition hover:bg-card-hi";

const CAT_COLOR: Record<string, string> = {
  porn: "#a855f7",
  crypto: "#f59e0b",
  gambling: "#ec4899",
  resource: "#3b82f6",
  marketing: "#ef4444",
  other: "#71717a",
};

const relTime = (ts: number | null | undefined): string => {
  if (!ts) return "从未";
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

interface ListState {
  black: number;
  white: number;
  version: string | null;
  fetchedAt: number | null;
  rules: number;
  catDist: Record<string, number>;
}

async function readListState(): Promise<ListState> {
  const [list, wl] = await Promise.all([getStoredList(), getStoredWhitelist()]);
  const catDist: Record<string, number> = {};
  if (list) {
    for (const e of list.entries) {
      const code = String(e[2])[1] ?? "o";
      catDist[code] = (catDist[code] ?? 0) + 1;
    }
  }
  return {
    black: list?.count ?? 0,
    white: wl?.count ?? 0,
    version: list?.version ?? null,
    fetchedAt: list?.fetchedAt ?? null,
    rules: list?.rules?.length ?? 0,
    catDist,
  };
}

/** 名单状态卡：黑/白名单规模、版本、同步时间 + 手动「立即更新」。 */
function ListStatusCard({ ls, onRefreshed }: { ls: ListState; onRefreshed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = (await chrome.runtime.sendMessage({ type: "list-sync", force: true })) as {
        ok: boolean;
        data?: { updated?: boolean; black?: number; white?: number; error?: string };
        error?: string;
      };
      const d = r?.data;
      if (r?.ok && d && !d.error) {
        setMsg(d.updated ? `已更新 · 黑名单 ${d.black?.toLocaleString()} 条` : "已是最新版本");
        onRefreshed();
      } else {
        setMsg(`更新失败：${d?.error ?? r?.error ?? "未知错误"}`);
      }
    } catch (e) {
      setMsg(`更新失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="list-status-card mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="list-status-summary flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
        <span className="list-status-stat">
          <b className="font-mono text-[16px] tabular-nums">{ls.black.toLocaleString("zh-CN")}</b>
          <span className="ml-1 text-fg-3">黑名单</span>
        </span>
        <span className="list-status-stat">
          <b className="font-mono text-[16px] tabular-nums">{ls.white.toLocaleString("zh-CN")}</b>
          <span className="ml-1 text-fg-3">白名单</span>
        </span>
        <span className="list-status-stat">
          <b className="font-mono text-[16px] tabular-nums">{ls.rules}</b>
          <span className="ml-1 text-fg-3">检测规则</span>
        </span>
        <span className="list-status-meta text-[12px] text-fg-3">
          上次同步 {relTime(ls.fetchedAt)}
          {ls.version ? ` · ${ls.version.slice(0, 14)}…` : ""} · 每 6 小时自动同步
        </span>
      </div>
      <div className="list-status-actions flex items-center gap-3">
        {msg && <span className="text-[12px] text-fg-3">{msg}</span>}
        <Btn onClick={refresh} disabled={busy}>
          {busy ? "同步中…" : "立即更新"}
        </Btn>
      </div>
    </div>
  );
}

function Overview() {
  const [s, setS] = useState<Awaited<ReturnType<typeof getStats>> | null>(null);
  const [bl, setBl] = useState(0);
  const [autoBl, setAutoBl] = useState(0);
  const [ls, setLs] = useState<ListState | null>(null);
  const [st, setSt] = useState<Settings | null>(null);
  const loadLists = () => readListState().then(setLs);
  useEffect(() => {
    getStats().then(setS);
    getBlocklist().then((l) => {
      setBl(l.length);
      setAutoBl(l.filter((r) => r.source === "auto").length);
    });
    getSettings().then(setSt);
    void loadLists();
  }, []);
  if (!s) return <Page title="概览" sub="加载中…" />;
  const d = s.byLabel;
  const total = Object.values(d).reduce((a, b) => a + b, 0) || 1;
  const seg = (k: string, c: string) =>
    d[k] ? (
      <i
        key={k}
        style={{ width: `${((d[k] / total) * 100).toFixed(1)}%`, background: c }}
        className="block h-full"
        title={`${k} · ${d[k]}`}
      />
    ) : null;
  const Card = ({ n, l }: { n: number; l: string }) => (
    <div className="overview-stat-card bg-bg p-5">
      <div className="font-mono text-[28px] font-semibold tabular-nums leading-[1.05] tracking-[-0.02em] text-fg">
        {n.toLocaleString("zh-CN")}
      </div>
      <div className="mt-2 text-[12px] text-fg-3">{l}</div>
    </div>
  );
  const catTotal = ls ? Object.values(ls.catDist).reduce((a, b) => a + b, 0) || 1 : 1;
  const CAT_ORDER: [string, SpamCategory][] = [
    ["p", "porn"],
    ["m", "marketing"],
    ["r", "resource"],
    ["c", "crypto"],
    ["g", "gambling"],
    ["o", "other"],
  ];
  return (
    <Page title="概览" sub="本地统计 · 数据仅存于本机，不含个人隐私信息">
      {ls && <ListStatusCard ls={ls} onRefreshed={loadLists} />}
      <div className="overview-stats mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
        <Card n={s.detections} l="AI 检测总数" />
        <Card n={s.cacheHits} l="缓存命中 · 省下的 AI 判定" />
        <Card n={bl} l={autoBl ? `已处理账号 · 其中自动 ${autoBl.toLocaleString("zh-CN")}` : "已处理账号"} />
        <Card n={(d.spam ?? 0) + (d.porn_bot ?? 0)} l="判定为垃圾/色情bot" />
      </div>

      {ls && ls.black > 0 && (
        <div className="mb-8">
          <SectionH>公共黑名单构成</SectionH>
          <div className="my-2 flex h-1.5 overflow-hidden rounded-full bg-card">
            {CAT_ORDER.map(([code, cat]) =>
              ls.catDist[code] ? (
                <i
                  key={code}
                  style={{
                    width: `${((ls.catDist[code] / catTotal) * 100).toFixed(1)}%`,
                    background: CAT_COLOR[cat],
                  }}
                  className="block h-full"
                  title={`${CATEGORY_ZH[cat]} · ${ls.catDist[code]}`}
                />
              ) : null,
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-fg-3">
            {CAT_ORDER.map(([code, cat]) => (
              <span key={code} className="inline-flex items-center gap-1.5">
                <i className="block h-2 w-2 rounded-full" style={{ background: CAT_COLOR[cat] }} />
                {CATEGORY_ZH[cat]} {(ls.catDist[code] ?? 0).toLocaleString("zh-CN")}
              </span>
            ))}
          </div>
        </div>
      )}

      {st && (
        <div className="mb-8">
          <div className="flex items-baseline justify-between">
            <SectionH>自动处理策略</SectionH>
            <a href="?tab=settings" className="text-[12px] text-fg-3 hover:text-fg">
              调整 →
            </a>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {SPAM_CATEGORIES.map((cat) => {
              const act = st.categoryActions[cat] ?? "badge";
              const actZh =
                act === "badge" ? "仅标记" : act === "hide" ? "本地隐藏" : act === "mute" ? "X 静音" : "X 拉黑";
              return (
                <span
                  key={cat}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] ${
                    act === "badge" ? "border-border-2 text-fg-3" : "border-fg/30 text-fg"
                  }`}
                >
                  <i className="block h-2 w-2 rounded-full" style={{ background: CAT_COLOR[cat] }} />
                  {CATEGORY_ZH[cat]} · {actZh}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <SectionH>检测类别分布</SectionH>
      <div className="my-2 flex h-1.5 overflow-hidden rounded-full bg-card">
        {seg("porn_bot", "#a855f7")}
        {seg("spam", "#ef4444")}
        {seg("likely_spam", "#f59e0b")}
        {seg("uncertain", "#71717a")}
        {seg("legit", "#10b981")}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <i className="block h-2 w-2 rounded-full bg-violet" />
          色情 bot {d.porn_bot ?? 0}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="block h-2 w-2 rounded-full bg-danger" />
          垃圾 {d.spam ?? 0}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="block h-2 w-2 rounded-full bg-warn" />
          疑似 {d.likely_spam ?? 0}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="block h-2 w-2 rounded-full bg-fg-3" />
          不确定 {d.uncertain ?? 0}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="block h-2 w-2 rounded-full bg-ok" />
          正常 {d.legit ?? 0}
        </span>
      </div>
    </Page>
  );
}

function Blocklist() {
  const [list, setList] = useState<BlockRecord[]>([]);
  const [q, setQ] = useState("");
  const load = () => getBlocklist().then((l) => setList([...l].sort((a, b) => b.ts - a.ts)));
  useEffect(() => void load(), []);
  const rows = useMemo(
    () =>
      list.filter((r) =>
        `${r.handle} ${r.displayName ?? ""} ${r.reason ?? ""}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [list, q],
  );
  // 来源 answers "这条处理是谁触发的" — plain words, config jargon stays in
  // the tooltip. block_all/list_hit/cache_hit only appear on legacy records.
  const src: Record<string, { label: string; hint: string }> = {
    manual: { label: "手动处理", hint: "你在页面上手动点了隐藏 / 静音 / 拉黑" },
    auto: {
      label: "自动处理",
      hint: "命中公共黑名单或官方规则，按「设置 → 自动处理策略」自动执行",
    },
    block_all: { label: "一键处理", hint: "在气泡面板一键处理了本页全部命中（旧版记录）" },
    list_hit: { label: "名单命中", hint: "命中公共黑名单（旧版记录）" },
    cache_hit: { label: "缓存命中", hint: "命中本地检测缓存（旧版记录）" },
  };
  return (
    <Page
      title="处理记录"
      sub={`共 ${list.length} 条 · 记录所有被隐藏 / 静音 / 拉黑的账号 · 恢复显示用于纠正误判（本地恢复可见；X 端的静音 / 拉黑需去 X 手动解除）`}
    >
      <input
        aria-label="搜索处理记录"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索 @handle / 显示名 / 理由"
        className="mb-4 w-full max-w-[320px] rounded-md border border-border-2 bg-transparent px-3 py-2 text-[13px] outline-none transition focus:border-accent"
      />
      {/* overflow-x-auto（而非 hidden）：窄窗口下表格横向滚动，操作列不再被裁掉 */}
      <div className="desktop-record-table overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[880px] border-collapse text-[13px]">
          <thead className="bg-card">
            <tr>
              <th className={th}>账号</th>
              <th className={th}>判定</th>
              <th className={th}>理由</th>
              <th className={th}>来源</th>
              <th className={th}>时间</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={trHover}>
                <td className={td}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <AvatarLink
                      handle={r.handle}
                      url={r.avatarUrl}
                      name={r.displayName || r.handle}
                    />
                    <div className="min-w-0">
                      <div className="max-w-[220px] truncate font-semibold tracking-[-0.005em]">
                        {r.displayName ? (
                          <a
                            href={`https://x.com/${encodeURIComponent(r.handle)}`}
                            target="_blank"
                            rel="noopener"
                            className="text-fg transition hover:text-accent"
                            title={`去 @${r.handle} 的 X 主页`}
                          >
                            {r.displayName}
                          </a>
                        ) : (
                          <HandleLink handle={r.handle} className="text-fg" />
                        )}
                      </div>
                      <div className="max-w-[220px] truncate text-[12px] text-fg-3">
                        <HandleLink handle={r.handle} className="text-fg-3" />
                        {idTail(r.id, r.handle)}
                      </div>
                    </div>
                  </div>
                </td>
                <td className={td}>
                  {r.verdict ? <Tag label={r.verdict.label} conf={r.verdict.confidence} /> : "—"}
                </td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <ReasonChip raw={r.reason} />
                    {tweetUrl(r) && (
                      <a
                        href={tweetUrl(r) as string}
                        target="_blank"
                        rel="noopener"
                        title={r.tweetText ? `触发内容：${r.tweetText}` : "查看触发这次处理的推文"}
                        className="whitespace-nowrap text-[11px] text-fg-3 underline decoration-dotted underline-offset-2 transition hover:text-accent"
                      >
                        查看推文 ↗
                      </a>
                    )}
                  </div>
                  {r.tweetText && (
                    <div
                      className="mt-1 max-w-[260px] truncate text-[11px] text-fg-3"
                      title={r.tweetText}
                    >
                      “{r.tweetText}”
                    </div>
                  )}
                </td>
                <td className={`${td} text-fg-3`}>
                  <span
                    title={src[r.source]?.hint ?? ""}
                    className="inline-flex cursor-help items-center rounded-full border border-border-2 bg-card px-2 py-0.5 text-[11px] text-fg-2"
                  >
                    {src[r.source]?.label ?? r.source}
                  </span>
                </td>
                <td className={`${td} font-mono text-[12px] text-fg-3`} title={whenFull(r.ts)}>
                  {when(r.ts)}
                </td>
                <td className={td}>
                  {/* 纵向堆叠：横排两个操作是表格在 1440 视口下溢出的主因 */}
                  <div className="flex flex-col items-start gap-1">
                    <Btn
                      size="sm"
                      onClick={async () => {
                        await removeBlock(r.id);
                        load();
                      }}
                    >
                      恢复显示
                    </Btn>
                    <a
                      href={appealUrl(r.handle, r.id)}
                      target="_blank"
                      rel="noopener"
                      title="账号被误列？提交申诉（已预填账号信息）"
                      className="whitespace-nowrap text-[11px] text-fg-3 underline decoration-dotted underline-offset-2 transition hover:text-warn"
                    >
                      误判申诉 ↗
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobile-record-list">
        {rows.map((r) => (
          <article key={r.id} className="mobile-record-card">
            <header className="flex items-start gap-3">
              <AvatarLink
                handle={r.handle}
                url={r.avatarUrl}
                name={r.displayName || r.handle}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-fg">
                  {r.displayName || `@${r.handle}`}
                </div>
                <HandleLink handle={r.handle} className="text-[12px] text-fg-3" />
              </div>
              {r.verdict && <Tag label={r.verdict.label} conf={r.verdict.confidence} />}
            </header>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ReasonChip raw={r.reason} />
              {tweetUrl(r) && (
                <a
                  href={tweetUrl(r) as string}
                  target="_blank"
                  rel="noopener"
                  className="text-[12px] text-fg-2 underline decoration-dotted underline-offset-2"
                >
                  查看现场 ↗
                </a>
              )}
            </div>
            {r.tweetText && (
              <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-fg-3">“{r.tweetText}”</p>
            )}
            <footer className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-[11px] text-fg-3">
                {src[r.source]?.label ?? r.source} · {when(r.ts)}
              </span>
              <div className="flex flex-col items-end gap-1.5">
                <Btn
                  size="sm"
                  className="mobile-record-action"
                  onClick={async () => {
                    await removeBlock(r.id);
                    load();
                  }}
                >
                  恢复显示
                </Btn>
                <a
                  href={appealUrl(r.handle, r.id)}
                  target="_blank"
                  rel="noopener"
                  className="text-[11px] text-fg-3 underline decoration-dotted underline-offset-2"
                >
                  误判申诉 ↗
                </a>
              </div>
            </footer>
          </article>
        ))}
      </div>
      {!list.length && <div className="py-10 text-center text-fg-3">还没有处理记录</div>}
    </Page>
  );
}

function Cache() {
  const [rows, setRows] = useState<CacheRow[]>([]);
  useEffect(() => void getCacheRows().then(setRows), []);
  return (
    <Page
      title="检测缓存"
      sub={`共 ${rows.length} 条 · 同一账号再次出现时直接复用判定结果，不再调用 AI`}
    >
      <div className="desktop-record-table overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead className="bg-card">
            <tr>
              <th className={th}>账号</th>
              <th className={th}>判定</th>
              <th className={th}>理由</th>
              <th className={th}>模型</th>
              <th className={th}>时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={trHover}>
                <td className={td}>
                  <div className="flex items-center gap-2.5">
                    <AvatarLink
                      handle={c.handle}
                      url={c.avatarUrl}
                      name={c.displayName || c.handle}
                    />
                    <div className="min-w-0">
                      <div className="max-w-[220px] truncate font-semibold tracking-[-0.005em]">
                        {c.displayName ? (
                          <a
                            href={`https://x.com/${encodeURIComponent(c.handle)}`}
                            target="_blank"
                            rel="noopener"
                            className="text-fg transition hover:text-accent"
                            title={`去 @${c.handle} 的 X 主页`}
                          >
                            {c.displayName}
                          </a>
                        ) : (
                          <HandleLink handle={c.handle} className="text-fg" />
                        )}
                      </div>
                      <div className="text-[12px] text-fg-3">
                        <HandleLink handle={c.handle} className="text-fg-3" />
                      </div>
                    </div>
                  </div>
                </td>
                <td className={td}>
                  <Tag label={c.verdict.label} conf={c.verdict.confidence} />
                </td>
                <td className={td}>
                  <ReasonChip reasons={c.verdict.reasons} />
                </td>
                <td className={`${td} font-mono text-[12px] text-fg-3`}>{c.model}</td>
                <td className={`${td} font-mono text-[12px] text-fg-3`} title={whenFull(c.ts)}>
                  {when(c.ts)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobile-record-list">
        {rows.map((c) => (
          <article key={c.id} className="mobile-record-card">
            <header className="flex items-start gap-3">
              <AvatarLink
                handle={c.handle}
                url={c.avatarUrl}
                name={c.displayName || c.handle}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-fg">
                  {c.displayName || `@${c.handle}`}
                </div>
                <HandleLink handle={c.handle} className="text-[12px] text-fg-3" />
              </div>
              <Tag label={c.verdict.label} conf={c.verdict.confidence} />
            </header>
            <div className="mt-3">
              <ReasonChip reasons={c.verdict.reasons} />
            </div>
            <footer className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-[11px] text-fg-3">
              <span className="truncate font-mono">{c.model}</span>
              <span className="flex-none">{when(c.ts)}</span>
            </footer>
          </article>
        ))}
      </div>
      {!rows.length && <div className="py-10 text-center text-fg-3">缓存为空</div>}
    </Page>
  );
}

function Toggle({
  on,
  onChange,
  label,
  hint,
}: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`mt-0.5 h-5 w-9 flex-none rounded-full border transition ${
          on
            ? "bg-fg border-fg"
            : "bg-card-hi border-border-2"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full shadow-sm transition ${
            on ? "translate-x-4 bg-bg" : "translate-x-0.5 bg-fg-3"
          }`}
        />
      </button>
      <span>
        <span className="font-medium text-fg">{label}</span>
        {hint && <span className="block text-[12px] text-fg-3">{hint}</span>}
      </span>
    </label>
  );
}

const X_ORIGINS = ["*://x.com/*", "*://twitter.com/*"];

const ACTION_MODES: {
  value: ActionMode;
  label: string;
  hint: string;
  needsX: boolean;
}[] = [
  {
    value: "local",
    label: "本地隐藏（推荐）",
    hint: "只在本扩展里隐藏，零联网，可随时在「处理记录」恢复。",
    needsX: false,
  },
  {
    value: "mute",
    label: "X 静音",
    hint: "X 原生静音：你看不到 ta，对方无感知。需授权 x.com。",
    needsX: true,
  },
  {
    value: "block",
    label: "X 拉黑",
    hint: "X 原生拉黑：互相不可见、解除关注。需授权 x.com；大批量拉黑可能触发风控。",
    needsX: true,
  },
];

function isMobileApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Ensure X website access before enabling a native action.
 *
 * Safari grants website access from Safari Settings. Firefox Android grants
 * it from add-on details and has no runtime host-permission prompt. Desktop
 * browsers retain normal contains-then-request behavior. */
async function ensureXPermission(): Promise<boolean> {
  return ensureXHostPermission({
    browser: import.meta.env.BROWSER,
    userAgent: navigator.userAgent,
    isSafari: import.meta.env.SAFARI,
    origins: X_ORIGINS,
    permissions: chrome.permissions,
  });
}

const CATEGORY_HINT: Record<SpamCategory, string> = {
  porn: "约炮 / 上门 / 引流到主页的色情机器人",
  crypto: "荐币、空投、合约喊单、股票投放",
  gambling: "博彩、体育投注、棋牌推广",
  resource: "网盘资源自取、盗版资源引流",
  marketing: "广告矩阵、涨粉、通用营销引流",
  other: "已确认是垃圾号但未归入以上类别",
};

// Same action vocabulary as the manual 处理方式 selector — the four segments
// describe WHAT happens; that this column happens automatically is carried by
// the section title. 「自动隐藏/自动静音」-style labels made it look like a
// different set of actions from the manual ones (they never were).
const CATEGORY_ACTIONS: { value: CategoryAction; label: string; title: string; needsX: boolean }[] = [
  { value: "badge", label: "仅标记", title: "只挂角标提示，不做任何处理", needsX: false },
  { value: "hide", label: "本地隐藏", title: "只在本扩展里隐藏（仅本机、可随时恢复），与手动方式里的「本地隐藏」是同一动作", needsX: false },
  { value: "mute", label: "X 静音", title: "X 原生静音：用你的登录态执行，所有设备生效；对方无感知", needsX: true },
  { value: "block", label: "X 拉黑", title: "X 原生拉黑：用你的登录态执行，所有设备生效；互相不可见、解除关注，需谨慎", needsX: true },
];

/** cat → 1-char lite-artifact code (schema v2), for the per-category counts
 *  shown next to the policy rows. Mirrors CODE_TO_CATEGORY in lib/category. */
const CAT_CODE: Record<SpamCategory, string> = {
  porn: "p",
  crypto: "c",
  gambling: "g",
  resource: "r",
  marketing: "m",
  other: "o",
};

/** One category row: name + hint on the left, 4-way segmented control on the
 *  right. mute/block request the optional x.com permission first, exactly
 *  like the manual 处理方式 selector. `count` = how many accounts of this
 *  category are in the locally-synced public blacklist (hidden when no list). */
function CategoryPolicyRow({
  cat,
  value,
  count,
  onChange,
}: {
  cat: SpamCategory;
  value: CategoryAction;
  count?: number;
  onChange: (a: CategoryAction) => void;
}) {
  return (
    <div className="category-policy-row flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border-2 p-3">
      <div className="min-w-0 flex-1 sm:min-w-[150px]">
        <span className="font-medium text-fg">{CATEGORY_ZH[cat]}</span>
        {count !== undefined && (
          <span
            className="ml-1.5 font-mono text-[12px] tabular-nums text-fg-3"
            title={`本地公共名单中该类别共 ${count.toLocaleString("zh-CN")} 个账号`}
          >
            · {count.toLocaleString("zh-CN")}
          </span>
        )}
        <span className="block text-[12px] text-fg-3">{CATEGORY_HINT[cat]}</span>
      </div>
      <div className="category-policy-actions flex w-full overflow-x-auto rounded-md border border-border-2 sm:w-auto">
        {CATEGORY_ACTIONS.map((a) => {
          const active = value === a.value;
          return (
            <button
              key={a.value}
              type="button"
              title={a.title}
              onClick={() => onChange(a.value)}
              className={`px-2.5 py-1.5 text-[12px] transition ${
                active
                  ? a.value === "block"
                    ? "bg-danger/15 font-semibold text-danger"
                    : "bg-card-hi font-semibold text-fg"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type ApplyStatus = "none" | "pending" | "approved" | "rejected";

const APPLY_STATUS_ZH: Record<ApplyStatus, [string, string]> = {
  none: ["尚未申请", "text-fg-3"],
  pending: ["审核中", "text-warn"],
  approved: ["已批准 ✓", "text-ok"],
  rejected: ["已驳回", "text-danger"],
};

/** Map a /v1/whitelist/apply error response to a user-facing line. */
function applyErrorText(status: number, error?: string): string {
  if (status === 401) return "GitHub Token 无效或已过期，请重新生成后再试。";
  if (status === 403 && error === "gh_account_too_young")
    return "GitHub 账号注册需满 90 天才能申请（防滥用门槛）。";
  if (status === 403 && error === "reporter_banned") return "该身份已被限制，无法提交申请。";
  if (status === 409) return "已有一条待审申请（同一身份 / 同一账号同时只能有一条）。";
  if (status === 429) return "请求太频繁，请约 1 小时后再试。";
  if (status === 503) return "服务端暂不可用，请稍后再试。";
  return `申请失败（HTTP ${status}${error ? ` · ${error}` : ""}）。`;
}

/** 「白名单」自助申请区：GitHub Token 做身份证明 + 提交自己的 @handle。 */
function WhitelistApplySection({ edgeBase }: { edgeBase: string }) {
  const base = (edgeBase || EDGE_DEFAULT).replace(/\/+$/, "");
  const [token, setToken] = useState("");
  const [login, setLogin] = useState<string | null>(null);
  // The applicant's OWN X handle, captured by the content script from the
  // logged-in x.com session ("xss:viewer"). No free-text input — you can
  // only apply for the account you are actually logged in as (防滥用).
  const [ownHandle, setOwnHandle] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ApplyStatus | null>(null);
  const [statusHandle, setStatusHandle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Already ON the official whitelist (locally-synced copy)? The apply/status
  // endpoint only knows about APPLICATIONS — an account whitelisted directly
  // (maintainer add, appeal) has no request row and would read 尚未申请,
  // prompting a pointless application. The local list answers instantly.
  const [wlHit, setWlHit] = useState(false);
  useEffect(() => {
    if (!ownHandle) return;
    void getStoredWhitelist().then((wl) => {
      if (!wl) return;
      const h = ownHandle.toLowerCase().replace(/^@+/, "");
      setWlHit(wl.entries.some((e) => String(e[1] ?? "").toLowerCase() === h));
    });
  }, [ownHandle]);

  const fetchStatus = async (tok: string) => {
    try {
      const res = await fetch(`${base}/v1/whitelist/apply/status`, {
        headers: { authorization: `Bearer ${tok}` },
      });
      if (!res.ok) return;
      const j = (await res.json()) as { status?: string; handle?: string };
      if (j.status && j.status in APPLY_STATUS_ZH) {
        setStatus(j.status as ApplyStatus);
        setStatusHandle(j.handle ?? null);
      }
    } catch {
      /* status display is best-effort */
    }
  };

  useEffect(() => {
    void (async () => {
      const [tok, lg] = await Promise.all([getGhToken(), getGhLogin()]);
      if (tok) {
        setToken(tok);
        setLogin(lg || null);
        void fetchStatus(tok);
      }
      try {
        const g = await chrome.storage.local.get("xss:viewer");
        const v = g["xss:viewer"] as { handle?: string } | undefined;
        if (v?.handle) setOwnHandle(v.handle);
      } catch {
        /* viewer capture is best-effort */
      }
    })();
    // fetchStatus is stable for a given edgeBase; run once on mount.
  }, []);

  // ---- GitHub Device Flow (一键登录，v0.4 的引导交互) ----
  const [ghFlow, setGhFlow] = useState<{ userCode: string; uri: string } | null>(null);
  const [ghBusy, setGhBusy] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const copyCode = async () => {
    if (!ghFlow) return;
    try {
      await navigator.clipboard.writeText(ghFlow.userCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1600);
    } catch {
      /* clipboard denied — the code is still selectable */
    }
  };

  const bg = (m: unknown) =>
    new Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>((res) => {
      try {
        chrome.runtime.sendMessage(m, (r) => res(r ?? { ok: false, error: "no response" }));
      } catch (e) {
        res({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });

  /** Shared success message incl. the 90d gate check (surfaced immediately). */
  const showIdentity = async (lg: string) => {
    setLogin(lg);
    const tok = await getGhToken();
    if (tok) {
      setToken(tok);
      const u = await ghUser(tok);
      if (u?.ageDays !== null && u !== null && u.ageDays < 90) {
        setMsg({
          text: `已登录，GitHub 身份：@${lg} —— 注意：该账号注册仅 ${u.ageDays} 天，未满 90 天无法申请白名单（请换一个注册更久的 GitHub 账号）。`,
          ok: false,
        });
      } else {
        setMsg({
          text: `已登录，GitHub 身份：@${lg}${u?.ageDays != null ? `（注册 ${u.ageDays} 天）` : ""}`,
          ok: true,
        });
      }
      void fetchStatus(tok);
    }
  };

  const ghLogin = async () => {
    setMsg(null);
    try {
      if (import.meta.env.BROWSER === "firefox") {
        const dataGranted = await chrome.permissions.request({
          data_collection: ["authenticationInfo", "personallyIdentifyingInfo"],
        } as chrome.permissions.Permissions & { data_collection: string[] });
        if (!dataGranted) {
          setMsg({ text: "未授权白名单申请所需的数据传输权限。", ok: false });
          return;
        }
      }
      const granted = await chrome.permissions.request({ origins: ["https://github.com/*"] });
      if (!granted) {
        setMsg({ text: "未授权访问 github.com——一键登录需要该权限（仅用于 GitHub 配对登录）。", ok: false });
        return;
      }
    } catch {
      setMsg({ text: "无法请求 github.com 权限。", ok: false });
      return;
    }
    setGhBusy(true);
    try {
      const start = await bg({ type: "gh_start" });
      const d = start.data as
        | { device_code?: string; user_code?: string; verification_uri?: string; interval?: number }
        | undefined;
      if (!start.ok || !d?.device_code || !d.user_code || !d.verification_uri) {
        setMsg({ text: `发起 GitHub 登录失败${start.error ? `：${start.error}` : ""}`, ok: false });
        return;
      }
      setGhFlow({ userCode: d.user_code, uri: d.verification_uri });
      window.open(d.verification_uri, "_blank", "noopener");
      const stepMs = Math.max(5, d.interval ?? 5) * 1000;
      const deadline = Date.now() + 5 * 60_000; // GitHub device codes live ~15min; 5min is plenty
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, stepMs));
        const poll = await bg({ type: "gh_poll", deviceCode: d.device_code });
        const p = poll.data as { login?: string; pending?: string } | undefined;
        if (p?.login) {
          setGhFlow(null);
          await showIdentity(p.login);
          return;
        }
        if (p?.pending && p.pending !== "authorization_pending" && p.pending !== "slow_down") {
          setGhFlow(null);
          setMsg({ text: `GitHub 登录未完成（${p.pending}），可重试。`, ok: false });
          return;
        }
      }
      setGhFlow(null);
      setMsg({ text: "登录等待超时，请重试。", ok: false });
    } finally {
      setGhBusy(false);
    }
  };

  const saveToken = async () => {
    const tok = token.trim();
    setMsg(null);
    if (!tok) {
      await clearGh();
      setLogin(null);
      setStatus(null);
      setMsg({ text: "已清除本机保存的 Token。", ok: true });
      return;
    }
    setBusy(true);
    const u = await ghUser(tok);
    setBusy(false);
    if (!u) {
      setMsg({ text: "Token 校验失败：GitHub 拒绝了这个 Token。", ok: false });
      return;
    }
    await setGh(tok, u.login);
    setLogin(u.login);
    // Surface the 90d anti-abuse gate NOW, not at submit time — "明明超过了
    // 90 天" usually means the token belongs to a different (newer) account.
    if (u.ageDays !== null && u.ageDays < 90) {
      setMsg({
        text: `已验证并保存，GitHub 身份：@${u.login} —— 注意：该账号注册仅 ${u.ageDays} 天，未满 90 天无法申请白名单（请换一个注册更久的 GitHub 账号的 Token）。`,
        ok: false,
      });
    } else {
      setMsg({
        text: `已验证并保存，GitHub 身份：@${u.login}${u.ageDays !== null ? `（注册 ${u.ageDays} 天）` : ""}`,
        ok: true,
      });
    }
    void fetchStatus(tok);
  };

  const apply = async () => {
    const h = (ownHandle ?? "").trim().replace(/^@+/, "");
    setMsg(null);
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) {
      setMsg({ text: "还没有识别到你的 X 账号——打开或刷新一次 x.com 再回到本页。", ok: false });
      return;
    }
    const tok = token.trim();
    if (!tok) {
      setMsg({ text: "请先填写并保存 GitHub Token。", ok: false });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${base}/v1/whitelist/apply`, {
        method: "POST",
        headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
        body: JSON.stringify({
          handle: h,
          ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        error?: string;
      };
      if (res.ok && j.status === "already_whitelisted") {
        setWlHit(true); // flip straight into the 已在白名单 success panel
      } else if (res.ok && j.ok) {
        setStatus("pending");
        setStatusHandle(h);
        setMsg({ text: "申请已提交，等待维护者审核。", ok: true });
      } else {
        setMsg({ text: applyErrorText(res.status, j.error), ok: false });
      }
    } catch (e) {
      setMsg({ text: `网络错误：${e instanceof Error ? e.message : String(e)}`, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full rounded-md border border-border-2 bg-transparent px-3 py-2 text-[13px] outline-none transition focus:border-accent";

  const identityLine = login && (
    <p className="text-[12px] text-fg-3">
      GitHub 身份：<b className="text-fg-2">@{login}</b>
    </p>
  );

  // ---- Terminal states render as a status panel, not the apply form ----
  // 已在白名单（本地名单命中 / 申请已批准）：再展示三步引导 + 申请按钮
  // 就是在骗用户做无用功。
  if (wlHit || status === "approved") {
    const h = (wlHit ? ownHandle : statusHandle) ?? ownHandle ?? statusHandle;
    return (
      <section className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-ok/40 bg-ok/[0.07] p-4">
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-ok text-[12px] font-bold text-white">
            ✓
          </span>
          <div>
            <div className="text-[14px] font-semibold text-ok">
              {h ? `@${h} ` : "你的账号"}已在官方白名单
            </div>
            <div className="mt-1 text-[12px] leading-relaxed text-fg-2">
              白名单账号永不会被本扩展检测、标记、自动处理或上榜。
              {status === "approved" && !wlHit
                ? " 你的申请已获批准，名单每 6 小时同步到本机。"
                : ""}
            </div>
          </div>
        </div>
        {identityLine}
      </section>
    );
  }
  if (status === "pending") {
    return (
      <section className="space-y-3">
        <div className="rounded-lg border border-warn/40 bg-warn/[0.07] p-4">
          <div className="text-[14px] font-semibold text-warn">
            申请审核中{statusHandle ? ` · @${statusHandle}` : ""}
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-fg-2">
            维护者审核通过后自动生效（名单每 6 小时同步到本机），无需重复提交。
          </div>
        </div>
        {identityLine}
        {msg && <p className={`text-[12px] ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      </section>
    );
  }

  // ---- Apply flow: the pitch is a LIVE checklist, not a static blurb ----
  const Step = ({ done, n, children }: { done: boolean; n: number; children: React.ReactNode }) => (
    <li className="flex items-center gap-2.5">
      <span
        className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
          done ? "bg-ok text-white" : "border border-border-2 text-fg-3"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <span className={done ? "text-fg-3" : "text-fg-2"}>{children}</span>
    </li>
  );

  return (
    <section>
      <ol className="mb-4 space-y-1.5 text-[13px]">
        <Step done={!!login} n={1}>
          GitHub 登录（账号需注册满 90 天，防滥用；凭证只存本机）
        </Step>
        <Step done={!!ownHandle} n={2}>
          扩展自动识别你登录的 X 账号
        </Step>
        <Step done={false} n={3}>
          提交申请，等维护者审核
        </Step>
      </ol>
      {status === "rejected" && (
        <p className="mb-3 text-[12px] text-danger">
          上次申请被驳回{statusHandle ? `（@${statusHandle}）` : ""}——可补充附言说明后重新提交。
        </p>
      )}
      <div className="space-y-2.5">
        {!login && !ghFlow && (
          <div className="flex items-center gap-3">
            <Btn tier="primary" onClick={ghLogin} disabled={ghBusy}>
              {ghBusy ? "正在连接 GitHub…" : "用 GitHub 一键登录"}
            </Btn>
            <span className="text-[12px] text-fg-3">
              跳转 GitHub 输入配对码即可，无需创建 Token
            </span>
          </div>
        )}
        {ghFlow && (
          <div className="rounded-lg border border-border-2 bg-card p-4">
            <div className="text-[12px] text-fg-3">在打开的 GitHub 页面输入这个配对码：</div>
            <div className="my-2 flex items-center gap-3">
              <button
                type="button"
                onClick={copyCode}
                title="点击复制配对码"
                className="cursor-pointer rounded-md border border-transparent font-mono text-[26px] font-bold tracking-[0.2em] text-fg transition hover:border-border-2 hover:bg-card-hi"
              >
                {ghFlow.userCode}
              </button>
              <Btn size="sm" onClick={copyCode} className="flex-none">
                {codeCopied ? "✓ 已复制" : "复制"}
              </Btn>
            </div>
            <div className="text-[12px] text-fg-3">
              等待你在 GitHub 上确认…（页面没弹出？
              <a
                href={ghFlow.uri}
                target="_blank"
                rel="noopener"
                className="text-fg-2 underline hover:text-fg"
              >
                手动打开 ↗
              </a>
              ）
            </div>
          </div>
        )}
        {identityLine}
        <details className="text-[12px] text-fg-3">
          <summary className="cursor-pointer select-none">
            高级：手动粘贴 GitHub Token（无需勾选任何权限）
          </summary>
          <div className="mt-2 flex items-center gap-2">
            <input
              aria-label="GitHub Token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="GitHub Token（ghp_… / github_pat_…）"
              autoComplete="off"
              className={input}
            />
            <Btn onClick={saveToken} disabled={busy} className="flex-none">
              验证并保存
            </Btn>
          </div>
        </details>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div
            className={`${input} flex items-center gap-2 ${ownHandle ? "" : "text-fg-3"}`}
            title="由你当前登录的 x.com 会话自动识别，不可手填——只能为自己的账号申请"
          >
            {ownHandle ? (
              <>
                <span className="flex-none whitespace-nowrap text-fg-3">申请账号（自动识别）</span>
                <b className="text-fg">@{ownHandle}</b>
              </>
            ) : (
              "未识别到你的 X 账号 · 打开或刷新一次 x.com 后回到本页"
            )}
          </div>
          <input
            aria-label="白名单申请附言"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="附言（选填，≤200 字）"
            className={input}
          />
        </div>
        <div className="flex items-center gap-3">
          <Btn tier="primary" onClick={apply} disabled={busy || !token.trim() || !ownHandle}>
            {busy ? "提交中…" : status === "rejected" ? "重新提交申请" : "申请把我的 X 账号加入白名单"}
          </Btn>
        </div>
        {msg && <p className={`text-[12px] ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}

function Settings() {
  const [cleared, setCleared] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [st, setSt] = useState<Settings | null>(null);
  const [ls, setLs] = useState<ListState | null>(null);
  const [permDenied, setPermDenied] = useState(false);
  useEffect(() => {
    getSettings().then(setSt);
    // Loaded once so each 分级策略 row can show how many synced public-list
    // accounts fall into its category. No list yet → counts stay hidden.
    readListState().then(setLs);
  }, []);
  const save = async <K extends keyof Settings>(k: K, v: Settings[K]) => {
    await setSetting(k, v);
    setSt((p) => (p ? { ...p, [k]: v } : p));
  };
  const changeMode = async (mode: ActionMode) => {
    if (mode !== "local") {
      const ok = await ensureXPermission();
      if (!ok) {
        setPermDenied(true);
        return;
      }
    }
    setPermDenied(false);
    await save("actionMode", mode);
  };
  const changeCategoryAction = async (cat: SpamCategory, action: CategoryAction) => {
    if (action === "mute" || action === "block") {
      const ok = await ensureXPermission();
      if (!ok) {
        setPermDenied(true);
        return;
      }
    }
    setPermDenied(false);
    await setCategoryAction(cat, action);
    setSt((p) =>
      p ? { ...p, categoryActions: { ...p.categoryActions, [cat]: action } } : p,
    );
  };
  return (
    <Page title="设置" sub="配置仅存于本机">
      <div className="settings-content max-w-[680px] space-y-9">
        {st && (
          <section>
            <SectionH>检测行为</SectionH>
            <p className="mb-2 text-[12px] text-fg-3">改动在下次刷新页面后生效</p>
            <Toggle
              on={st.enabled}
              onChange={(v) => save("enabled", v)}
              label="启用被动检测"
              hint="关闭后扩展在 X 上完全不工作"
            />
            <Toggle on={st.bubble} onChange={(v) => save("bubble", v)} label="显示角标气泡" />
            <Toggle
              on={st.bubblePos === "tr"}
              onChange={(v) => save("bubblePos", v ? "tr" : "br")}
              label="气泡位置：右上角"
              hint="关 = 右下角"
            />
            <Toggle
              on={st.autoExpand}
              onChange={(v) => save("autoExpand", v)}
              label="自动处理时展开面板"
              hint="关闭后仅气泡脉冲提示，不弹出处理卡片（小屏 / 手机端建议关闭）"
            />
          </section>
        )}

        {st && (
          <section>
            <SectionH>自动处理策略</SectionH>
            <p className="mb-3 text-[12px] leading-relaxed text-fg-3">
              命中<b className="text-fg-2">公共黑名单或官方规则</b>的账号按下方类别设定自动处理，其余只挂角标。
              规则命中只在评论区自动执行；白名单账号永不处理；一切可在「处理记录」撤销。
            </p>
            <div className="mb-4">
              <Toggle
                on={st.autoProcess}
                onChange={(v) => save("autoProcess", v)}
                label="启用自动处理"
                hint="总开关，与气泡面板里的「自动处理」开关同步；关闭后以下配置保留但不执行，一切命中只标记"
              />
            </div>
            <div className="mb-4">
              <div className="mb-1.5 text-[12px] font-semibold text-fg">自动处理范围</div>
              <div className="auto-scope-grid grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    {
                      v: "replies",
                      label: "仅推文评论区（推荐）",
                      hint: "只自动处理别人推文下的回复——垃圾潮所在；信息流和主页只标记。",
                    },
                    {
                      v: "all",
                      label: "全局",
                      hint: "信息流、主页、评论区都自动处理，误伤风险更高。",
                    },
                  ] as const
                ).map((o) => {
                  const active = (st.autoScope ?? "replies") === o.v;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => save("autoScope", o.v)}
                      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition ${
                        active ? "border-fg bg-card-hi" : "border-border-2 hover:border-fg-3"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                          active ? "border-fg" : "border-border-2"
                        }`}
                      >
                        {active && <span className="h-2 w-2 rounded-full bg-fg" />}
                      </span>
                      <span>
                        <span className="text-[13px] font-medium text-fg">{o.label}</span>
                        <span className="block text-[12px] leading-5 text-fg-3">{o.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mb-4">
              <div className="mb-1.5 text-[12px] font-semibold text-fg">自动收录条目</div>
              <p className="mb-2 text-[12px] leading-relaxed text-fg-3">
                命中分两级：<b className="text-fg-2">人工确认</b>（维护者复核过的公榜条目，始终按下方各类别的动作完整执行）和
                <b className="text-fg-2">自动收录</b>（AI/规则自动上榜的公榜条目 + 本地官方规则命中，占大多数）。这里决定自动收录一级能自动处理到什么程度。
              </p>
              <div className="grid grid-cols-1 gap-2">
                {(
                  [
                    {
                      v: "full",
                      label: "完整执行（默认）",
                      hint: "自动收录与人工确认同权，按各类别设定的动作执行（包括 X 静音/拉黑）。误判可在「处理记录」恢复并申诉。",
                    },
                    {
                      v: "hide",
                      label: "封顶为本地隐藏",
                      hint: "按各类别设定的动作执行，但封顶为本地隐藏——零联网、一键恢复；X 静音/拉黑仍只对人工确认条目执行。",
                    },
                    {
                      v: "badge",
                      label: "仅标记",
                      hint: "自动收录条目只挂角标、永不自动处理（最保守）。",
                    },
                  ] as const
                ).map((o) => {
                  const active = (st.autoTierMode ?? "full") === o.v;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => save("autoTierMode", o.v)}
                      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition ${
                        active ? "border-fg bg-card-hi" : "border-border-2 hover:border-fg-3"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                          active ? "border-fg" : "border-border-2"
                        }`}
                      >
                        {active && <span className="h-2 w-2 rounded-full bg-fg" />}
                      </span>
                      <span>
                        <span className="text-[13px] font-medium text-fg">{o.label}</span>
                        <span className="block text-[12px] leading-5 text-fg-3">{o.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              {SPAM_CATEGORIES.map((cat) => (
                <CategoryPolicyRow
                  key={cat}
                  cat={cat}
                  value={st.categoryActions[cat] ?? "badge"}
                  count={ls && ls.black > 0 ? (ls.catDist[CAT_CODE[cat]] ?? 0) : undefined}
                  onChange={(a) => changeCategoryAction(cat, a)}
                />
              ))}
            </div>
            <p className="mt-2 text-[12px] text-fg-3">
              动作含义与下方「手动处理动作」一致：本地隐藏仅本机、可恢复；X 静音 / 拉黑用你的登录态原生执行，所有设备生效。
            </p>
            {import.meta.env.SAFARI && (
              <p className="mt-2 text-[12px] leading-relaxed text-fg-3">
                {isMobileApplePlatform()
                  ? "Safari 的网站访问权限由浏览器统一管理。如果 X 上没有出现徽标或动作未执行，请前往“设置”→“App”→“Safari”→“扩展”→“Make X Great Again”，启用扩展并允许访问 x.com。"
                  : "Safari 的网站访问权限由浏览器统一管理。如果 X 上没有出现徽标或动作未执行，请前往 Safari → 设置 → 扩展 → Make X Great Again，启用扩展并允许访问 x.com。"}
              </p>
            )}
            {permDenied && (
              <p className="mt-2 text-[12px] text-danger">
                {isFirefoxAndroid(import.meta.env.BROWSER, navigator.userAgent)
                  ? "未授权访问 x.com，已保持当前设置。请在 Firefox 附加组件详情页手动授予站点权限：菜单 → 附加组件 → Make X Great Again → 权限，开启 x.com 与 twitter.com 的访问后再试。"
                  : "未授权访问 x.com，已保持当前设置。X 静音 / 拉黑需要该权限才能调用 X 接口。"}
              </p>
            )}
          </section>
        )}

        {st && (
          <section>
            <SectionH>手动处理动作</SectionH>
            <p className="mb-3 text-[12px] text-fg-3">
              只决定你<b className="text-fg-2">手动</b>点角标或气泡按钮时执行哪种动作，不影响上方的自动处理。X 静音 / 拉黑走你自己的登录态，不经过我们的服务器。
            </p>
            <div className="space-y-2">
              {ACTION_MODES.map((m) => {
                const active = st.actionMode === m.value;
                return (
                  <button
                    type="button"
                    key={m.value}
                    onClick={() => changeMode(m.value)}
                    className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
                      active
                        ? "border-fg bg-card-hi"
                        : "border-border-2 hover:border-fg-3"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                        active ? "border-fg" : "border-border-2"
                      }`}
                    >
                      {active && <span className="h-2 w-2 rounded-full bg-fg" />}
                    </span>
                    <span>
                      <span className="font-medium text-fg">{m.label}</span>
                      <span className="block text-[12px] text-fg-3">{m.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {permDenied && (
              <p className="mt-2 text-[12px] text-danger">
                {isFirefoxAndroid(import.meta.env.BROWSER, navigator.userAgent)
                  ? "未授权访问 x.com，已保持当前处理方式。请在 Firefox 附加组件详情页手动授予站点权限：菜单 → 附加组件 → Make X Great Again → 权限，开启 x.com 与 twitter.com 的访问后再试。"
                  : "未授权访问 x.com，已保持当前处理方式。X 静音 / 拉黑需要该权限才能调用 X 接口。"}
              </p>
            )}
          </section>
        )}

        <section>
          <SectionH>数据与隐私</SectionH>
          <p className="mb-3 text-[13px] text-fg-2">
            检测缓存、处理记录、统计均仅存于本机；除公开的 X 数字 ID 外不存任何个人信息。
          </p>
          <div className="flex items-center gap-3">
            <Btn tier="danger" onClick={() => setClearOpen(true)}>
              清除本地数据
            </Btn>
            {cleared && <span className="text-[12px] text-ok">已清除</span>}
          </div>
        </section>

        <ConfirmDialog
          open={clearOpen}
          title="清除本地数据"
          body={
            <>
              这会清空本机上的：
              <ul className="my-2 list-inside list-disc text-fg-3">
                <li>本地检测缓存</li>
                <li>你的隐藏历史 + 本地处理统计</li>
              </ul>
              <b className="text-fg">不可恢复。</b>
            </>
          }
          okLabel="确认清除"
          variant="danger"
          onCancel={() => setClearOpen(false)}
          onConfirm={async () => {
            setClearOpen(false);
            await clearAllLocal();
            setCleared(true);
          }}
        />
      </div>
    </Page>
  );
}

const About = () => (
  <Page title="关于" sub={`${BRAND.name} · 公益、开源`}>
    <div className="max-w-[680px] space-y-4 text-[13px] leading-7 text-fg-2">
      <p>
        X(Twitter) 反垃圾 / 色情机器人扩展。被动检测：公共名单由扩展定期从官方源自动同步（只下载公开名单数据，不上传任何内容），比对全部在本机完成。如在「设置」里把手动或自动动作选为 X 静音 / 拉黑，则会用你当前的 X 登录态调用 X 自家接口对账号生效（仍不经过我们的服务器、不收集任何数据）。
      </p>
      <div className="about-grid grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <div className="bg-bg p-4">
          <div className="text-[11px] uppercase tracking-[0.15em] text-fg-3">许可证</div>
          <code className="mt-1 inline-block font-mono text-[13px] text-fg">{BRAND.license}</code>
        </div>
        <div className="bg-bg p-4">
          <div className="text-[11px] uppercase tracking-[0.15em] text-fg-3">仓库</div>
          <a
            href={REPO}
            target="_blank"
            rel="noopener"
            className="mt-1 inline-block text-[13px] text-fg hover:text-accent"
          >
            github.com/{BRAND.owner}/make-x-great-again ↗
          </a>
        </div>
        <div className="bg-bg p-4">
          <div className="text-[11px] uppercase tracking-[0.15em] text-fg-3">公榜</div>
          <a
            href={`${EDGE_DEFAULT}/list`}
            target="_blank"
            rel="noopener"
            className="mt-1 inline-block text-[13px] text-fg hover:text-accent"
          >
            最近 100 条已确认 ↗
          </a>
        </div>
        <div className="bg-bg p-4">
          <div className="text-[11px] uppercase tracking-[0.15em] text-fg-3">治理</div>
          <a
            href={BRAND.governance}
            target="_blank"
            rel="noopener"
            className="mt-1 inline-block text-[13px] text-fg hover:text-accent"
          >
            申诉与移除机制 ↗
          </a>
        </div>
      </div>
      <p className="text-[12px] text-fg-3">
        隐私：除公开的 X 数字 ID 外不存储任何个人信息，数据默认仅在本机。AI 判定永不自动公开，须人工或社区共识（≥3 个独立 GitHub 上报人）确认。
      </p>
    </div>
  </Page>
);

// 小蓝 mascot — same PNG as the toolbar icon + the popup header. We use the
// runtime URL helper instead of bundling a duplicate asset, and render at
// 28px (retina-safe — the source is 128×128) for a chunkier sidebar mark
// than the popup's 32px version.
const MASCOT_URL = chrome.runtime.getURL("icon/128.png");
const Mascot = () => (
  <img
    src={MASCOT_URL}
    alt={BRAND.name}
    width={28}
    height={28}
    className="flex-none rounded-md"
  />
);

function BrandLockup() {
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold tracking-[-0.005em]">
      <Mascot />
      <span className="flex min-w-0 flex-col gap-px leading-tight">
        <span>{BRAND.acronym}</span>
        <span className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-fg-4">
          {BRAND.name}
        </span>
      </span>
    </div>
  );
}

/** 白名单自助申请 — its own nav page so the entry isn't buried in 设置. */
function WhitelistPage() {
  const [st, setSt] = useState<Settings | null>(null);
  useEffect(() => {
    getSettings().then(setSt);
  }, []);
  return (
    <Page title="保护我的账号" sub="官方白名单 · 名单内账号永不被检测、标记或上榜">
      <div className="max-w-[680px]">{st && <WhitelistApplySection edgeBase={st.edgeBase} />}</div>
    </Page>
  );
}

const TABS = [
  ["overview", "概览", Overview],
  ["blocklist", "处理记录", Blocklist],
  ["cache", "检测缓存", Cache],
  ["settings", "设置", Settings],
  ["whitelist", "保护我的账号", WhitelistPage],
  ["about", "关于", About],
] as const;
type TabId = (typeof TABS)[number][0];
const tabIds = new Set<TabId>(TABS.map(([id]) => id));

function TabButtons({
  active,
  drawer = false,
  onSelect,
}: {
  active: TabId;
  drawer?: boolean;
  onSelect: (id: TabId) => void;
}) {
  return TABS.map(([id, label]) => (
    <button
      key={id}
      type="button"
      onClick={() => onSelect(id)}
      className={`flex min-h-11 flex-none cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-[13px] transition ${
        drawer ? "w-full" : ""
      } ${active === id ? "bg-card-hi text-fg" : "text-fg-3 hover:bg-card hover:text-fg"}`}
    >
      {label}
    </button>
  ));
}

function NavigationFooter() {
  return (
    <div className="space-y-2 text-[11px] text-fg-3">
      <a
        href={`${EDGE_DEFAULT}/list`}
        target="_blank"
        rel="noopener"
        className="block min-h-11 content-center rounded-md px-3 text-fg-2 hover:bg-card hover:text-fg"
      >
        看公榜 ↗
      </a>
      <a
        href={REPO}
        target="_blank"
        rel="noopener"
        className="block min-h-11 content-center rounded-md px-3 text-fg-2 hover:bg-card hover:text-fg"
      >
        GitHub ↗
      </a>
      <div className="px-3 pt-1 font-mono text-fg-4">v{chrome.runtime.getManifest().version}</div>
    </div>
  );
}

function tabFromLocation(): TabId {
  if (typeof location === "undefined") return "overview";
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get("tab");
  const fromHash = url.hash.replace(/^#/, "");
  if (fromQuery && tabIds.has(fromQuery as TabId)) return fromQuery as TabId;
  if (fromHash && tabIds.has(fromHash as TabId)) return fromHash as TabId;
  return "overview";
}

function setTabUrl(id: TabId) {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  const url = new URL(location.href);
  url.searchParams.set("tab", id);
  url.hash = "";
  history.replaceState({}, "", url.toString());
}

export function App() {
  const [tab, setTabState] = useState<TabId>(() => tabFromLocation());
  const [menuOpen, setMenuOpen] = useState(false);
  const mobileApple = isMobileApplePlatform();
  const activeTab = TABS.find((item) => item[0] === tab);
  const Active = activeTab?.[2] ?? Overview;
  const setTab = (id: TabId) => {
    setTabState(id);
    setTabUrl(id);
    setMenuOpen(false);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  if (mobileApple) {
    return (
      <div className="ios-mobile-shell min-h-screen">
        <header className="ios-mobile-header sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-bg/95 px-4 pb-3 backdrop-blur">
          <button
            type="button"
            aria-label="打开管理菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-border-2 bg-card text-fg"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <BrandLockup />
        </header>

        {menuOpen && (
          <div className="fixed inset-0 z-50">
            <button
              type="button"
              aria-label="关闭管理菜单"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 h-full w-full bg-black/65 backdrop-blur-[2px]"
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-label="管理面板菜单"
              className="ios-mobile-drawer absolute inset-y-0 left-0 flex w-[min(320px,86vw)] flex-col border-r border-border-2 bg-bg px-4 pb-5 shadow-[20px_0_60px_rgba(0,0,0,0.45)]"
            >
              <div className="flex items-center justify-between border-b border-border pb-4">
                <BrandLockup />
                <button
                  type="button"
                  aria-label="关闭菜单"
                  onClick={() => setMenuOpen(false)}
                  className="grid h-11 w-11 place-items-center rounded-lg text-fg-2 hover:bg-card-hi hover:text-fg"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <nav className="mt-4 flex flex-col gap-1" aria-label="管理面板导航">
                <TabButtons active={tab} drawer onSelect={setTab} />
              </nav>
              <div className="mt-auto border-t border-border pt-3">
                <NavigationFooter />
              </div>
            </aside>
          </div>
        )}

        <Active />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="sticky top-0 z-20 flex w-full flex-none flex-col gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur md:h-screen md:w-[220px] md:gap-6 md:border-b-0 md:border-r md:py-6">
        <div className="px-1">
          <BrandLockup />
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0" aria-label="管理面板导航">
          <TabButtons active={tab} onSelect={setTab} />
        </nav>
        <div className="mt-auto hidden md:block">
          <NavigationFooter />
        </div>
      </aside>
      <Active />
    </div>
  );
}
