import { ExternalLink } from "lucide-react";
import { FeedAvatar } from "@/components/site/FeedAvatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Account } from "@/lib/adminApi";
import { accountChips, actorBadge, displayName, edgeClass, xUrl } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACTOR_TONE: Record<string, string> = {
  human: "border-border bg-accent text-foreground",
  agent: "border-violet/30 bg-violet/10 text-violet",
  rule: "border-warning/30 bg-warning/10 text-warning",
  sys: "text-muted-foreground",
};

// How the row entered the queue. Only USER-driven origins get a chip — an
// automated AI/rule scan is the unmarked default, so a maintainer can tell at
// a glance which pending rows were flagged by a real person.
const SOURCE_CHIP: Record<string, { text: string; title: string }> = {
  report: { text: "用户举报", title: "由 GitHub 授权用户手动举报为 spam（/v1/report）" },
  block: { text: "用户屏蔽", title: "由用户在 X 上确认屏蔽后同步（/v1/confirm）" },
};

export function AccountRow({
  a,
  label,
  selected,
  onToggle,
  confidence,
  reporters,
  subExtra,
  below,
  actions,
}: {
  a: Account;
  label?: { text: string; tone: string };
  selected: boolean;
  onToggle: (shiftKey: boolean) => void;
  confidence?: number | null;
  reporters?: number | null;
  subExtra?: React.ReactNode;
  below?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const chips = accountChips(a);
  const actor = actorBadge(a.last_decided_by);
  const sourceChip = a.source ? SOURCE_CHIP[a.source] : undefined;
  const evidence = (a.evidence_text || "").replace(/\s+/g, " ").trim();
  const labelTone =
    label?.tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : label?.tone === "violet"
        ? "bg-violet/10 text-violet"
        : label?.tone === "success"
          ? "bg-success/10 text-success"
          : "bg-muted text-muted-foreground";

  return (
    <div
      className={cn(
        "relative grid grid-cols-[auto_auto_1fr] items-center gap-x-3 gap-y-2 border-b px-4 py-3 transition-colors last:border-0 hover:bg-accent/50",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:opacity-70 before:content-['']",
        "sm:grid-cols-[auto_auto_1fr_auto_auto_auto]",
        edgeClass(label?.text ? a.verdict_label || a.agent_label : a.verdict_label),
        selected && "bg-primary/5",
      )}
    >
      <Checkbox
        checked={selected}
        onClick={(e) => onToggle((e as React.MouseEvent).shiftKey)}
        aria-label={`选中 @${a.handle}`}
      />
      <FeedAvatar handle={a.handle} url={a.avatar_url} />
      <div className="col-span-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={xUrl(a.handle)}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[13.5px] font-semibold hover:text-info"
          >
            {displayName(a)}
          </a>
          {label && (
            <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", labelTone)}>
              {label.text}
            </span>
          )}
          {actor && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium",
                    ACTOR_TONE[actor.tone],
                  )}
                >
                  {actor.icon} {actor.text}
                </span>
              </TooltipTrigger>
              <TooltipContent>{actor.title}</TooltipContent>
            </Tooltip>
          )}
          {sourceChip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 rounded-full border border-info/30 bg-info/10 px-1.5 py-0.5 text-[11px] font-medium text-info">
                  {sourceChip.text}
                </span>
              </TooltipTrigger>
              <TooltipContent>{sourceChip.title}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-muted-foreground">
          <a
            href={xUrl(a.handle)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 hover:text-info"
          >
            @{a.handle}
            <ExternalLink className="size-3" />
          </a>
          {a.x_user_id && (
            <span className="rounded-sm border bg-card px-1.5 py-px font-mono text-[10.5px]">
              ID {a.x_user_id}
            </span>
          )}
          {subExtra}
        </div>
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((c, i) => (
              <span
                key={i}
                title={c.title}
                className="rounded-sm border bg-card px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground"
              >
                {c.text}
              </span>
            ))}
          </div>
        )}
        {evidence && (
          <p
            title={evidence}
            className="mt-1.5 line-clamp-2 max-w-2xl rounded-md border-l-2 border-border bg-muted/40 px-2.5 py-1.5 text-[12px] italic leading-relaxed text-foreground/80"
          >
            『{evidence}』
          </p>
        )}
        {below}
      </div>

      {confidence != null && (
        <div className="hidden items-baseline gap-1 sm:flex">
          <span className="font-mono text-lg font-bold tabular-nums">{confidence}%</span>
          <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground">把握</span>
        </div>
      )}
      {reporters != null && (
        <div className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">
          {reporters >= 3 ? (
            <Badge className="bg-success/10 text-success" variant="secondary">
              {reporters} 人 ✓
            </Badge>
          ) : (
            <span>{reporters} 人</span>
          )}
        </div>
      )}
      {actions && (
        <div className="col-span-full flex flex-wrap justify-end gap-1.5 sm:col-span-1">{actions}</div>
      )}
    </div>
  );
}
