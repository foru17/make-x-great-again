import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type Account, type AgentItem, api, AuthError, rowKey, selToItems } from "@/lib/adminApi";
import { summarizeAgentReview } from "@/lib/agentReview";
import { ago, fmtN, verdictZh, VERDICTS } from "@/lib/format";
import { BATCH_CHUNK, chunk } from "@/lib/adminApi";
import { useSelection } from "@/lib/useSelection";
import { AccountRow } from "./AccountRow";
import { BatchBar } from "./BatchBar";
import { useConfirm } from "./confirm";
import { EmptyState, ListShell, MoreFoot } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

type Bucket = "pending" | "blacklist" | "whitelist";
const BUCKET_ZH: Record<Bucket, string> = { pending: "待定", blacklist: "拟拉黑", whitelist: "拟加白" };
const DESC: Record<Bucket, string> = {
  pending: "AI 已审查但证据不足的条目。可能可用内容太少，也可能账号已被 X 限制，需要人工再看一眼。",
  blacklist: "AI 认为这些账号高度疑似垃圾账号，尚未公开。点「确认拉黑」才会真正进公榜。",
  whitelist: "AI 认为这些账号更像正常用户，尚未生效。点「确认加白」才会真正进官方白名单。",
};

async function promoteBatch(keys: string[], target: string, label: string) {
  const chunks = chunk(keys, BATCH_CHUNK);
  const id = toast.loading(`批量${label} 0/${keys.length}`);
  let done = 0;
  for (const slice of chunks) {
    const items: AgentItem[] = selToItems(slice).map((it) =>
      it.xUserId ? { handle: it.handle, x_user_id: it.xUserId } : { handle: it.handle },
    );
    try {
      const j = await api.agentPromoteBatch(target, items);
      if (!j.ok) throw new Error();
      done += slice.length;
      toast.loading(`批量${label} ${done}/${keys.length}`, { id });
    } catch {
      toast.error(`批量${label}失败`, { id });
      return false;
    }
  }
  toast.success(`完成 · ${done} 条`, { id });
  return true;
}

