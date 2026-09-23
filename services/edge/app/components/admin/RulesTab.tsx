import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  AuthError,
  type Rule,
  type RuleHitAccount,
  type RuleHitAgg,
} from "@/lib/adminApi";
import { agoZh, CATEGORIES, categoryZh, fmtN } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useConfirm } from "./confirm";
import { EmptyState } from "./MoreFoot";
import { ViewHead } from "./ViewHead";

const FIELD = [
  { value: "any", label: "任一字段" },
  { value: "handle", label: "Handle" },
  { value: "display_name", label: "显示名" },
  { value: "bio", label: "简介 Bio" },
  { value: "tweet", label: "推文内容" },
];
const ACTION = [
  { value: "blacklist", label: "拉黑 — 直接进公榜" },
  { value: "whitelist", label: "白名单 — 永不再扫" },
  { value: "reject", label: "驳回 — 不公开" },
];
const VERDICT = [
  { value: "spam", label: "垃圾营销" },
  { value: "porn_bot", label: "色情广告号" },
  { value: "likely_spam", label: "疑似垃圾" },
  { value: "uncertain", label: "不确定" },
  { value: "legit", label: "正常账号" },
];
const NO_CATEGORY = "__infer__";
/** Short label for the field a telemetry hit matched in. */
const RULE_FIELD_SHORT: Record<string, string> = {
  handle: "用户名",
  display_name: "昵称",
  bio: "简介",
  tweet: "推文",
};
const labelOf = (arr: { value: string; label: string }[], v: string) =>
  arr.find((o) => o.value === v)?.label || v;

/** One form, two dialogs: 新增 and 编辑 share it so a rule can be corrected
 *  after the fact instead of only deleted and retyped. `rule` = edit mode. */
