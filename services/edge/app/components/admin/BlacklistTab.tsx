import { useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Account, api, type Item, rowKey } from "@/lib/adminApi";
import {
  ago,
  blacklistDecisionSource,
  CATEGORIES,
  categoryZh,
  fmtN,
  verdictZh,
  VERDICTS,
} from "@/lib/format";
import { runBatch } from "@/lib/runBatch";
import { useListData } from "@/lib/useListData";
import { useSelection } from "@/lib/useSelection";
import { AccountRow } from "./AccountRow";
import { BatchBar } from "./BatchBar";
import { useConfirm } from "./confirm";
import { EmptyState, ListShell, MoreFoot } from "./MoreFoot";
import { SearchBar } from "./SearchBar";
import { ViewHead } from "./ViewHead";

const DECISION_TONE = {
  human: "border-success/30 bg-success/10 text-success",
  agent: "border-violet/30 bg-violet/10 text-violet",
  rule: "border-warning/30 bg-warning/10 text-warning",
  muted: "border-border bg-muted text-muted-foreground",
} as const;

export function BlacklistTab({ onAuth, onMutated }: { onAuth: () => void; onMutated: () => void }) {
  const confirm = useConfirm();
  const fetcher = useCallback(
    (cursor: number | null, search: string, sort: string) => {
      const parts = ["limit=100"];
      if (cursor) parts.push(`before=${cursor}`);
      if (search) parts.push(`q=${encodeURIComponent(search)}`);
      if (sort) parts.push(`sort=${encodeURIComponent(sort)}`);
      return api.blacklist(`?${parts.join("&")}`);
    },
    [],
  );
  const { list, search, sort, hasMore, runSearch, changeSort, reload, loadMore } = useListData(
    fetcher,
    "time_desc",
    onAuth,
  );
  const keys = list.map(rowKey);
  const sel = useSelection(keys);

  const decide = async (a: Account, action: string) => {
    try {
      await api.decide(a.handle, a.x_user_id, action);
      reload();
      onMutated();
    } catch {
      toast.error("操作失败");
    }
  };

  const batch = (target: string, label: string, variant: "destructive" | "success" | "default") =>
    async () => {
      const keysArr = [...sel.sel];
      const ok = await confirm({
        title: `批量${label}`,
        body: (
          <p>
            对已选 <b>{keysArr.length}</b> 条执行「{label}」？
          </p>
        ),
        okLabel: `${label} ${keysArr.length} 条`,
        okVariant: variant,
      });
      if (!ok) return;
      const call = (items: Item[]) => api.decideBatch(target, items);
      if (await runBatch(keysArr, label, call)) {
        sel.clear();
        reload();
        onMutated();
      }
    };

  const batchCategorize = (category: string, zh: string) => async () => {
    const keysArr = [...sel.sel];
    const ok = await confirm({
      title: "批量归类",
      body: (
        <p>
          将已选 <b>{keysArr.length}</b> 条的分类设为「{zh}」？不改变公榜状态，仅更新分类。
        </p>
      ),
      okLabel: `归类「${zh}」 ${keysArr.length} 条`,
      okVariant: "default",
    });
    if (!ok) return;
    if (await runBatch(keysArr, `归类「${zh}」`, (items: Item[]) => api.categoryBatch(category, items))) {
      sel.clear();
      reload();
      onMutated();
    }
  };

  return (
    <div>
      <ViewHead
        title="黑名单"
        count={fmtN(list.length) + (hasMore ? "+" : "")}
        desc={
          <>
            已公榜账号，在{" "}
            <a href="/list" target="_blank" rel="noreferrer noopener">
              /list
            </a>{" "}
            公开可见。误判可直接 → <b>白名单</b> 或 <b>驳回</b>。
          </>
        }
      />
      <SearchBar
        placeholder="handle / uid / 显示名 / 证据 / 理由"
        search={search}
        sort={sort}
        onSearch={runSearch}
        onSort={changeSort}
      />
      <BatchBar
        selected={sel.selected}
        visible={list.length}
        allChecked={sel.allChecked}
        indeterminate={sel.indeterminate}
        onToggleAll={sel.toggleAll}
        actions={
          <>
            <Button
              size="sm"
              className="bg-success text-success-foreground hover:bg-success/90"
              onClick={batch("whitelist", "白名单", "success")}
            >
              批量白名单
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  批量归类 ▾
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
            <Button size="sm" variant="outline" onClick={batch("reject", "驳回", "default")}>
              批量驳回（不公开）
            </Button>
            <Button size="sm" variant="outline" onClick={batch("remove", "移除", "destructive")}>
              批量移除
            </Button>
            <Button size="sm" variant="ghost" onClick={sel.clear}>
              清空选择
            </Button>
          </>
        }
      />
      {list.length === 0 ? (
        <EmptyState>公榜还没有账号。在「待审队列」点拉黑把判定结果送进公榜。</EmptyState>
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
                      · 已公榜 {ago(a.published_at)}
                    </span>
                    {a.category && <span title={`分类：${a.category}`}> · {categoryZh(a.category)}</span>}
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
                      移到白名单
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(a, "reject")}>
                      驳回
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(a, "remove")}>
                      移除
                    </Button>
                  </>
                }
              />
            );
          })}
        </ListShell>
      )}
      <MoreFoot
        hasMore={hasMore}
        onMore={loadMore}
        text={`已加载 ${fmtN(list.length)} 条${hasMore ? "" : "（全部）"}`}
      />
    </div>
  );
}
