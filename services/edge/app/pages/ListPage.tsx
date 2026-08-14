import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { agoCn, FeedAvatar, fmtCn } from "@/components/site/FeedAvatar";
import { SiteLayout } from "@/components/site/SiteLayout";
import { BRAND } from "@/lib/brand";
import { type FeedRow, feedKey, type Meta, publicApi, VERDICT_ZH } from "@/lib/publicApi";

const TONE: Record<string, string> = {
  spam: "bg-destructive/10 text-destructive",
  likely_spam: "bg-destructive/10 text-destructive",
  porn_bot: "bg-violet/10 text-violet",
  uncertain: "bg-muted text-muted-foreground",
  legit: "bg-success/10 text-success",
};

function reasonsTitle(r: FeedRow): string {
  let arr: string[] = [];
  try {
    arr = r.reasons ? (typeof r.reasons === "string" ? JSON.parse(r.reasons) : r.reasons) : [];
  } catch {}
  return Array.isArray(arr) && arr.length ? `AI 理由：${arr.join("；")}` : "";
}

function Row({ r }: { r: FeedRow }) {
  const lbl = r.verdict_label || "uncertain";
  const conf = typeof r.confidence === "number" ? Math.max(0, Math.min(100, Math.round(r.confidence * 100))) : 0;
  const profile = `https://x.com/${encodeURIComponent(r.handle)}`;
  const name = (r.display_name || "").trim() || `@${r.handle}`;
  const reps = r.reporters || 0;
  const evid = (r.evidence_text || "").replace(/\s+/g, " ").trim();
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-accent/40">
      <FeedAvatar handle={r.handle} url={r.avatar_url} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <a href={profile} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-info">
            {name}
          </a>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted-foreground">
          <span className={`rounded-full px-2 py-0.5 font-medium ${TONE[lbl] || TONE.uncertain}`} title={reasonsTitle(r)}>
            {VERDICT_ZH[lbl] || lbl}
          </span>
          <span>· {agoCn(r.published_at)}</span>
          {reps >= 1 && (
            <span className={reps >= 3 ? "font-semibold text-foreground" : ""}>· {reps} 人拉黑过</span>
          )}
        </div>
        {evid && (
          <div className="mt-1 truncate text-[11.5px] italic text-muted-foreground" title={evid}>
            『{evid.slice(0, 180)}
            {evid.length > 180 ? "…" : ""}』
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden w-20 sm:block">
          <div className="text-right font-mono text-sm font-semibold tabular-nums">{conf}%</div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <i className="block h-full rounded-full bg-foreground/60" style={{ width: `${conf}%` }} />
          </div>
        </div>
        <a href={profile} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="去 X 主页">
          <ExternalLink className="size-4" />
        </a>
      </div>
    </div>
  );
}

export function ListPage() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pulse, setPulse] = useState("连接中...");
  const [oldest, setOldest] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef<number | undefined>(undefined);

  const refreshMeta = useCallback(() => {
    publicApi.meta().then(setMeta).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const j = await publicApi.list("?limit=100");
    setRows(j.list || []);
    latest.current = j.latestAt;
    setOldest(j.nextBefore ?? null);
    setPulse(`已同步 · 最新 ${fmtCn((j.list || []).length)} 条`);
  }, []);

  useEffect(() => {
    load().then(refreshMeta).catch(() => setPulse("连接失败"));
    const poll = setInterval(async () => {
      if (!latest.current) return;
      try {
        const j = await publicApi.list(`?limit=100&since=${latest.current}`);
        const fresh = j.list || [];
        if (!fresh.length) return;
        setRows((prev) => {
          const seen = new Set(prev.map(feedKey));
          const added = fresh.filter((r) => !seen.has(feedKey(r)));
          if (added.length) setPulse(`+${added.length} 条新增`);
          return added.length ? added.concat(prev) : prev;
        });
        latest.current = j.latestAt || latest.current;
      } catch {}
    }, 30000);
    const metaTimer = setInterval(refreshMeta, 60000);
    return () => {
      clearInterval(poll);
      clearInterval(metaTimer);
    };
  }, [load, refreshMeta]);

  const loadMore = async () => {
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const j = await publicApi.list(`?limit=100&before=${oldest}`);
      setRows((prev) => {
        const seen = new Set(prev.map(feedKey));
        return prev.concat((j.list || []).filter((r) => !seen.has(feedKey(r))));
      });
      setOldest(j.nextBefore ?? null);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <SiteLayout current="list">
      <section className="py-8">
        <h1 className="font-serif text-4xl font-semibold tracking-tight">公开名单</h1>
        <p className="mt-2 text-[12.5px] uppercase tracking-[0.12em] text-muted-foreground">
          {BRAND.acronym} · 已确认的垃圾号
        </p>
        <div className="mt-3 space-y-1 text-[15px] text-muted-foreground">
          <p>AI 初筛，维护者复核。</p>
          <p>
            误伤？开{" "}
            <a href={BRAND.appealNewIssue} className="text-info underline">
              issue
            </a>
            ，复核后撤下。完整快照每 6h 同步到{" "}
            <a href={`${BRAND.repo}/tree/data-mirror/data`} target="_blank" rel="noreferrer noopener" className="text-info underline">
              仓库 data/
            </a>
            。
          </p>
        </div>
        <div className="mt-4 inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          <span>{pulse}</span>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { n: fmtCn(meta?.count), l: "已确认总数" },
          { n: (meta && meta.week > 0 ? "+" : "") + fmtCn(meta?.week), l: "本周新增" },
          { n: meta ? fmtCn(Math.round((meta.week || 0) / 7)) : "—", l: "日均" },
          { n: meta?.latestAt ? agoCn(meta.latestAt) : "—", l: "最近一条" },
        ].map((c, i) => (
          <div key={i} className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="font-mono text-xl font-bold tabular-nums">{c.n}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">{c.l}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">加载中...</div>
        ) : (
          rows.map((r) => <Row key={feedKey(r)} r={r} />)
        )}
      </div>

      <div className="py-5 text-center">
        {oldest && (
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "加载中..." : "加载更早 100 条"}
          </Button>
        )}
      </div>
      <p className="pb-4 text-center text-[12px] text-muted-foreground">
        每 30 秒更新。数据接口：<code className="rounded bg-muted px-1">GET /v1/list</code>
      </p>
    </SiteLayout>
  );
}
