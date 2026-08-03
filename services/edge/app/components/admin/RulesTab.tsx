import { useCallback, useEffect, useState } from "react";
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
import { api, AuthError, type Rule } from "@/lib/adminApi";
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

export function RulesTab({ onAuth, onMutated }: { onAuth: () => void; onMutated: () => void }) {
  const confirm = useConfirm();
  const [rules, setRules] = useState<Rule[]>([]);
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

  const applyAll = async (scope: "queue" | "all") => {
    const ok = await confirm({
      title: scope === "all" ? "全量扫描（队列 + 已判正常）" : "扫所有规则到队列",
      body:
        scope === "all" ? (
          <p>
            用全部启用规则扫一遍待审队列 <b>和已判正常（auto_legit）的账号</b>。
            已判正常的命中不直接上榜，回到待审队列由你复核；队列命中按各自 action 落地。
          </p>
        ) : (
          <p>用全部启用规则扫一遍当前待审队列，命中按各自 action 落地。</p>
        ),
      okLabel: "开始扫描",
    });
    if (!ok) return;
    const id = toast.loading("应用规则中…");
    try {
      const j = await api.rulesApply(scope);
      if (!j.ok) throw new Error();
      const extra =
        scope === "all" ? `（其中已判正常回捞 ${j.legitMatched ?? 0} 条）` : "";
      // Either partition can hit its candidate cap on a very broad rule set —
      // say so, because the fix is simply to run the sweep again.
      const cut = j.queueTruncated || j.legitTruncated ? "，候选超上限已截断，可再扫一轮" : "";
      toast.success(`命中 ${j.matched} 条${extra}${cut}`, { id });
      load();
      onMutated();
    } catch {
      toast.error("失败", { id });
    }
  };

  return (
    <div>
      <ViewHead
        title="关键字规则"
        count={fmtN(rules.length)}
        desc="规则在判定阶段先于 AI 匹配。命中 → 跳过 AI，按动作落地（默认进公榜），并按规则的 spam 类别标注。改规则 ≤30s 全局生效。"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => applyAll("queue")}>扫队列</Button>
            <Button size="sm" variant="outline" onClick={() => applyAll("all")}>全量扫描</Button>
            <Button
              size="sm"
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
                      <Switch checked={enabled} onCheckedChange={(v) => toggle(r, v)} />
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
                          onClick={() => {
                            setEditing(r);
                            setDialogOpen(true);
                          }}
                        >
                          编辑
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del(r)}>
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
    </div>
  );
}
