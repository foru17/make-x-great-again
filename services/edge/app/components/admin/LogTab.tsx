import { useCallback, useEffect, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, AuthError, type ContribRow, type LogEntry } from "@/lib/adminApi";
import { logActionZh } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MoreFoot } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

const REPO = "https://github.com/foru17/make-x-great-again";

function actionTone(a: string) {
  // 拉黑类 = 危险色，加白类 = 正常色，其余中性。用前缀判断，规则/agent 触发的
  // 同类动作（keyword_blacklist…）也能着色。
  if (a.includes("remove") || a.includes("reject")) return "text-muted-foreground";
  if (a === "approve" || a === "auto_confirm" || a.includes("blacklist")) return "text-destructive";
  if (a.includes("whitelist")) return "text-success";
  return "text-muted-foreground";
}

/** 共建活跃：每日 distinct 贡献者（登录检测/匿名/规则命中/上报）。观察
 *  登录叙事改版是否拉动登录率的仪表。没有数据时不占版面。 */
function ContribSection() {
  const [rows, setRows] = useState<ContribRow[] | null>(null);

  useEffect(() => {
    api
      .contrib(14)
      .then((j) => setRows(j.list || []))
      .catch(() => setRows([]));
  }, []);

  if (!rows || rows.length === 0) return null;

  const byDay = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const d = byDay.get(r.day) ?? {};
    d[r.kind] = r.actives;
    byDay.set(r.day, d);
  }
  const days = [...byDay.keys()].sort().reverse();

  return (
    <div className="mb-6">
      <div className="mb-2">
        <h3 className="text-sm font-semibold">共建活跃（近 14 天 · 每日去重身份数）</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          在线检测 = 实际花了 AI 判定的身份；规则命中 = 走关键词直判通道的身份。登录引导改版后盯「登录检测」这列有没有涨。
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">日期</TableHead>
              <TableHead className="text-right">登录检测</TableHead>
              <TableHead className="text-right">匿名检测</TableHead>
              <TableHead className="text-right">规则命中</TableHead>
              <TableHead className="text-right">上报</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((d) => {
              const w = byDay.get(d) ?? {};
              const cell = (n?: number) => (
                <TableCell className="text-right font-mono tabular-nums">
                  {n ? n : <span className="text-muted-foreground">—</span>}
                </TableCell>
              );
              return (
                <TableRow key={d}>
                  <TableCell className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                    {d}
                  </TableCell>
                  {cell(w.classify)}
                  {cell(w.classify_anon)}
                  {cell((w.rule_write ?? 0) + (w.rule_write_anon ?? 0) || undefined)}
                  {cell(w.report)}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function LogTab({ onAuth }: { onAuth: () => void }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<number | null>(null);

  const load = useCallback(
    async (more: boolean) => {
      const parts = ["limit=50"];
      if (more && cursor.current) parts.push(`before=${cursor.current}`);
      try {
        const j = await api.log(`?${parts.join("&")}`);
        cursor.current = j.nextCursor;
        setHasMore(!!j.nextCursor);
        setLog((prev) => (more ? prev.concat(j.log) : j.log));
      } catch (e) {
        if (e instanceof AuthError) onAuth();
      }
    },
    [onAuth],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <div>
      <ViewHead
        title="审计日志"
        desc={
          <>
            每一次加入、移除、白名单、驳回都留痕。完整数据每 6h 镜像到仓库{" "}
            <a href={`${REPO}/tree/data-mirror/data`} target="_blank" rel="noreferrer noopener">
              data/
            </a>
            ，git history 可审计。
          </>
        }
      />
      <ContribSection />
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">时间</TableHead>
              <TableHead className="w-32">动作</TableHead>
              <TableHead className="w-32">角色</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.map((e, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                  {new Date(e.at).toLocaleString("zh-CN", { hour12: false })}
                </TableCell>
                <TableCell
                  title={e.action}
                  className={cn("text-xs font-semibold", actionTone(e.action))}
                >
                  {logActionZh(e.action)}
                </TableCell>
                <TableCell className="font-mono text-[11.5px] text-muted-foreground">{e.actor}</TableCell>
                <TableCell>
                  {e.handle ? (
                    <a href={`https://x.com/${e.handle}`} target="_blank" rel="noreferrer noopener" className="hover:text-info">
                      @{e.handle}
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{e.note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <MoreFoot hasMore={hasMore} onMore={() => load(true)} />
    </div>
  );
}