function RuleDialog({
  rule,
  open,
  onOpenChange,
  onSaved,
}: {
  rule?: Rule;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const editing = !!rule;
  const [pattern, setPattern] = useState("");
  const [field, setField] = useState("any");
  const [action, setAction] = useState("blacklist");
  const [verdict, setVerdict] = useState("spam");
  const [category, setCategory] = useState(NO_CATEGORY);
  const [note, setNote] = useState("");

  // Refill from the rule every time the dialog opens, so editing rule A then
  // rule B doesn't show A's values.
  useEffect(() => {
    if (!open) return;
    setPattern(rule?.pattern ?? "");
    setField(rule?.field ?? "any");
    setAction(rule?.action ?? "blacklist");
    setVerdict(rule?.verdict_label ?? "spam");
    setCategory(rule?.category || NO_CATEGORY);
    setNote(rule?.note ?? "");
  }, [open, rule]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) return;
    const payload = {
      pattern: pattern.trim(),
      field,
      action,
      verdict_label: verdict,
      category: category === NO_CATEGORY ? null : category,
      note: note.trim() || undefined,
    };
    try {
      if (editing) {
        const j = await api.ruleUpdate(rule.id, payload);
        if (!j.ok) throw new Error(j.detail || j.error);
        toast.success(`已保存 rule#${rule.id}`);
      } else {
        const j = await api.ruleCreate({ ...payload, category: payload.category ?? undefined });
        if (!j.ok) throw new Error(j.detail || j.error);
        toast.success(`已创建 rule#${j.id}`);
      }
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(editing ? "保存失败" : "创建失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑规则 #${rule.id}` : "新增关键字规则"}</DialogTitle>
          <DialogDescription>
            pattern 为字面子串，大小写不敏感。命中 → 跳过 AI 判定，按动作落地。
            {editing && "　改动 ≤30s 全局生效，已命中的账号不回滚。"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>关键字 / 子串</Label>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="如：约炮、@target_dispatch、电报 @"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>匹配字段</Label>
              <Select value={field} onValueChange={setField}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{FIELD.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>命中动作</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{ACTION.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>判定标签</Label>
              <Select value={verdict} onValueChange={setVerdict}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{VERDICT.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>spam 类别</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>按判定标签推断</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.zh}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              决定客户端把这条 spam 标成什么。留空只有「色情广告号」能推断出类别，其它标签会留空等 AI 回填。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>备注（仅你可见）</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="比如：色情广告 tg 链路特征" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" size="sm">{editing ? "保存" : "创建"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 某条规则在用户端命中的账号明细 + 未收录账号的显式提审入口。 */
function RuleHitAccountsDialog({
  agg,
  onOpenChange,
  onPromoted,
}: {
  agg: RuleHitAgg | null;
  onOpenChange: (v: boolean) => void;
  onPromoted: () => void;
}) {
  const [rows, setRows] = useState<RuleHitAccount[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!agg) return;
    setRows(null);
    api
      .ruleHitAccounts(agg.pattern)
      .then((j) => setRows(j.list || []))
      .catch(() => setRows([]));
  }, [agg]);

  const unlisted = (rows ?? []).filter((r) => !r.listed);

  const promote = async () => {
    if (!agg || unlisted.length === 0) return;
    setBusy(true);
    try {
      const j = await api.ruleHitsPromote(
        agg.pattern,
        unlisted.slice(0, 100).map((r) => ({
          handle: r.handle,
          ...(r.x_user_id ? { xUserId: r.x_user_id } : {}),
        })),
      );
      if (!j.ok) throw new Error(j.error);
      toast.success(`已提审 ${j.queued} 个（跳过 ${j.skipped} 个已在库）`);
      const refreshed = await api.ruleHitAccounts(agg.pattern);
      setRows(refreshed.list || []);
      onPromoted();
    } catch {
      toast.error("提审失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!agg} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            规则 <code className="rounded bg-muted px-1 font-mono">{agg?.pattern}</code> 的用户端命中
          </DialogTitle>
          <DialogDescription>
            近 30 天扩展匿名回传的命中账号。提审只把「未收录」的账号送进待审队列，人工复核后才可能上榜——绝不直接发布。
          </DialogDescription>
        </DialogHeader>
        {rows === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">暂无回传记录</p>
        ) : (
          <div className="max-h-[320px] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead title="扩展匿名上报的命中处原文片段（服务端只校验含该规则关键词），未经人工核实">命中证据（客户端上报）</TableHead>
                  <TableHead className="w-16 text-right">命中</TableHead>
                  <TableHead className="w-20">最近</TableHead>
                  <TableHead className="w-20">状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.handle}>
                    <TableCell>
                      <a
                        href={`https://x.com/${r.handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm hover:underline"
                      >
                        @{r.handle}
                      </a>
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      {r.sample_text ? (
                        <span className="block truncate text-[12px]" title={r.sample_text}>
                          {r.field && (
                            <span className="mr-1.5 rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
                              {RULE_FIELD_SHORT[r.field] ?? r.field}
                            </span>
                          )}
                          {r.sample_text}
                        </span>
                      ) : (
                        <span className="text-[11.5px] text-muted-foreground">旧客户端，无原文</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{fmtN(r.hits)}</TableCell>
                    <TableCell className="text-[11.5px] tabular-nums text-muted-foreground">
                      {agoZh(r.last_seen)}
                    </TableCell>
                    <TableCell className="text-[11.5px]">
                      {r.listed ? (
                        <span className="text-muted-foreground">已在库</span>
                      ) : (
                        <span className="font-medium text-destructive">未收录</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button size="sm" disabled={busy || unlisted.length === 0} onClick={promote}>
            {busy ? "提审中…" : `提审未收录（${unlisted.length}）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 用户端（扩展）匿名回传的规则命中统计。只读统计 + 显式提审，与正式库隔离。 */
function RuleHitsSection({ onMutated }: { onMutated: () => void }) {
  const [aggs, setAggs] = useState<RuleHitAgg[] | null>(null);
  const [viewing, setViewing] = useState<RuleHitAgg | null>(null);

  const load = useCallback(() => {
    api
      .ruleHits()
      .then((j) => setAggs(j.list || []))
      .catch(() => setAggs([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!aggs || aggs.length === 0) return null; // telemetry尚未积累时不占版面

  return (
    <div className="mt-8">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">用户端命中回传（近 30 天）</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          扩展本地规则命中的匿名回传，存在独立统计表，不影响队列与公榜。点「查看账号」可把未收录的账号手动提进待审队列。
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>规则</TableHead>
              <TableHead className="w-20 text-right">命中</TableHead>
              <TableHead className="w-20 text-right">账号数</TableHead>
              <TableHead className="w-24">最近</TableHead>
              <TableHead className="w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aggs.map((a) => (
              <TableRow key={a.pattern}>
                <TableCell>
                  <span className="font-mono text-sm font-semibold">{a.pattern}</span>
                  {a.category && (
                    <span className="ml-2 text-[11.5px] text-muted-foreground">
                      {categoryZh(a.category)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{fmtN(a.hits)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{fmtN(a.accounts)}</TableCell>
                <TableCell className="text-[11.5px] tabular-nums text-muted-foreground">
                  {agoZh(a.last_seen)}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setViewing(a)}>
                    查看账号
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <RuleHitAccountsDialog
        agg={viewing}
        onOpenChange={(v) => !v && setViewing(null)}
        onPromoted={() => {
          load();
          onMutated();
        }}
      />
    </div>
  );
}

interface SweepProgress {
  scope: "queue" | "all";
  cursor?: import("@/lib/adminApi").RuleSweepCursor;
  scanned: number;
  textMatched: number;
  applied: number;
  protected: number;
  changed: number;
  requeued: number;
  complete: boolean;
  error?: string;
}

export function RulesTab({ onAuth, onMutated }: { onAuth: () => void; onMutated: () => void }) {
  const confirm = useConfirm();
  const [rules, setRules] = useState<Rule[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<SweepProgress>();
  const scanLock = useRef(false);
  // `undefined` rule + open = 新增；具体 rule = 编辑。
  const [editing, setEditing] = useState<Rule | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await api.rules();
      setRules(j.rules || []);
    } catch (e) {
      if (e instanceof AuthError) onAuth();
    }
  }, [onAuth]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (r: Rule, enabled: boolean) => {
    try {
      await api.ruleToggle(r.id, enabled);
      load();
    } catch {
      toast.error("操作失败");
    }
  };

  const del = async (r: Rule) => {
    const ok = await confirm({
      title: "删除规则",
      body: <p>确认删除规则 <code className="rounded bg-muted px-1">{r.pattern}</code>？已命中的账号不回滚。</p>,
      okLabel: "删除",
      okVariant: "destructive",
    });
    if (!ok) return;
    try {
      await api.ruleDelete(r.id);
      toast.success("已删除");
      load();
    } catch {
      toast.error("删除失败");
    }
  };

  const runSweep = async (start: SweepProgress) => {
    if (scanLock.current) return;
    scanLock.current = true;
    setScanning(true);
    let current = { ...start, error: undefined };
    setProgress(current);
    try {
      // Bound automatic work. The remaining cursor is kept for an explicit
      // continue action; surviving protected/false-positive rows cannot starve the tail.
      for (let round = 0; round < 10; round++) {
        const result = await api.rulesApply(current.scope, current.cursor);
        if (!result.ok) throw new Error("scan_failed");
        current = {
          ...current,
          cursor: result.nextCursor ?? undefined,
          scanned: current.scanned + (result.scanned?.queue ?? 0) + (result.scanned?.legit ?? 0),
          textMatched: current.textMatched + result.textMatched,
          applied: current.applied + result.matched,
          protected: current.protected + result.skippedProtected,
          changed: current.changed + result.skippedChanged,
          requeued: current.requeued + (result.legitMatched ?? 0),
          complete: result.complete,
        };
        setProgress(current);
        if (result.complete) break;
        if (!result.nextCursor) throw new Error("missing_cursor");
      }
      if (current.complete) toast.success(`扫描完成，实际处理 ${current.applied} 条记录`);
      else toast.info("扫描尚未完成，请继续扫描剩余记录。");
    } catch (error) {
      const changed = error instanceof Error && error.message === "HTTP 409";
      setProgress({ ...current, cursor: changed ? undefined : current.cursor,
        error: changed ? "规则或范围已改变，请重新开始扫描。" : "扫描中断；以下为已确认结果，失败批次可能已部分处理。可继续扫描核对剩余记录。" });
      toast.error("扫描未完成");
    } finally {
      scanLock.current = false;
      setScanning(false);
      load();
      onMutated();
    }
  };

  const applyAll = async (scope: "queue" | "all") => {
    if (scanLock.current) return;
    const ok = await confirm({
      title: scope === "all" ? "全量扫描" : "扫描全部待审",
      body: <div className="space-y-2">
        <p>使用全部启用规则，覆盖未初审、AI 待定、AI 建议拉黑和 AI 建议放行的记录。命中后按规则执行拉黑、白名单或驳回；粉丝达到 10 万或规则判定不属于垃圾类别时，不自动拉黑，保留待审并单独计数。</p>
        {scope === "all" && <p>另外检查此前 AI 已判正常或无法判断的记录：拉黑规则命中后先回待审复核。</p>}
        <p>人工终审记录保持不变。数据较多时会分段处理，直到明确显示“扫描完成”。</p>
      </div>,
      okLabel: "开始扫描",
    });
    if (!ok) return;
    await runSweep({ scope, scanned:0, textMatched:0, applied:0, protected:0, changed:0, requeued:0, complete:false });
  };

  return (
    <div>
      <ViewHead
        title="关键字规则"
        count={fmtN(rules.length)}
        desc="规则优先于 AI 初审。扫队列覆盖全部待审阶段；命中按规则动作处理，保护条件跳过会单独显示。新规则实时生效最长约 30 秒，历史记录需扫描。"
        actions={
          <>
            <Button size="sm" variant="outline" disabled={scanning} onClick={() => applyAll("queue")}>扫队列</Button>
            <Button size="sm" variant="outline" disabled={scanning} onClick={() => applyAll("all")}>全量扫描</Button>
            <Button
              size="sm"
              disabled={scanning}
              onClick={() => {
                setEditing(undefined);
                setDialogOpen(true);
              }}
            >
              + 新增规则
            </Button>
          </>
        }
      />
      {progress && <section aria-label="扫描结果" aria-live="polite" className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{scanning ? "扫描中…" : progress.complete ? "扫描完成" : "扫描未完成"} · {progress.scope === "all" ? "全部待审及此前已判正常 / 无法判断" : "全部待审（含 AI 已初审）"}</p>
          {!scanning && !progress.complete && !progress.error?.startsWith("规则或范围") &&
            <Button size="sm" variant="outline" onClick={() => runSweep(progress)}>继续扫描剩余记录</Button>}
        </div>
        <p className="mt-2 leading-relaxed">文字命中 {fmtN(progress.textMatched)} 条 · 实际处理 {fmtN(progress.applied)} 条 · 保护跳过 {fmtN(progress.protected)} 条 · 状态已变化 {fmtN(progress.changed)} 条</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">已检查 {fmtN(progress.scanned)} 条候选记录{progress.scope === "all" ? `，其中从此前 AI 判定中处理 ${fmtN(progress.requeued)} 条` : ""}。以上按存储记录计数，同一账号的多条记录分别处理。</p>
        {progress.protected > 0 && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">保护跳过：粉丝达到 10 万，或拉黑规则的判定不属于垃圾类别；这些记录仍保留待审。</p>}
        {progress.error && <p className="mt-2 text-destructive">{progress.error}</p>}
      </section>}
      <RuleDialog
        rule={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          load();
          onMutated();
        }}
      />
      {rules.length === 0 ? (
        <EmptyState>还没有规则。点右上角「+ 新增规则」加第一条。</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">启用</TableHead>
                <TableHead>规则</TableHead>
                <TableHead className="w-24 text-right">命中</TableHead>
                <TableHead className="w-24">最近</TableHead>
                <TableHead className="w-32 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => {
                const enabled = r.enabled === 1 || r.enabled === true;
                return (
                  <TableRow key={r.id} className={cn(!enabled && "opacity-55")}>
                    <TableCell>
                      <Switch disabled={scanning} checked={enabled} onCheckedChange={(v) => toggle(r, v)} />
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm font-semibold">{r.pattern}</div>
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {labelOf(FIELD, r.field)} · {labelOf(ACTION, r.action).split(" ")[0]} · 判{" "}
                        {labelOf(VERDICT, r.verdict_label)} · 类别{" "}
                        {r.category ? categoryZh(r.category) : "按判定推断"}
                        {r.note && <span className="italic"> · {r.note}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      <span className="text-base font-semibold">{fmtN(r.hit_count || 0)}</span>
                    </TableCell>
                    <TableCell className="text-[11.5px] tabular-nums text-muted-foreground">
                      {r.last_hit_at ? agoZh(r.last_hit_at) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={scanning}
                          onClick={() => {
                            setEditing(r);
                            setDialogOpen(true);
                          }}
                        >
                          编辑
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" disabled={scanning} onClick={() => del(r)}>
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <RuleHitsSection onMutated={onMutated} />
    </div>
  );
}
