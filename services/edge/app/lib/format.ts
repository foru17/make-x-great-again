// Shared formatting + verdict metadata for the admin console.

export function fmtN(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString("zh-CN") : "—";
}

export function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

export function ago(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = Date.now() - ms;
  const s = Math.round(d / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function ymd(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function xUrl(handle: string | undefined): string {
  return `https://x.com/${encodeURIComponent(handle || "")}`;
}

export function displayName(a: { display_name?: string; handle?: string }): string {
  const n = (a.display_name || "").trim();
  return n || `@${a.handle || ""}`;
}

/** Verdict label → Chinese text + the token color used for the row edge/badge. */
export const VERDICTS: Record<string, { zh: string; tone: string }> = {
  spam: { zh: "垃圾营销", tone: "destructive" },
  porn_bot: { zh: "色情广告号", tone: "violet" },
  likely_spam: { zh: "疑似垃圾", tone: "destructive" },
  uncertain: { zh: "不确定", tone: "muted" },
  legit: { zh: "正常账号", tone: "success" },
};

export function verdictZh(label: string | undefined): string {
  return (label && VERDICTS[label]?.zh) || label || "uncertain";
}

export interface BlacklistDecisionLike {
  published_tier?: string | null;
  source?: string | null;
  reasons?: string | null;
  verdict_label?: string;
  confidence?: number;
  reporters?: number;
  last_decided_by?: string;
  agent_id?: string;
  agent_label?: string;
}

export interface BlacklistDecisionSource {
  label: string;
  detail: string;
  tone: "human" | "agent" | "rule" | "muted";
}

const RULE_FIELD_ZH: Record<string, string> = {
  bio: "简介",
  tweet: "发言",
  handle: "账号名",
  display_name: "显示名称",
};

function reasonStrings(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function keywordRuleDetail(raw: string | null | undefined): string {
  for (const reason of reasonStrings(raw)) {
    const match = reason.match(/matched keyword rule "([^"]+)" on ([a-z_]+)/i);
    if (match) {
      const field = RULE_FIELD_ZH[match[2]] || "账号内容";
      return `${field}命中“${match[1]}”，由规则自动加入黑名单`;
    }
  }
  return "账号内容命中已启用的关键字规则，自动加入黑名单";
}

/** Turn storage-level provenance into a maintainer-facing explanation. */
export function blacklistDecisionSource(a: BlacklistDecisionLike): BlacklistDecisionSource {
  if (a.published_tier === "rule" || (!a.published_tier && a.source === "auto_keyword")) {
    return { label: "关键字规则", detail: keywordRuleDetail(a.reasons), tone: "rule" };
  }
  if (a.published_tier === "mention" || (!a.published_tier && a.source === "auto_keyword_mention")) {
    return {
      label: "关联规则",
      detail: "发言中提及了已命中规则的账号，因此被关联加入黑名单",
      tone: "rule",
    };
  }
  if (a.published_tier === "ai") {
    const confidence = Math.round((a.confidence || 0) * 100);
    return {
      label: "AI 自动审查",
      detail: `AI 判断为${verdictZh(a.verdict_label)}，把握 ${confidence}%，自动加入黑名单`,
      tone: "agent",
    };
  }
  if (a.published_tier === "human" || a.last_decided_by?.startsWith("human:")) {
    if (a.agent_id || a.agent_label) {
      return {
        label: "人工确认",
        detail: "AI 提供初审建议，管理员复核后确认拉黑",
        tone: "human",
      };
    }
    if (a.source === "report" && (a.reporters || 0) > 0) {
      return {
        label: "人工确认",
        detail: `${a.reporters} 人举报后，由管理员审核确认拉黑`,
        tone: "human",
      };
    }
    if (a.source === "block") {
      return { label: "人工确认", detail: "用户主动屏蔽后，由管理员审核确认拉黑", tone: "human" };
    }
    return { label: "人工确认", detail: "管理员审核后确认加入黑名单", tone: "human" };
  }
  if (a.last_decided_by?.startsWith("agent:")) {
    return { label: "AI 审查", detail: "AI 根据账号信号给出拉黑结论", tone: "agent" };
  }
  return {
    label: "历史记录",
    detail: "旧记录没有保存完整的加入方式，可结合判定依据复核",
    tone: "muted",
  };
}

/** Spam category taxonomy — mirrors SPAM_CATEGORIES in src/index.ts and the
 *  extension's CATEGORY_ZH (extension/lib/category.ts). Order = menu order. */
export const CATEGORIES: { value: string; zh: string }[] = [
  { value: "porn", zh: "色情招揽" },
  { value: "crypto", zh: "币圈投放" },
  { value: "gambling", zh: "博彩推广" },
  { value: "resource", zh: "网盘资源" },
  { value: "marketing", zh: "营销引流" },
  { value: "other", zh: "其它" },
];

export function categoryZh(category: string | null | undefined): string {
  return (category && CATEGORIES.find((c) => c.value === category)?.zh) || "";
}

/** Tailwind classes for the 4px left edge of a row, by verdict tone. */
export function edgeClass(label: string | undefined): string {
  const tone = (label && VERDICTS[label]?.tone) || "muted";
  const classes: Record<string, string> = {
    destructive: "before:bg-destructive",
    violet: "before:bg-violet",
    success: "before:bg-success",
    muted: "before:bg-border",
  };
  return classes[tone] ?? classes.muted;
}

/** Build a "注册 / 粉丝 / 关注" chip list from an account row. */
export function accountChips(a: AccountLike): { text: string; title: string }[] {
  const chips: { text: string; title: string }[] = [];
  const raw = (a.account_created_at || "").trim();
  let created: { text: string; title: string } | null = null;
  if (raw) {
    const t = Date.parse(raw);
    created = !Number.isNaN(t)
      ? { text: ymd(t), title: new Date(t).toLocaleString("zh-CN") }
      : { text: raw, title: raw };
  } else {
    const age = num(a.account_age_days);
    if (age != null) {
      const base =
        num(a.last_scored) || num(a.published_at) || num(a.agent_at) || Date.now();
      created = { text: `约 ${ymd(base - age * 86400000)}`, title: `按账龄 ${fmtN(age)} 天估算` };
    }
  }
  if (created?.text) chips.push({ text: `注册 ${created.text}`, title: created.title });
  const followers = num(a.followers_count);
  const following = num(a.following_count);
  if (followers != null) chips.push({ text: `粉丝 ${fmtN(followers)}`, title: "被关注人数" });
  if (following != null) chips.push({ text: `关注 ${fmtN(following)}`, title: "关注人数" });
  return chips;
}

export interface AccountLike {
  account_created_at?: string;
  account_age_days?: number | string;
  last_scored?: number;
  published_at?: number;
  agent_at?: number;
  followers_count?: number | string;
  following_count?: number | string;
}

/** Parse the last_decided_by string into a small actor badge descriptor. */
export function actorBadge(
  by: string | undefined,
): { icon: string; text: string; title: string; tone: string } | null {
  if (!by) return null;
  const i = by.indexOf(":");
  const kind = i >= 0 ? by.slice(0, i) : by;
  const who = i >= 0 ? by.slice(i + 1) : "";
  if (kind === "human")
    return { icon: "👤", text: who || "人工", title: `人工决策：${who}`, tone: "human" };
  if (kind === "agent")
    return { icon: "🤖", text: who || "agent", title: `AI agent 决策：${who}`, tone: "agent" };
  if (kind === "rule")
    return { icon: "🔧", text: `规则#${who}`, title: `关键词规则 #${who}`, tone: "rule" };
  return { icon: "🛠", text: by, title: by, tone: "sys" };
}
