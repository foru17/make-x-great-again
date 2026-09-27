import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Account, api, type Item, rowKey } from "@/lib/adminApi";
import { agoZh, fmtN } from "@/lib/format";
import { runBatch } from "@/lib/runBatch";
import { useListData } from "@/lib/useListData";
import { useSelection } from "@/lib/useSelection";
import { AccountRow } from "./AccountRow";
import { BatchBar } from "./BatchBar";
import { useConfirm } from "./confirm";
import { EmptyState, ListShell, MoreFoot } from "./MoreFoot";
import { SearchBar } from "./SearchBar";
import { ViewHead } from "./ViewHead";

function note(a: Account): string {
  try {
    const rs = JSON.parse(a.reasons || "[]");
    return Array.isArray(rs)
      ? rs.filter((x: string) => x && x !== "whitelisted by admin").join(" · ")
      : "";
  } catch {
    return "";
  }
}

function AddDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [uid, setUid] = useState("");
  const [n, setN] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = handle.replace(/^@+/, "").trim();
    if (!h) return;
    try {
      const j = await api.whitelistAdd(h, uid || undefined, n);
      if (!j.ok) throw new Error(j.error);
      toast.success("已加入白名单");
      setOpen(false);
      setHandle("");
      setUid("");
      setN("");
      onAdded();
    } catch {
      toast.error("加入失败");
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        + 加入白名单
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>加入白名单</DialogTitle>
          <DialogDescription>白名单账号不会再被 AI 扫描，被举报也会被吞掉。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>X handle（不带 @）</Label>
            <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="someuser" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>X 数字 user id</Label>
            <Input value={uid} onChange={(e) => setUid(e.target.value)} placeholder="1234567890" />
            <p className="text-[11px] text-muted-foreground">可选，但强烈建议填写（handle 会被改）</p>
          </div>
          <div className="space-y-1.5">
            <Label>备注（仅维护者可见）</Label>
            <Input value={n} onChange={(e) => setN(e.target.value)} placeholder="核心维护者 / 误判申诉" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" size="sm" className="bg-success text-success-foreground hover:bg-success/90">
              加入白名单
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WhitelistTab({ onAuth, onMutated }: { onAuth: () => void; onMutated: () => void }) {
  const confirm = useConfirm();
  const fetcher = useCallback((cursor: number | null, search: string, sort: string) => {
    const parts = ["limit=100"];
    if (cursor) parts.push(`before=${cursor}`);
    if (search) parts.push(`q=${encodeURIComponent(search)}`);
    if (sort) parts.push(`sort=${encodeURIComponent(sort)}`);
    return api.whitelist(`?${parts.join("&")}`);
  }, []);
  const { list, search, sort, hasMore, runSearch, changeSort, reload, loadMore } = useListData(
    fetcher,
    "time_desc",
    onAuth,
  );
  const keys = list.map(rowKey);
  const sel = useSelection(keys);

  const remove = async (a: Account) => {
    const ok = await confirm({
      title: "移出白名单",
      body: (
        <p>
          确认把 <b>@{a.handle}</b> 移出白名单？该账号将变回普通可扫描状态。
        </p>
      ),
      okLabel: "移出白名单",
      okVariant: "destructive",
    });
    if (!ok) return;
    try {
      await api.whitelistRemove(a.handle, a.x_user_id);
      reload();
      onMutated();
    } catch {
      toast.error("操作失败");
    }
  };

  const batchRemove = async () => {
    const keysArr = [...sel.sel];
    const ok = await confirm({
      title: "批量移出白名单",
      body: (
        <p>
          确认把 <b>{keysArr.length}</b> 个账号移出白名单？它们会变回「已驳回」——不公开，但可以再被扫描。
        </p>
      ),
      okLabel: `移出 ${keysArr.length} 条`,
      okVariant: "destructive",
    });
    if (!ok) return;
    if (await runBatch(keysArr, "移出白名单", (items: Item[]) => api.whitelistRemoveBatch(items))) {
      sel.clear();
      reload();
      onMutated();
    }
  };

  return (
    <div>
      <ViewHead
        title="白名单"
        count={fmtN(list.length) + (hasMore ? "+" : "")}
        desc="白名单账号不会再被 AI 扫描，被举报也会被吞掉。"
        actions={<AddDialog onAdded={() => { reload(); onMutated(); }} />}
      />
      <SearchBar
        placeholder="handle / uid / 显示名 / 备注"
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
            <Button size="sm" variant="outline" onClick={batchRemove}>
              批量移出白名单
            </Button>
            <Button size="sm" variant="ghost" onClick={sel.clear}>
              清空选择
            </Button>
          </>
        }
      />
      {list.length === 0 ? (
        <EmptyState>
          没有符合条件的白名单账号。点右上角「+ 加入白名单」，或在「待审队列」对某行点白名单。
        </EmptyState>
      ) : (
        <ListShell>
          {list.map((a, i) => (
            <AccountRow
              key={rowKey(a)}
              a={a}
              label={{ text: "白名单", tone: "success" }}
              selected={sel.sel.has(rowKey(a))}
              onToggle={(shift) => sel.toggle(i, shift)}
              subExtra={
                <>
                  <span title={new Date(a.last_decided_at || a.last_scored || 0).toLocaleString("zh-CN")}>
                    · 入白名单 {agoZh(a.last_decided_at || a.last_scored)}
                  </span>
                  {note(a) && <span>· {note(a)}</span>}
                </>
              }
              actions={
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(a)}>
                  移出白名单
                </Button>
              }
            />
          ))}
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
