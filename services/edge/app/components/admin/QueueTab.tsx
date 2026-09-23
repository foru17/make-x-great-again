import { useState } from "react";
import { REVIEW_STAGES, reviewStatusLabel } from "../../../shared/review-queue";
import { summarizeAgentReview } from "@/lib/agentReview";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type Account,
  api,
  AuthError,
  QUEUE_SORT_OPTIONS,
  rowKey,
  selToItems,
} from "@/lib/adminApi";
import {
  ACTION_ZH,
  agoZh,
  batchZh,
  CATEGORIES,
  categoryZh,
  fmtN,
  verdictZh,
  VERDICTS,
} from "@/lib/format";
import { useFilteredList } from "@/lib/useFilteredList";
import { useSelection } from "@/lib/useSelection";
import { AccountRow } from "./AccountRow";
import { BatchBar } from "./BatchBar";
import { useConfirm } from "./confirm";
import { EMPTY_FILTERS, FilterPanel } from "./FilterPanel";
import { useFilterBatch } from "./useFilterBatch";
import { ListPager } from "./ListPager";
import { EmptyState, ListShell } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

const VERDICT_CHIPS = ["spam", "porn_bot", "likely_spam", "uncertain", "legit"].map((v) => ({
  value: v,
  zh: verdictZh(v),
}));

