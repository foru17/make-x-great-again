import { Lock, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AgentTab } from "@/components/admin/AgentTab";
import { BlacklistTab } from "@/components/admin/BlacklistTab";
import { ConfirmProvider } from "@/components/admin/confirm";
import { LogTab } from "@/components/admin/LogTab";
import { QueueTab } from "@/components/admin/QueueTab";
import { RulesTab } from "@/components/admin/RulesTab";
import { ThemeToggle } from "@/components/admin/ThemeToggle";
import { WhitelistRequestsTab } from "@/components/admin/WhitelistRequestsTab";
import { WhitelistTab } from "@/components/admin/WhitelistTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, AuthError, clearToken, getToken, type Stats, setToken } from "@/lib/adminApi";
import { fmtN } from "@/lib/format";

function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-9 text-center shadow-lg">
        <div className="mx-auto mb-5 flex size-10 items-center justify-center rounded-lg border bg-muted">
          <Lock className="size-[18px]" />
        </div>
        <h2 className="text-[17px] font-semibold">需要维护者令牌</h2>
        <p className="mb-5 mt-2 text-[13px] leading-relaxed text-muted-foreground">
          把 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">ADMIN_TOKEN</code>{" "}
          粘进来，仅在当前标签页会话中保存；关闭标签页后自动清除。
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!val.trim()) return;
            setToken(val.trim());
            onUnlock();
          }}
        >
          <Input
            aria-label="管理员令牌"
            type="password"
            autoComplete="off"
            placeholder="xss_…"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            autoFocus
            className="font-mono"
          />
          <Button type="submit">解锁</Button>
        </form>
        <div className="mt-5 flex justify-center">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { v: "queue", label: "待审队列", count: (s: Stats) => s.queue },
  { v: "blacklist", label: "黑名单", count: (s: Stats) => s.blacklist },
  { v: "whitelist", label: "白名单", count: (s: Stats) => s.whitelist },
  { v: "wlRequests", label: "白名单申请", count: null },
  { v: "agentPending", label: "AI 待定", count: (s: Stats) => s.agent_pending },
  { v: "agentBL", label: "AI 拟拉黑", count: (s: Stats) => s.agent_blacklist },
  { v: "agentWL", label: "AI 拟加白", count: (s: Stats) => s.agent_whitelist },
  { v: "rules", label: "关键字规则", count: null },
  { v: "log", label: "审计日志", count: null },
];

function Console({ onAuth }: { onAuth: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState(() => {
    const h = typeof location !== "undefined" ? location.hash.replace("#", "") : "";
    return TABS.some((t) => t.v === h) ? h : "queue";
  });

  const refreshStats = useCallback(() => {
    api
      .stats()
      .then(setStats)
      .catch((e) => {
        if (e instanceof AuthError) onAuth();
      });
  }, [onAuth]);

  useEffect(() => {
    refreshStats();
    const id = setInterval(refreshStats, 60000);
    return () => clearInterval(id);
  }, [refreshStats]);

  const tabProps = { onAuth, onMutated: refreshStats };

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-6 pb-20 sm:px-7">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-5">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ShieldCheck className="size-5" />
            MXGA · 审核台 · 守门员
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            守门员才能进 · <b className="text-destructive">拉黑</b>=进公榜 ·{" "}
            <b className="text-success">白名单</b>=永不扫 · 驳回/移除=不公开
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 text-success">
            <span className="size-1.5 rounded-full bg-success" /> 已认证
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // 退出 must actually drop the stored credential — without this a
              // refresh walks straight back into the console.
              clearToken();
              onAuth();
            }}
          >
            退出
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5 h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.v} value={t.v} className="data-[state=active]:bg-card">
              {t.label}
              {t.count && stats && (
                <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">
                  {fmtN(t.count(stats))}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="queue"><QueueTab {...tabProps} /></TabsContent>
        <TabsContent value="blacklist"><BlacklistTab {...tabProps} /></TabsContent>
        <TabsContent value="whitelist"><WhitelistTab {...tabProps} /></TabsContent>
        <TabsContent value="wlRequests"><WhitelistRequestsTab {...tabProps} /></TabsContent>
        <TabsContent value="agentPending"><AgentTab bucket="pending" {...tabProps} /></TabsContent>
        <TabsContent value="agentBL"><AgentTab bucket="blacklist" {...tabProps} /></TabsContent>
        <TabsContent value="agentWL"><AgentTab bucket="whitelist" {...tabProps} /></TabsContent>
        <TabsContent value="rules"><RulesTab {...tabProps} /></TabsContent>
        <TabsContent value="log"><LogTab onAuth={onAuth} /></TabsContent>
      </Tabs>

      <div className="mt-6 flex justify-between text-[11.5px] text-muted-foreground">
        <span />
        <span>v2 · /admin</span>
      </div>
    </div>
  );
}

export function AdminPage() {
  const [authed, setAuthed] = useState(() => !!getToken());
  return (
    <TooltipProvider delayDuration={200}>
      <ConfirmProvider>
        {authed ? <Console onAuth={() => setAuthed(false)} /> : <Gate onUnlock={() => setAuthed(true)} />}
        <Toaster position="bottom-right" />
      </ConfirmProvider>
    </TooltipProvider>
  );
}
