import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Account, api, type Item, rowKey, SORT_OPTIONS } from "@/lib/adminApi";
import {
  ACTION_ZH,
  agoZh,
  batchZh,
  blacklistDecisionSource,
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
import { FilterPanel } from "./FilterPanel";
import { useFilterBatch } from "./useFilterBatch";
import { ListPager } from "./ListPager";
import { EmptyState, ListShell } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

const CATEGORY_CHIPS = [...CATEGORIES.map((c) => ({ value: c.value, zh: c.zh }))];

const DECISION_TONE = {
  human: "border-success/30 bg-success/10 text-success",
  agent: "border-violet/30 bg-violet/10 text-violet",
  rule: "border-warning/30 bg-warning/10 text-warning",
  muted: "border-border bg-muted text-muted-foreground",
} as const;

export function BlacklistTab({ onAuth, onMutated }: { onAuth: () => void; onMutated: () => void }) {
  const confirm = useConfirm();
  const { rows: list, filters, sort, page, total, pageCount, apply, goPage, reload } =
    useFilteredList<Account>(
      async (qs) => {
        const j = await api.blacklist(qs);
        return { rows: j.list, total: j.total };
      },
      "time_desc",
      onAuth,
    );

  const keys = list.map(rowKey);
  const sel = useSelection(keys);
  const filterBatch = useFilterBatch({
    scope: "blacklist",
    noun: "公榜账号",
    filters,
    onAuth,
    onDone: () => {
      sel.clear();
      reload();
      onMutated();
    },
  });

  const decide = async (a: Account, action: "whitelist" | "reject" | "remove") => {
    try {
      await api.decide(a.handle, a.x_user_id, action);
      reload();
      onMutated();
    } catch {
      toast.error("操作失败");
    }
  };

  const batch =
    (
      target: "whitelist" | "reject" | "remove",
      label: string,
      variant: "destructive" | "success" | "default",
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
      if (await runBatch(keysArr, label, (items: Item[]) => api.decideBatch(target, items))) {
        sel.clear();
        reload();
        onMutated();
      }
    };

  const batchCategorize = (category: string, zh: string) => async () => {
    const keysArr = [...sel.sel];
    const ok = await confirm({
      title: `批量${ACTION_ZH.categorize}`,
      body: (
        <p>
          把已选 <b>{keysArr.length}</b> 条的类别设为「{zh}」？只改 spam 类别，不改公榜状态。
        </p>
      ),
      okLabel: `归类「${zh}」 ${keysArr.length} 条`,
      okVariant: "default",
    });
    if (!ok) return;
    if (
      await runBatch(keysArr, `归类「${zh}」`, (items: Item[]) => api.categoryBatch(category, items))
    ) {
      sel.clear();
      reload();
      onMutated();
    }
  };

  return (
    <div>
      <ViewHead
        title="黑名单"
        count={total == null ? fmtN(list.length) : fmtN(total)}
        desc={
          <>
            已进公榜的账号，在{" "}
            <a href="/list" target="_blank" rel="noreferrer noopener">
              /list
            </a>{" "}
            公开可见。误判 → <b className="text-success">白名单</b> 或 <b>驳回</b>；类别决定客户端
            怎么标注这条 spam，可按筛选整批归类。
          </>
        }
      />

      <FilterPanel
        mode="blacklist"
        filters={filters}
        sort={sort}
        sortOptions={SORT_OPTIONS}
        searchPlaceholder="handle / uid / 推文内容 / 判定理由"
        onApply={apply}
        quick={{ key: "category", allLabel: "全部类别", options: CATEGORY_CHIPS }}
        batchMenu={
          <>
            {CATEGORIES.map((cat) => (
              <DropdownMenuItem
                key={cat.value}
                onClick={filterBatch("categorize", `归类「${cat.zh}」`, cat.value)}
              >
                全部归类「{cat.zh}」
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              className="text-success"
              onClick={filterBatch("whitelist", ACTION_ZH.whitelist)}
            >
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

      <BatchBar
        selected={sel.selected}
        visible={list.length}
        allChecked={sel.allChecked}
        indeterminate={sel.indeterminate}
        onToggleAll={sel.toggleAll}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  {batchZh("categorize")} ▾
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {CATEGORIES.map((cat) => (
                  <DropdownMenuItem key={cat.value} onClick={batchCategorize(cat.value, cat.zh)}>
                    {cat.zh}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              className="bg-success text-success-foreground hover:bg-success/90"
              onClick={batch("whitelist", ACTION_ZH.whitelist, "success")}
            >
              {batchZh("whitelist")}
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
            <Button size="sm" variant="ghost" onClick={sel.clear}>
              清空选择
            </Button>
          </>
        }
      />

      {list.length === 0 ? (
        <EmptyState>没有符合条件的公榜账号。在「待审队列」点拉黑把判定结果送进公榜。</EmptyState>
      ) : (
        <ListShell>
          {list.map((a, i) => {
            const label = a.verdict_label || "spam";
            const decision = blacklistDecisionSource(a);
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
                    <span title={new Date(a.published_at || 0).toLocaleString("zh-CN")}>
                      · 公榜 {agoZh(a.published_at)}
                    </span>
                    <span title="spam 类别，决定客户端怎么标注">
                      {" "}
                      · 类别 {a.category ? categoryZh(a.category) : "未归类"}
                    </span>
                  </>
                }
                below={
                  <div className="mt-2 flex max-w-2xl flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-semibold ${DECISION_TONE[decision.tone]}`}
                    >
                      {decision.label}
                    </span>
                    <span className="text-foreground/80">{decision.detail}</span>
                  </div>
                }
                actions={
                  <>
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
                          {ACTION_ZH.categorize} ▾
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {CATEGORIES.map((cat) => (
                          <DropdownMenuItem
                            key={cat.value}
                            onClick={async () => {
                              try {
                                await api.categoryBatch(cat.value, [
                                  { handle: a.handle, xUserId: a.x_user_id || undefined },
                                ]);
                                toast.success(`已归类「${cat.zh}」`);
                                reload();
                              } catch {
                                toast.error("操作失败");
                              }
                            }}
                          >
                            {cat.zh}
                          </DropdownMenuItem>
                        ))}
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
        loaded={list.length}
        onPage={goPage}
      />
    </div>
  );
}