export function QueueTab({
  onAuth,
  onMutated,
  initialReviewStage = "",
}: { onAuth: () => void; onMutated: () => void; initialReviewStage?: string }) {
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const {
    rows: queue,
    filters,
    sort,
    page,
    total,
    pageCount,
    loading,
    refreshing,
    error,
    apply: applyFilters,
    goPage: changePage,
    reload,
    refresh,
  } = useFilteredList<Account>(
    async (qs) => {
      const j = await api.queue(qs);
      return {
        rows: j.queue,
        total: j.total,
        sort: typeof j.appliedFilters?.sort === "string" ? j.appliedFilters.sort : undefined,
      };
    },
    "severity",
    onAuth,
    initialReviewStage ? { review_stage: initialReviewStage } : {},
  );

  const keys = queue.map(rowKey);
  const sel = useSelection(keys);
  const apply: typeof applyFilters = (next, nextSort) => {
    sel.clear();
    applyFilters(next, nextSort);
  };
  const goPage = (next: number) => {
    if (busy || loading || refreshing) return;
    sel.clear();
    changePage(next);
  };
  const filterBatch = useFilterBatch({
    scope: "queue",
    noun: "待审账号",
    filters,
    onAuth,
    onDone: () => {
      sel.clear();
      refresh();
      onMutated();
    },
  });

  const decide = async (a: Account, action: "approve" | "whitelist" | "reject" | "remove") => {
    setBusy(true);
    try {
      const result = await api.decide(a.handle, a.x_user_id, action, "queue");
      if (!result.processed) toast.info("这条记录已被处理，已刷新列表");
      else toast.success(`已${ACTION_ZH[action]}`);
      sel.clear();
      await refresh();
      onMutated();
    } catch (e) {
      if (e instanceof AuthError) onAuth();
      else toast.error("操作失败，请刷新后重试");
    } finally {
      setBusy(false);
    }
  };

  const requeue = async (accounts: Account[]) => {
    const reviewed = accounts.filter((a) => a.status?.startsWith("agent_"));
    if (!reviewed.length) return;
    if (
      !(await confirm({
        title: "重新初审",
        body: <p>将 {reviewed.length} 条记录标记为未初审，等待 AI 再次处理。待审总数不会减少。</p>,
        okLabel: `重新初审 ${reviewed.length} 条`,
      }))
    )
      return;
    setBusy(true);
    try {
      const result = await api.decideBatch(
        "requeue",
        reviewed.map((a) => ({ handle: a.handle, xUserId: a.x_user_id })),
        undefined,
        "queue",
      );
      toast.success(`已提交重新初审 ${result.processed ?? 0} 条`);
      sel.clear();
      await refresh();
      onMutated();
    } catch (e) {
      if (e instanceof AuthError) onAuth();
      else toast.error("重新初审失败，请刷新后重试");
    } finally {
      setBusy(false);
    }
  };

  const batch =
    (
      action: "approve" | "whitelist" | "reject" | "remove",
      label: string,
      variant: "destructive" | "default",
      category?: string,
    ) =>
    async () => {
      const keysArr = [...sel.sel];
      const ok = await confirm({
        title: `批量${label}`,
        body: (
          <p>
            确认对已选 <b>{keysArr.length}</b> 条执行「{label}」？写 review_log，不可批量撤回。
          </p>
        ),
        okLabel: `${label} ${keysArr.length} 条`,
        okVariant: variant,
      });
      if (!ok) return;
      setBusy(true);
      try {
        const result = await api.decideBatch(action, selToItems(keysArr), category, "queue");
        toast.success(
          `已${label} ${result.processed ?? 0} 条${result.skipped ? `；${result.skipped} 条已被处理，已跳过` : ""}`,
        );
        sel.clear();
        await refresh();
        onMutated();
      } catch (e) {
        if (e instanceof AuthError) onAuth();
        else toast.error("批量操作失败，请刷新后重试");
        await refresh();
      } finally {
        setBusy(false);
      }
    };

  return (
    <fieldset className="min-w-0" disabled={busy || refreshing} aria-busy={loading || busy || refreshing}>
      <ViewHead
        title="待审队列"
        count={total == null ? fmtN(queue.length) : fmtN(total)}
        desc={<>所有尚未终审的账号都在这里。AI 初审仅提供建议，最终处理后才移出待审。</>}
      />

      <div className="mb-4 flex flex-wrap gap-2" aria-label="AI 初审状态">
        {REVIEW_STAGES.map((stage) => (
          <Button
            key={stage.value}
            size="sm"
            variant={(filters.review_stage || "") === stage.value ? "default" : "outline"}
            aria-pressed={(filters.review_stage || "") === stage.value}
            onClick={() => apply({ ...filters, review_stage: stage.value })}
          >
            {stage.label}
          </Button>
        ))}
      </div>
      <FilterPanel
        mode="queue"
        filters={filters}
        sort={sort}
        sortOptions={QUEUE_SORT_OPTIONS.map((option) => ({
          ...option,
          label: option.label.startsWith("把握") ? `初筛${option.label}` : option.label,
        }))}
        searchPlaceholder="handle / uid / 推文内容 / 判定理由"
        onApply={apply}
        quick={{ key: "verdict", allLabel: "全部初筛判定", options: VERDICT_CHIPS }}
        batchMenu={
          <>
            <DropdownMenuItem
              className="text-destructive"
              onClick={filterBatch("approve", ACTION_ZH.approve)}
            >
              全部{ACTION_ZH.approve}
            </DropdownMenuItem>
            {CATEGORIES.map((cat) => (
              <DropdownMenuItem
                key={cat.value}
                onClick={filterBatch(
                  "approve",
                  `${ACTION_ZH.approve}并归类「${cat.zh}」`,
                  cat.value,
                )}
              >
                全部{ACTION_ZH.approve}并归类「{cat.zh}」
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={filterBatch("whitelist", ACTION_ZH.whitelist)}>
              全部{ACTION_ZH.whitelist}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={filterBatch("reject", ACTION_ZH.reject)}>
              全部{ACTION_ZH.reject}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={filterBatch("remove", ACTION_ZH.remove)}>
              全部{ACTION_ZH.remove}
            </DropdownMenuItem>
          </>
        }
      />

      {!loading && !error && (
        <BatchBar
          selected={sel.selected}
          visible={queue.length}
          allChecked={sel.allChecked}
          indeterminate={sel.indeterminate}
          onToggleAll={sel.toggleAll}
          actions={
            <>
              <Button
                size="sm"
                variant="destructive"
                onClick={batch("approve", ACTION_ZH.approve, "destructive")}
              >
                {batchZh("approve")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="destructive">
                    {ACTION_ZH.approve}并归类 ▾
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {CATEGORIES.map((cat) => (
                    <DropdownMenuItem
                      key={cat.value}
                      onClick={batch(
                        "approve",
                        `${ACTION_ZH.approve}并归类「${cat.zh}」`,
                        "destructive",
                        cat.value,
                      )}
                    >
                      {cat.zh}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="outline"
                className="text-success"
                onClick={batch("whitelist", ACTION_ZH.whitelist, "default")}
              >
                批量白名单
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={batch("reject", ACTION_ZH.reject, "default")}
              >
                {batchZh("reject")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={batch("remove", ACTION_ZH.remove, "destructive")}
              >
                {batchZh("remove")}
              </Button>
              {queue.some((a) => sel.sel.has(rowKey(a)) && a.status?.startsWith("agent_")) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => requeue(queue.filter((a) => sel.sel.has(rowKey(a))))}
                >
                  重新初审
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={sel.clear}>
                清空选择
              </Button>
            </>
          }
        />
      )}

      {loading ? (
        <output className="block space-y-3 py-4" aria-label="正在加载待审账号">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-lg border bg-muted/50 motion-safe:animate-pulse" />
          ))}
        </output>
      ) : error ? (
        <EmptyState>
          加载失败，筛选条件已保留。
          <Button variant="outline" onClick={reload}>
            重新加载
          </Button>
        </EmptyState>
      ) : queue.length === 0 ? (
        <EmptyState>没有符合条件的待审账号。可切换初审状态或清空筛选查看其他记录。</EmptyState>
      ) : (
        <ListShell>
          {queue.map((a, i) => {
            const label = a.verdict_label || "uncertain";
            return (
              <AccountRow
                key={rowKey(a)}
                a={a}
                label={{
                  text: `初筛：${verdictZh(label)}`,
                  tone: VERDICTS[label]?.tone || "muted",
                }}
                selected={sel.sel.has(rowKey(a))}
                onToggle={(shift) => sel.toggle(i, shift)}
                confidence={
                  a.status === "auto_pending_review" ? Math.round((a.confidence || 0) * 100) : null
                }
                reporters={a.reporters || 0}
                subExtra={
                  <>
                    <span
                      title={new Date(a.last_scored || a.published_at || 0).toLocaleString("zh-CN")}
                    >
                      · 入队 {agoZh(a.last_scored || a.published_at)}
                    </span>
                    <span className="font-medium text-foreground">
                      {" "}
                      · {reviewStatusLabel(a.status)}
                    </span>
                    {a.category && <span title="spam 类别"> · 类别 {categoryZh(a.category)}</span>}
                  </>
                }
                below={a.status?.startsWith("agent_") ? <ReviewDetail account={a} /> : undefined}
                actions={
                  <>
                    <Button size="sm" variant="destructive" onClick={() => decide(a, "approve")}>
                      {ACTION_ZH.approve}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-success"
                      onClick={() => decide(a, "whitelist")}
                    >
                      {ACTION_ZH.whitelist}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(a, "reject")}>
                      {ACTION_ZH.reject}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(a, "remove")}>
                      {ACTION_ZH.remove}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost">
                          更多 ▾
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {a.status?.startsWith("agent_") && (
                          <DropdownMenuItem onClick={() => requeue([a])}>重新初审</DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => apply({ ...EMPTY_FILTERS, handle: a.handle })}
                        >
                          按 Handle：{a.handle}
                        </DropdownMenuItem>
                        {a.x_user_id && (
                          <DropdownMenuItem
                            onClick={() => apply({ ...EMPTY_FILTERS, uid: a.x_user_id ?? "" })}
                          >
                            按 UID 前缀：{a.x_user_id}
                          </DropdownMenuItem>
                        )}
                        {a.display_name && (
                          <DropdownMenuItem
                            onClick={() =>
                              apply({ ...EMPTY_FILTERS, display_name: a.display_name ?? "" })
                            }
                          >
                            按显示名：{a.display_name}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            );
          })}
        </ListShell>
      )}
      {!loading && !error && (
        <ListPager
          page={page}
          pageCount={pageCount}
          total={total}
          loaded={queue.length}
          onPage={goPage}
        />
      )}
    </fieldset>
  );
}

function ReviewDetail({ account }: { account: Account }) {
  const summary = summarizeAgentReview(account);
  return (
    <details className="mt-2 max-w-2xl text-xs">
      <summary className="cursor-pointer py-1 font-medium text-foreground">
        AI 初审依据 ·{" "}
        {account.agent_confidence == null
          ? "把握未知"
          : `把握 ${Math.round(account.agent_confidence * 100)}%`}
        {account.agent_at ? ` · ${agoZh(account.agent_at)}` : ""}
      </summary>
      <div className="mt-1 space-y-1.5 text-muted-foreground">
        <p className="text-foreground">{summary.conclusion}</p>
        {summary.signals.length > 0 && <p>主要依据：{summary.signals.join("；")}</p>}
        {summary.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        {summary.evidence.length > 0 && <p>可核对数据：{summary.evidence.join("；")}</p>}
        {account.agent_model && <p>审核模型：{account.agent_model}</p>}
      </div>
    </details>
  );
}
