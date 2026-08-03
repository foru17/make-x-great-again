import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Account, api, type Item, QUEUE_SORT_OPTIONS, rowKey } from "@/lib/adminApi";
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
import { runBatch } from "@/lib/runBatch";
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

export function QueueTab({ onAuth, onMutated }: { onAuth: () => void; onMutated: () => void }) {
  const confirm = useConfirm();
  const { rows: queue, setRows: setQueue, filters, sort, page, total, pageCount, apply, goPage, reload } =
    useFilteredList<Account>(
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
    );

  const keys = queue.map(rowKey);
  const sel = useSelection(keys);
  const filterBatch = useFilterBatch({
    scope: "queue",
    noun: "待审账号",
    filters,
    onAuth,
    onDone: () => {
      sel.clear();
      reload();
      onMutated();
    },
  });

  const decide = async (a: Account, action: "approve" | "whitelist" | "reject" | "remove") => {
    try {
      await api.decide(a.handle, a.x_user_id, action);
      setQueue((q) => q.filter((x) => rowKey(x) !== rowKey(a)));
      onMutated();
    } catch {
      toast.error("操作失败");
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
      if (
        await runBatch(keysArr, label, (items: Item[]) => api.decideBatch(action, items, category))
      ) {
        const set = new Set(keysArr);
        setQueue((q) => q.filter((a) => !set.has(rowKey(a))));
        sel.clear();
        onMutated();
      }
    };

  return (
    <div>
      <ViewHead
        title="待审队列"
        count={total == null ? fmtN(queue.length) : fmtN(total)}
        desc={
          <>
            AI 与举报汇入的待裁决账号。<b className="text-destructive">拉黑</b> → 进公榜 ·{" "}
            <b className="text-success">白名单</b> → 永不再扫 · 驳回 / 移除 → 不公开。
          </>
        }
      />

      <FilterPanel
        mode="queue"
        filters={filters}
        sort={sort}
        sortOptions={QUEUE_SORT_OPTIONS}
        searchPlaceholder="handle / uid / 推文内容 / 判定理由"
        onApply={apply}
        quick={{ key: "verdict", allLabel: "全部判定", options: VERDICT_CHIPS }}
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
                onClick={filterBatch("approve", `${ACTION_ZH.approve}并归类「${cat.zh}」`, cat.value)}
              >
                全部{ACTION_ZH.approve}并归类「{cat.zh}」
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={filterBatch("reject", ACTION_ZH.reject)}>
              全部{ACTION_ZH.reject}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={filterBatch("remove", ACTION_ZH.remove)}>
              全部{ACTION_ZH.remove}
            </DropdownMenuItem>
          </>
        }
      />

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
            <Button size="sm" variant="ghost" onClick={sel.clear}>
              清空选择
            </Button>
          </>
        }
      />

      {queue.length === 0 ? (
        <EmptyState>没有符合条件的待审账号。AI 与举报会持续汇入这里。</EmptyState>
      ) : (
        <ListShell>
          {queue.map((a, i) => {
            const label = a.verdict_label || "uncertain";
            return (
              <AccountRow
                key={rowKey(a)}
                a={a}
                label={{ text: verdictZh(label), tone: VERDICTS[label]?.tone || "muted" }}
                selected={sel.sel.has(rowKey(a))}
                onToggle={(shift) => sel.toggle(i, shift)}
                confidence={Math.round((a.confidence || 0) * 100)}
                reporters={a.reporters || 0}
                subExtra={
                  <>
                    <span
                      title={new Date(a.last_scored || a.published_at || 0).toLocaleString("zh-CN")}
                    >
                      · 入队 {agoZh(a.last_scored || a.published_at)}
                    </span>
                    {a.category && <span title="spam 类别"> · 类别 {categoryZh(a.category)}</span>}
                  </>
                }
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
                          找同类 ▾
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
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
      <ListPager
        page={page}
        pageCount={pageCount}
        total={total}
        loaded={queue.length}
        onPage={goPage}
      />
    </div>
  );
}
