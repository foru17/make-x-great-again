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
  hitPublic: number;
  blocked: number;
  firstUsedAt: number;
}

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

export function App() {
  const [status, setStatus] = useState<{ ok: boolean; n: number } | null>(null);
  const [stats, setStats] = useState<LocalStats | null>(null);
  const [edgeBase, setEdgeBase] = useState<string>(BRAND.edgeBase);

  useEffect(() => {
    bg<{ records: number }>({ type: "health" }).then((h) =>
      setStatus(h.ok && h.data ? { ok: true, n: h.data.records } : { ok: false, n: 0 }),
    );
    bg<LocalStats>({ type: "stats" }).then((r) => {
      if (r.ok && r.data) setStats(r.data);
    });
    getSettings().then((s) => {
      if (s.edgeBase) setEdgeBase(s.edgeBase);
    });
  }, []);

  const totalAssist = stats ? stats.hitPublic + stats.blocked : 0;
  const days = stats ? daysWith(stats.firstUsedAt) : 0;

  return (
    <div className="p-4">
      <header className="flex items-center gap-2">
        <img
          src={MASCOT_URL}
          alt=""
          width={26}
          height={26}
          className="rounded-md"
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
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat label="命中公榜" value={stats?.hitPublic ?? 0} hint="直接拉黑，零成本" accent />
        <Stat label="亲手拉黑" value={stats?.blocked ?? 0} hint="你按的拉黑按钮" />
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
        <span className="ml-1">— 判定永不自动公开，须人工或社区共识确认</span>
      </footer>
    </div>
  );
}
