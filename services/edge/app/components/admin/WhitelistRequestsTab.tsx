import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FeedAvatar } from "@/components/site/FeedAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthError, api, type WhitelistRequest } from "@/lib/adminApi";
import { agoZh, fmtN, statusZh, verdictZh, xUrl } from "@/lib/format";
import { useSelection } from "@/lib/useSelection";
import { cn } from "@/lib/utils";
import { omitResolvedRequests } from "@/lib/whitelistRequests";
import { BatchBar } from "./BatchBar";
import { useConfirm } from "./confirm";
import { EmptyState, ListShell } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

/** Statuses that mean "this applicant is currently treated as spam" — an
 *  approval would pull a listed account off the public blacklist, so the row
 *  gets a loud red warning instead of a quiet chip. */
const LISTED_STATUSES = new Set(["human_confirmed", "agent_blacklist"]);

const isListed = (r: WhitelistRequest) => !!r.account_status && LISTED_STATUSES.has(r.account_status);

function AccountStateChip({ r }: { r: WhitelistRequest }) {
  if (!r.account_status) {
    return <Badge variant="outline" className="text-muted-foreground">库中无记录</Badge>;
  }
  if (isListed(r)) {
    return (
      <Badge variant="destructive">
        ⚠ 已在黑名单 · {verdictZh(r.account_verdict_label ?? undefined)}
      </Badge>
    );
  }
  if (r.account_status === "whitelisted") {
    return <Badge className="bg-success text-success-foreground">已是白名单</Badge>;
  }
  return (
    <Badge variant="secondary" title={r.account_status}>
      {statusZh(r.account_status)}
      {r.account_verdict_label ? ` · ${verdictZh(r.account_verdict_label)}` : ""}
    </Badge>
  );
}

