import { useEffect, useMemo, useRef, useState } from "react";
import { clearAllLocal, getGhLogin } from "../../lib/auth";
import { BRAND } from "../../lib/brand";
import { categorizeReason, categorizeReasons } from "../../lib/reason-category";
import { type Settings, getSettings, setSetting } from "../../lib/settings";
import {
  type BlockRecord,
  type CacheRow,
  getBlocklist,
  getCacheRows,
  getStats,
  removeBlock,
} from "../../lib/store";
import type { BgResponse, Label } from "../../lib/types";

const REPO = BRAND.repo;
const EDGE_DEFAULT = BRAND.edgeBase;

function bg<T = Record<string, unknown>>(msg: unknown): Promise<BgResponse & { data?: T }> {
  return new Promise((r) => chrome.runtime.sendMessage(msg, (x) => r(x ?? { ok: false })));
}
const when = (ts: number) => new Date(ts).toLocaleString("zh-CN", { hour12: false });
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
  <main className="max-w-[1100px] flex-1 px-9 py-8">
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
const th = `${td} text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-3`;
const trHover = "transition hover:bg-card-hi";

function Overview() {
  const [s, setS] = useState<Awaited<ReturnType<typeof getStats>> | null>(null);
  const [bl, setBl] = useState(0);
  useEffect(() => {
    getStats().then(setS);
    getBlocklist().then((l) => setBl(l.length));
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
    <div className="bg-bg p-5">
      <div className="font-mono text-[28px] font-semibold tabular-nums leading-[1.05] tracking-[-0.02em] text-fg">
        {n.toLocaleString("zh-CN")}
      </div>
      <div className="mt-2 text-[12px] text-fg-3">{l}</div>
    </div>
  );
  return (
    <Page title="概览" sub="本地统计 · 数据仅存于本机，无 PII">
      <div className="mb-8 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-border bg-border">
        <Card n={s.detections} l="AI 检测总数" />
        <Card n={s.cacheHits} l="缓存命中 · 省下的 LLM 调用" />
        <Card n={bl} l="已拉黑账号" />
        <Card n={(d.spam ?? 0) + (d.porn_bot ?? 0)} l="判定为垃圾/色情bot" />
      </div>
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
  const src: Record<string, string> = {
    manual: "手动",
    block_all: "一键全部",
    list_hit: "公榜命中",
    cache_hit: "缓存命中",
  };
  return (
    <Page
      title="拉黑记录"
      sub={`共 ${list.length} 条 · 取消拉黑用于纠正误判（账号会重新可见）`}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索 @handle / 显示名 / 理由"
        className="mb-4 w-[320px] rounded-md border border-border-2 bg-transparent px-3 py-2 text-[13px] outline-none transition focus:border-accent"
      />
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse text-[13px]">
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
                  <ReasonChip raw={r.reason} />
                </td>
                <td className={`${td} text-fg-3`}>{src[r.source]}</td>
                <td className={`${td} font-mono text-[12px] text-fg-3`}>{when(r.ts)}</td>
                <td className={td}>
                  <Btn
                    size="sm"
                    onClick={async () => {
                      await removeBlock(r.id);
                      load();
                    }}
                  >
                    取消拉黑
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.length && <div className="py-10 text-center text-fg-3">还没有拉黑记录</div>}
    </Page>
  );
}

function Cache() {
  const [rows, setRows] = useState<CacheRow[]>([]);
  useEffect(() => void getCacheRows().then(setRows), []);
  return (
    <Page
      title="检测缓存"
      sub={`共 ${rows.length} 条 · 同账号再出现直接用缓存，0 次 LLM`}
    >
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse text-[13px]">
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
                <td className={`${td} font-mono text-[12px] text-fg-3`}>{when(c.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function Settings() {
  const [login, setLogin] = useState("");
  const [flow, setFlow] = useState("");
  const [cleared, setCleared] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [st, setSt] = useState<Settings | null>(null);
  const refresh = () => getGhLogin().then(setLogin);
  useEffect(() => {
    refresh();
    getSettings().then(setSt);
    // Deep-link from the popup onboarding banner: ?login=1 → start Device
    // Flow immediately, then strip the param so reload doesn't re-trigger.
    if (typeof location !== "undefined" && /[?&]login=1\b/.test(location.search)) {
      const url = new URL(location.href);
      url.searchParams.delete("login");
      history.replaceState({}, "", url.toString());
      // Wait a tick so the initial render with the login UI mounts before
      // ghLogin() opens the GitHub verification tab.
      setTimeout(() => {
        getGhLogin().then((cur) => {
          if (!cur) void ghLogin();
        });
      }, 60);
    }
  }, []);
  const save = async <K extends keyof Settings>(k: K, v: Settings[K]) => {
    await setSetting(k, v);
    setSt((p) => (p ? { ...p, [k]: v } : p));
  };
  async function ghLogin() {
    setFlow("正在获取设备码…");
    const s = await bg<{
      user_code: string;
      verification_uri: string;
      device_code: string;
      interval: number;
    }>({ type: "gh_start" });
    if (!s.ok || !s.data) {
      setFlow(`失败：${s.error ?? "请确认 OAuth App 已勾选 Enable Device Flow"}`);
      return;
    }
    const { user_code, verification_uri, device_code, interval } = s.data;
    window.open(verification_uri, "_blank", "noopener");
    setFlow(`在打开的页面输入码：${user_code}，授权后自动完成…`);
    const poll = async () => {
      const r = await bg<{ login?: string }>({ type: "gh_poll", deviceCode: device_code });
      if (r.ok && r.data?.login) {
        setFlow("");
        refresh();
        return;
      }
      setTimeout(poll, Math.max(5, interval || 5) * 1000);
    };
    setTimeout(poll, (interval || 5) * 1000);
  }
  return (
    <Page title="设置" sub="登录与配置仅存于本机">
      <div className="max-w-[680px] space-y-9">
        <section>
          <SectionH>GitHub 登录</SectionH>
          <p className="mb-3 text-[13px] text-fg-2">
            上报与服务端 AI 分析需要 GitHub 登录（防滥用、可追溯）。Device Flow 无 secret、无回调。
          </p>
          {login ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="inline-flex items-center gap-1.5">
                <i className="block h-1.5 w-1.5 rounded-full bg-ok" />
                已登录
              </span>
              <code className="rounded-sm bg-card-hi px-2 py-0.5 font-mono text-[12px] text-fg">
                @{login}
              </code>
              <Btn
                size="sm"
                tier="ghost"
                onClick={async () => {
                  await bg({ type: "gh_logout" });
                  refresh();
                }}
              >
                登出
              </Btn>
            </div>
          ) : (
            <Btn tier="primary" onClick={ghLogin}>
              用 GitHub 登录
            </Btn>
          )}
          {flow && <p className="mt-2 text-[12px] text-warn">{flow}</p>}
        </section>

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
              on={st.replyAuto}
              onChange={(v) => save("replyAuto", v)}
              label="回复区逐个自动检查"
              hint="关闭可显著降低 LLM 调用 / 更克制"
            />
            <Toggle
              on={st.autoBlockListHits}
              onChange={(v) => save("autoBlockListHits", v)}
              label="对已确认的垃圾号自动拉黑"
              hint="开启后：扫到的色情/垃圾账号会被静默后台拉黑（包括公榜命中 + 本机此前判过 spam 的缓存号），不弹卡片、不需要点确认。默认关闭。"
            />
          </section>
        )}

        {st && (
          <section>
            <SectionH>高级 · 服务端地址</SectionH>
            <p className="mb-2 text-[12px] text-fg-3">
              留空 = 默认线上 <code className="font-mono text-fg">{EDGE_DEFAULT}</code>
            </p>
            <div className="flex gap-2">
              <input
                value={st.edgeBase}
                onChange={(e) => setSt({ ...st, edgeBase: e.target.value })}
                placeholder={EDGE_DEFAULT}
                className="w-[340px] rounded-md border border-border-2 bg-transparent px-3 py-1.5 text-[12px] font-mono outline-none transition focus:border-accent"
              />
              <Btn tier="primary" size="sm" onClick={() => save("edgeBase", st.edgeBase.trim())}>
                保存
              </Btn>
            </div>
          </section>
        )}

        <section>
          <SectionH>数据与隐私</SectionH>
          <p className="mb-3 text-[13px] text-fg-2">
            检测缓存、拉黑记录、统计、登录态均仅存于本机；除公开 X 数字 ID 外不存 PII。
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
                <li>AI 检测缓存（下次扫描会再调 LLM）</li>
                <li>你的拉黑历史 + 本地处理统计</li>
                <li>GitHub 登录态（仅本机，不撤 GH token）</li>
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
            refresh();
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
        基于 AI 的 X(Twitter) 反垃圾 / 色情机器人扩展。被动检测、本地优先、中心服务（Cloudflare）协同；用户一键拉黑即视为人工确认信号之一。
      </p>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
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
        隐私：除公开的 X 数字 ID 外不存储任何 PII，数据默认仅在本机。AI 判定永不自动公开，须人工或社区共识（≥3 个独立 GitHub 上报人）确认。
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

const TABS = [
  ["overview", "概览", Overview],
  ["blocklist", "拉黑记录", Blocklist],
  ["cache", "检测缓存", Cache],
  ["settings", "设置", Settings],
  ["about", "关于", About],
] as const;

export function App() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("overview");
  const Active = TABS.find((t) => t[0] === tab)?.[2] ?? Overview;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[220px] flex-none flex-col gap-6 border-r border-border px-4 py-6">
        <div className="flex items-center gap-2.5 px-1 text-[15px] font-semibold tracking-[-0.005em]">
          <Mascot />
          <span className="flex flex-col gap-px leading-tight">
            <span>{BRAND.acronym}</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-fg-4">{BRAND.name}</span>
          </span>
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="管理面板导航">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition ${
                tab === id
                  ? "bg-card-hi text-fg"
                  : "text-fg-3 hover:bg-card hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-1.5 text-[11px] text-fg-3">
          <a
            href={`${EDGE_DEFAULT}/list`}
            target="_blank"
            rel="noopener"
            className="block text-fg-2 hover:text-fg"
          >
            看公榜 ↗
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noopener"
            className="block text-fg-2 hover:text-fg"
          >
            GitHub ↗
          </a>
          <div className="pt-2 font-mono text-fg-4">v{chrome.runtime.getManifest().version}</div>
        </div>
      </aside>
      <Active />
    </div>
  );
}