export function AgentTab({
  bucket,
  onAuth,
  onMutated,
}: {
  bucket: Bucket;
  onAuth: () => void;
  onMutated: () => void;
}) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Account[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<number | null>(null);

  const load = useCallback(
    async (more: boolean) => {
      const parts = [`bucket=${bucket}`, "limit=100"];
      if (more && cursor.current) parts.push(`before=${cursor.current}`);
      try {
        const j = await api.agentList(`?${parts.join("&")}`);
        cursor.current = j.nextBefore;
        setHasMore(!!j.nextBefore);
        setRows((prev) => (more ? prev.concat(j.list) : j.list));
      } catch (e) {
        if (e instanceof AuthError) onAuth();
      }
    },
    [bucket, onAuth],
  );

  useEffect(() => {
    cursor.current = null;
    load(false);
  }, [load]);

  const keys = rows.map(rowKey);
  const sel = useSelection(keys);

  const primary =
    bucket === "whitelist"
      ? { target: "whitelist", label: "确认加白", variant: "success" as const }
      : { target: "blacklist", label: "确认拉黑", variant: "destructive" as const };

  const promoteOne = async (a: Account, target: string) => {
    try {
      const j = await api.agentPromote(a.handle, a.x_user_id, target);
      if (!j.ok) throw new Error();
      setRows((r) => r.filter((x) => rowKey(x) !== rowKey(a)));
      onMutated();
    } catch {
      toast.error("操作失败");
      load(false);
    }
  };

  const batch = (target: string, label: string, variant: "destructive" | "success" | "default") =>
    async () => {
      const keysArr = [...sel.sel];
      const ok = await confirm({
        title: `批量${label}`,
        body: (
          <p>
            对已选 <b>{keysArr.length}</b> 条 AI 审查结果执行「{label}」？
          </p>
        ),
        okLabel: `${label} ${keysArr.length} 条`,
        okVariant: variant,
      });
      if (!ok) return;
      if (await promoteBatch(keysArr, target, label)) {
        sel.clear();
        load(false);
        onMutated();
      }
    };

  return (
    <div>
      <ViewHead
        title={`AI 审查 · ${BUCKET_ZH[bucket]}`}
        count={fmtN(rows.length) + (hasMore ? "+" : "")}
        desc={DESC[bucket]}
      />
      <BatchBar
        selected={sel.selected}
        visible={rows.length}
        allChecked={sel.allChecked}
        indeterminate={sel.indeterminate}
        onToggleAll={sel.toggleAll}
        actions={
          <>
            <Button
              size="sm"
              variant={primary.variant === "destructive" ? "destructive" : "default"}
              className={primary.variant === "success" ? "bg-success text-success-foreground hover:bg-success/90" : undefined}
              onClick={batch(primary.target, `批量${primary.label}`, primary.variant)}
            >
              批量{primary.label}
            </Button>
            {bucket !== "whitelist" && (
              <Button size="sm" variant="outline" className="text-success" onClick={batch("whitelist", "加白", "success")}>
                批量加白
              </Button>
            )}
            {bucket !== "blacklist" && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={batch("blacklist", "拉黑", "destructive")}>
                批量拉黑
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={batch("requeue", "退回", "default")}>
              批量退回
            </Button>
            <Button size="sm" variant="ghost" onClick={batch("reject", "拒绝", "default")}>
              批量拒绝
            </Button>
            <Button size="sm" variant="ghost" onClick={sel.clear}>
              清空选择
            </Button>
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState>{BUCKET_ZH[bucket]}列表当前为空。AI 每 15 分钟自动复核待审队列。</EmptyState>
      ) : (
        <ListShell>
          {rows.map((a, i) => {
            const label = a.agent_label || "uncertain";
            const summary = summarizeAgentReview(a);
            return (
              <AccountRow
                key={rowKey(a)}
                a={a}
                label={{ text: verdictZh(label), tone: VERDICTS[label]?.tone || "muted" }}
                selected={sel.sel.has(rowKey(a))}
                onToggle={(shift) => sel.toggle(i, shift)}
                confidence={Math.round((a.agent_confidence || 0) * 100)}
                subExtra={<span>· AI 复核 {ago(a.agent_at || a.last_scored)}</span>}
                below={
                  <div className="mt-2 max-w-2xl space-y-2 text-[12px]">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-muted-foreground">判断结果</span>
                      <span className="font-semibold text-foreground">{summary.conclusion}</span>
                    </p>
                    {summary.signals.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-0.5 text-muted-foreground">主要依据</span>
                        {summary.signals.map((signal) => (
                          <span key={signal} className="rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 font-medium text-violet">
                            {signal}
                          </span>
                        ))}
                      </div>
                    )}
                    {summary.reasons.slice(0, 3).map((reason) => (
                      <p key={reason} className="text-foreground/80">补充说明：{reason}</p>
                    ))}
                    {summary.evidence.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-0.5 text-muted-foreground">可核对数据</span>
                        {summary.evidence.map((item) => (
                          <span key={item} className="rounded border bg-card px-1.5 py-0.5 tabular-nums text-muted-foreground">
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                }
                actions={
                  <>
                    <Button
                      size="sm"
                      variant={primary.variant === "destructive" ? "destructive" : "default"}
                      className={primary.variant === "success" ? "bg-success text-success-foreground hover:bg-success/90" : undefined}
                      onClick={() => promoteOne(a, primary.target)}
                    >
                      {primary.label}
                    </Button>
                    {bucket !== "whitelist" && (
                      <Button size="sm" variant="outline" className="text-success" onClick={() => promoteOne(a, "whitelist")}>
                        加白
                      </Button>
                    )}
                    {bucket !== "blacklist" && (
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => promoteOne(a, "blacklist")}>
                        拉黑
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => promoteOne(a, "requeue")}>
                      退回
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => promoteOne(a, "reject")}>
                      拒绝
                    </Button>
                  </>
                }
              />
            );
          })}
        </ListShell>
      )}
      <MoreFoot hasMore={hasMore} onMore={() => load(true)} text={`已加载 ${fmtN(rows.length)} 条${hasMore ? "" : "（全部）"}`} />
    </div>
  );
}