export function WhitelistRequestsTab({
  onAuth,
  onMutated,
}: {
  onAuth: () => void;
  onMutated: () => void;
}) {
  const confirm = useConfirm();
  const [list, setList] = useState<WhitelistRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<number>>(() => new Set());

  const load = useCallback(() => {
    setLoading(true);
    api
      .whitelistRequests("pending")
      .then((j) => setList(j.list))
      .catch((e) => {
        if (e instanceof AuthError) onAuth();
        else toast.error("加载失败");
      })
      .finally(() => setLoading(false));
  }, [onAuth]);

  useEffect(() => void load(), [load]);

  // Row key is the request id — an applicant can only have one pending row,
  // but ids are what the decide endpoints take.
  const keys = useMemo(() => list.map((r) => String(r.id)), [list]);
  const sel = useSelection(keys);

  /** Approve/reject a set of requests one call at a time (the API is per-id),
   *  with the same toast-progress shape as the other tabs' batch actions. */
  const decideMany = async (targets: WhitelistRequest[], action: "approve" | "reject") => {
    const verb = action === "approve" ? "批准" : "驳回";
    const targetIds = targets.map((request) => request.id);
    setBusyIds((current) => new Set([...current, ...targetIds]));
    const id = toast.loading(`批量${verb} 0/${targets.length}`);
    const completedIds: number[] = [];
    let authFailed = false;
    for (const request of targets) {
      try {
        await (action === "approve"
          ? api.whitelistRequestApprove(request.id)
          : api.whitelistRequestReject(request.id));
        completedIds.push(request.id);
        if (targets.length > 1) {
          toast.loading(`批量${verb} ${completedIds.length}/${targets.length}`, { id });
        }
      } catch (error) {
        if (error instanceof AuthError) {
          authFailed = true;
          onAuth();
          break;
        }
      }
    }
    setList((current) => omitResolvedRequests(current, completedIds));
    setBusyIds((current) => {
      const next = new Set(current);
      for (const targetId of targetIds) next.delete(targetId);
      return next;
    });
    sel.clear();
    if (completedIds.length > 0) onMutated();

    if (authFailed) {
      toast.dismiss(id);
    } else if (completedIds.length === targets.length) {
      toast.success(
        targets.length === 1
          ? `已${verb} @${targets[0].handle}`
          : `已${verb} ${completedIds.length} 条`,
        { id },
      );
    } else {
      toast.error(`${verb}未全部完成（已完成 ${completedIds.length}/${targets.length}）`, { id });
    }
  };

  /** Approving a listed account pulls it off the public blacklist — always
   *  confirm, and say how many of the targets that applies to. */
  const confirmThenDecide = async (targets: WhitelistRequest[], action: "approve" | "reject") => {
    if (!targets.length) return;
    const listed = targets.filter(isListed);
    const one = targets.length === 1 ? targets[0] : null;
    if (action === "approve" && listed.length > 0) {
      const ok = await confirm({
        title: one ? "该账号已在公共黑名单" : "选中的申请里有公榜账号",
        body: one ? (
          <p>
            <b>@{one.handle}</b> 目前是{" "}
            <b className="text-destructive">{statusZh(one.account_status)}</b>
            ，批准会把它从公榜拉到白名单（永不再扫）。确认继续？
          </p>
        ) : (
          <p>
            确认批准这 <b>{targets.length}</b> 条申请？
            <br />
            <b className="text-destructive">其中 {listed.length} 条已在公共黑名单</b>
            ，批准会把它们从公榜拉到白名单（永不再扫）。
          </p>
        ),
        okLabel: one ? "仍然批准" : `批准 ${targets.length} 条`,
        okVariant: "destructive",
      });
      if (!ok) return;
    } else if (!one) {
      const ok = await confirm({
        title: action === "approve" ? "批量批准申请" : "批量驳回申请",
        body: (
          <p>
            确认{action === "approve" ? "批准" : "驳回"}选中的 <b>{targets.length}</b> 条申请？
            {action === "approve"
              ? "批准 = 这些 X 账号进白名单、永不再扫。"
              : "驳回只关闭申请，不改账号状态。"}
          </p>
        ),
        okLabel: `${action === "approve" ? "批准" : "驳回"} ${targets.length} 条`,
        okVariant: action === "approve" ? undefined : "destructive",
      });
      if (!ok) return;
    }
    await decideMany(targets, action);
  };

  const selected = list.filter((r) => sel.sel.has(String(r.id)));

  return (
    <div>
      <ViewHead
        title="白名单申请"
        count={fmtN(list.length)}
        desc="扩展用户用 GitHub 身份提交的自助白名单申请（账号注册满 90 天才能提交）。批准 = 该 X 账号进白名单、永不再扫；驳回只关闭申请。"
      />
      {list.length > 0 && (
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
                disabled={busyIds.size > 0}
                onClick={() => confirmThenDecide(selected, "approve")}
              >
                批量批准
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={busyIds.size > 0}
                onClick={() => confirmThenDecide(selected, "reject")}
              >
                批量驳回
              </Button>
              <Button size="sm" variant="ghost" onClick={sel.clear}>
                清空选择
              </Button>
            </>
          }
        />
      )}
      {loading ? (
        <EmptyState>加载中…</EmptyState>
      ) : list.length === 0 ? (
        <EmptyState>没有待审的白名单申请。</EmptyState>
      ) : (
        <ListShell>
          {list.map((r, i) => (
            <div
              key={r.id}
              aria-busy={busyIds.has(r.id)}
              // Same grid as AccountRow: checkbox + avatar + body, with the
              // actions dropping to their own row below the sm breakpoint so
              // they never sit on top of the status chip at 390px.
              className={cn(
                "grid grid-cols-[auto_auto_1fr] items-center gap-x-3 gap-y-2 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/50",
                "sm:grid-cols-[auto_auto_1fr_auto]",
                sel.sel.has(String(r.id)) && "bg-primary/5",
              )}
            >
              <Checkbox
                checked={sel.sel.has(String(r.id))}
                onClick={(e) => sel.toggle(i, (e as React.MouseEvent).shiftKey)}
                aria-label={`选中 @${r.handle}`}
              />
              <FeedAvatar handle={r.handle} url={r.avatar_url ?? undefined} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={xUrl(r.handle)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[13.5px] font-semibold hover:underline"
                  >
                    @{r.handle}
                  </a>
                  {r.x_user_id && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {r.x_user_id}
                    </span>
                  )}
                  <AccountStateChip r={r} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                  <span>GH 账龄 {r.gh_age_days != null ? `${fmtN(r.gh_age_days)} 天` : "—"}</span>
                  <span title={new Date(r.created_at).toLocaleString("zh-CN")}>
                    申请 {agoZh(r.created_at)}
                  </span>
                  {r.note && <span className="text-foreground/80">“{r.note}”</span>}
                </div>
              </div>
              <div className="col-span-full flex shrink-0 flex-wrap justify-end gap-2 sm:col-span-1">
                {busyIds.has(r.id) && (
                  <span className="self-center text-[12px] text-muted-foreground" aria-live="polite">
                    处理中…
                  </span>
                )}
                <Button
                  size="sm"
                  className="bg-success text-success-foreground hover:bg-success/90"
                  disabled={busyIds.has(r.id)}
                  onClick={() => confirmThenDecide([r], "approve")}
                >
                  批准
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={busyIds.has(r.id)}
                  onClick={() => confirmThenDecide([r], "reject")}
                >
                  驳回
                </Button>
              </div>
            </div>
          ))}
        </ListShell>
      )}
    </div>
  );
}
