import { useEffect, useMemo, useState } from "react";
import { clearAllLocal, getGhLogin } from "../../lib/auth";
import { BRAND } from "../../lib/brand";
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
      ? "bg-fg text-bg border-fg hover:bg-white hover:border-white font-semibold"
      : tier === "danger"
        ? "border-danger/35 bg-transparent text-[#fca5a5] hover:bg-danger-soft hover:border-danger/50"
        : tier === "ghost"
          ? "border-transparent bg-transparent text-fg-2 hover:bg-card-hi hover:text-fg"
          : "border-border-2 bg-transparent text-fg hover:bg-card-hi hover:border-[rgb(255_255_255/0.22)]";
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
  const src: Record<string, string> = { manual: "手动", block_all: "一键全部", list_hit: "名单命中" };
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
                    <Avatar url={r.avatarUrl} name={r.displayName || r.handle} />
                    <div className="min-w-0">
                      <div className="max-w-[220px] truncate font-semibold tracking-[-0.005em]">
                        {r.displayName || `@${r.handle}`}
                      </div>
                      <div className="max-w-[220px] truncate text-[12px] text-fg-3">
                        @{r.handle}
                        {idTail(r.id, r.handle)}
                      </div>
                    </div>
                  </div>
                </td>
                <td className={td}>
                  {r.verdict ? <Tag label={r.verdict.label} conf={r.verdict.confidence} /> : "—"}
                </td>
                <td className={`${td} max-w-[360px] whitespace-normal text-fg-3`}>
                  {r.reason || ""}
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
                    <Avatar url={c.avatarUrl} name={c.displayName || c.handle} />
                    <div className="min-w-0">
                      <div className="max-w-[220px] truncate font-semibold tracking-[-0.005em]">
                        {c.displayName || `@${c.handle}`}
                      </div>
                      <div className="text-[12px] text-fg-3">@{c.handle}</div>
                    </div>
                  </div>
                </td>
                <td className={td}>
                  <Tag label={c.verdict.label} conf={c.verdict.confidence} />
                </td>
                <td className={`${td} max-w-[360px] whitespace-normal text-fg-3`}>
                  {c.verdict.reasons[0] ?? ""}
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
        className={`mt-0.5 h-5 w-9 flex-none rounded-full transition ${
          on ? "bg-fg" : "bg-[rgb(255_255_255/0.12)]"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full transition ${
            on ? "translate-x-4 bg-bg" : "translate-x-0.5 bg-white"
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
  const [st, setSt] = useState<Settings | null>(null);
  const refresh = () => getGhLogin().then(setLogin);
  useEffect(() => {
    refresh();
    getSettings().then(setSt);
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
            <Btn
              tier="danger"
              onClick={async () => {
                if (!confirm("清除全部本地数据（缓存/拉黑记录/统计/登录）？不可恢复。")) return;
                await clearAllLocal();
                setCleared(true);
                refresh();
              }}
            >
              清除本地数据
            </Btn>
            {cleared && <span className="text-[12px] text-ok">已清除</span>}
          </div>
        </section>
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

const Shield = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
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
          <span className="text-fg">
            <Shield />
          </span>
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
