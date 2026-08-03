import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuthError, api, type WhitelistRequest } from "@/lib/adminApi";
import { ago, fmtN, verdictZh, xUrl } from "@/lib/format";
import { omitResolvedRequests } from "@/lib/whitelistRequests";
import { useConfirm } from "./confirm";
import { EmptyState, ListShell } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

/** Statuses that mean "this applicant is currently treated as spam" — an
 *  approval would pull a listed account off the public blacklist, so the row
 *  gets a loud red warning instead of a quiet chip. */
const LISTED_STATUSES = new Set(["human_confirmed", "agent_blacklist"]);

function AccountStateChip({ r }: { r: WhitelistRequest }) {
  if (!r.account_status) {
    return <Badge variant="outline" className="text-muted-foreground">库中无记录</Badge>;
  }
  if (LISTED_STATUSES.has(r.account_status)) {
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
    <Badge variant="secondary">
      {r.account_status}
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

  const decide = async (r: WhitelistRequest, action: "approve" | "reject") => {
    const listed = r.account_status && LISTED_STATUSES.has(r.account_status);
    if (action === "approve" && listed) {
      const ok = await confirm({
        title: "该账号已在公共黑名单",
        body: (
          <p>
            <b>@{r.handle}</b> 目前是{" "}
            <b className="text-destructive">{r.account_status}</b>
            ，批准会把它从公榜拉到白名单（永不再扫）。确认继续？
          </p>
        ),
        okLabel: "仍然批准",
        okVariant: "destructive",
      });
      if (!ok) return;
    }
    setBusyIds((current) => new Set(current).add(r.id));
    try {
      await (action === "approve"
        ? api.whitelistRequestApprove(r.id)
        : api.whitelistRequestReject(r.id));
      toast.success(action === "approve" ? `已批准 @${r.handle}` : `已驳回 @${r.handle}`);
      setList((current) => omitResolvedRequests(current, [r.id]));
      onMutated();
    } catch (e) {
      if (e instanceof AuthError) onAuth();
      else toast.error("操作失败");
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(r.id);
        return next;
      });
    }
  };

  const approveAll = async () => {
    const listed = list.filter((r) => r.account_status && LISTED_STATUSES.has(r.account_status));
    const ok = await confirm({
      title: "批准全部申请",
      body: (
        <p>
          确认批准全部 <b>{list.length}</b> 条待审申请？
          {listed.length > 0 && (
            <>
              <br />
              <b className="text-destructive">其中 {listed.length} 条已在公共黑名单</b>
              ，批准会把它们拉到白名单。
            </>
          )}
        </p>
      ),
      okLabel: `批准 ${list.length} 条`,
      okVariant: listed.length > 0 ? "destructive" : undefined,
    });
    if (!ok) return;
    const targetIds = list.map((r) => r.id);
    setBusyIds(new Set(targetIds));
    let done = 0;
    const completedIds: number[] = [];
    for (const r of list) {
      try {
        await api.whitelistRequestApprove(r.id);
        done++;
        completedIds.push(r.id);
      } catch (e) {
        if (e instanceof AuthError) {
          onAuth();
          break;
        }
      }
    }
    setList((current) => omitResolvedRequests(current, completedIds));
    setBusyIds(new Set());
    toast.success(`已批准 ${done}/${list.length} 条`);
    if (completedIds.length > 0) onMutated();
  };

  return (
    <div>
      <ViewHead
        title="白名单申请"
        count={fmtN(list.length)}
        desc="扩展用户用 GitHub 身份提交的自助白名单申请（账号注册满 90 天才能提交）。批准 = 该 X 账号进白名单、永不再扫；驳回只关闭申请。"
        actions={
          list.length > 0 && (
            <Button size="sm" onClick={approveAll} disabled={busyIds.size > 0}>
              全部批准
            </Button>
          )
        }
      />
      {loading ? (
        <EmptyState>加载中…</EmptyState>
      ) : list.length === 0 ? (
        <EmptyState>没有待审的白名单申请。</EmptyState>
      ) : (
        <ListShell>
          {list.map((r) => (
            <div
              key={r.id}
              aria-busy={busyIds.has(r.id)}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
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
                    申请于 {ago(r.created_at)}前
                  </span>
                  {r.note && <span className="text-foreground/80">“{r.note}”</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {busyIds.has(r.id) && (
                  <span className="text-[12px] text-muted-foreground" aria-live="polite">
                    处理中…
                  </span>
                )}
                <Button
                  size="sm"
                  className="bg-success text-success-foreground hover:bg-success/90"
                  disabled={busyIds.has(r.id)}
                  onClick={() => decide(r, "approve")}
                >
                  批准
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={busyIds.has(r.id)}
                  onClick={() => decide(r, "reject")}
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
