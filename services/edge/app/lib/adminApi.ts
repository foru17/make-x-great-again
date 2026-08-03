// Admin API client. Mirrors the endpoints the legacy console used; the
// ADMIN_TOKEN is tab-scoped: a closed tab must not leave a reusable admin
// credential on disk. Every access also removes the legacy localStorage copy.

const TOKEN_KEY = "xss_admin";

function removeLegacyPersistentToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function getToken(): string {
  removeLegacyPersistentToken();
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
export function setToken(t: string) {
  removeLegacyPersistentToken();
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
  } catch {}
}
export function clearToken() {
  removeLegacyPersistentToken();
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/** Thrown on 403 so callers can drop back to the unlock screen. */
export class AuthError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "x-admin-token": getToken(), ...(init?.headers || {}) },
  });
  if (res.status === 403) {
    clearToken();
    throw new AuthError("forbidden");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface Account {
  x_user_id?: string;
  handle: string;
  display_name?: string;
  avatar_url?: string;
  verdict_label?: string;
  confidence?: number;
  /** Human/AI-assigned spam category (porn|crypto|gambling|resource|marketing|other). */
  category?: string | null;
  reporters?: number;
  /** How this row entered the queue: 'report'/'block' = a user acted on it
   *  (manual 举报 / X 屏蔽 confirm); 'auto_scan'/'auto_keyword_mention' = the
   *  passive AI/rule pipeline. Drives the 来源 chip so a maintainer can tell a
   *  user report apart from an automated flag. */
  source?: string;
  account_created_at?: string;
  account_age_days?: number;
  followers_count?: number;
  following_count?: number;
  published_at?: number;
  published_tier?: string | null;
  last_scored?: number;
  last_decided_at?: number;
  last_decided_by?: string;
  reasons?: string;
  /** The X post / 发言 that triggered the verdict — shown in review rows so
   *  the content itself can be judged for spam. */
  evidence_text?: string;
  // agent staging fields
  agent_label?: string;
  agent_confidence?: number;
  agent_id?: string;
  agent_at?: number;
  agent_signals?: string;
  agent_reasons?: string;
  agent_evidence?: string;
}

export interface Stats {
  queue: number;
  blacklist: number;
  whitelist: number;
  agent_pending: number;
  agent_blacklist: number;
  agent_whitelist: number;
  reports?: number;
}

export interface Rule {
  id: number;
  pattern: string;
  field: string;
  action: string;
  verdict_label: string;
  note?: string;
  enabled: number | boolean;
  hit_count?: number;
  last_hit_at?: number;
}

export interface WhitelistRequest {
  id: number;
  x_user_id?: string | null;
  handle: string;
  gh_age_days?: number | null;
  note?: string | null;
  status: string;
  created_at: number;
  decided_at?: number | null;
  /** Current accounts-table state of the applicant — lets the panel flag
   *  "this handle is already on the public blacklist" before approving. */
  account_status?: string | null;
  account_verdict_label?: string | null;
  account_category?: string | null;
}

export interface LogEntry {
  at: number;
  action: string;
  actor?: string;
  handle?: string;
  note?: string;
}

export interface ListResult {
  list: Account[];
  nextBefore: number | null;
  appliedFilters?: { sort?: string };
}
export interface QueueResult {
  queue: Account[];
  nextBefore: number | null;
  appliedFilters?: Record<string, string>;
}

export type Item = { handle: string; xUserId?: string };
export type AgentItem = { handle: string; x_user_id?: string };

export const api = {
  stats: () => req<Stats>("/v1/admin/stats"),
  queue: (qs: string) => req<QueueResult>(`/v1/admin/queue${qs}`),
  blacklist: (qs: string) => req<ListResult>(`/v1/admin/blacklist${qs}`),
  whitelist: (qs: string) => req<ListResult>(`/v1/admin/whitelist${qs}`),
  agentList: (qs: string) => req<{ list: Account[]; nextBefore: number | null }>(`/v1/admin/agent-list${qs}`),
  log: (qs: string) => req<{ log: LogEntry[]; nextCursor: number | null }>(`/v1/admin/log${qs}`),
  rules: () => req<{ rules: Rule[] }>("/v1/admin/keyword-rules"),

  decide: (handle: string, xUserId: string | undefined | null, action: string) =>
    req<{ ok: boolean }>("/v1/admin/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // List endpoints return x_user_id: null for accounts without a numeric
      // id; coerce null/"" to undefined so JSON.stringify drops the key
      // (the API's zod schema accepts undefined but rejects null).
      body: JSON.stringify({ handle, xUserId: xUserId || undefined, action }),
    }),
  decideBatch: (action: string, items: Item[], category?: string) =>
    req<{ ok: boolean; error?: string }>("/v1/admin/decide-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, items, category }),
    }),
  categoryBatch: (category: string, items: Item[]) =>
    req<{ ok: boolean; error?: string }>("/v1/admin/category-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category, items }),
    }),
  agentPromote: (handle: string, xUserId: string | undefined, target: string) =>
    req<{ ok: boolean }>("/v1/admin/agent-promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(xUserId ? { handle, x_user_id: xUserId, target } : { handle, target }),
    }),
  agentPromoteBatch: (target: string, items: AgentItem[]) =>
    req<{ ok: boolean }>("/v1/admin/agent-promote-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, items }),
    }),
  whitelistAdd: (handle: string, xUserId: string | undefined, note: string) =>
    req<{ ok: boolean; error?: string }>("/v1/admin/whitelist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, xUserId: xUserId || undefined, note }),
    }),
  whitelistRemove: (handle: string, xUserId?: string) =>
    req<{ ok: boolean }>(
      `/v1/admin/whitelist?handle=${encodeURIComponent(handle)}${xUserId ? `&xUserId=${encodeURIComponent(xUserId)}` : ""}`,
      { method: "DELETE" },
    ),
  whitelistRequests: (status = "pending") =>
    req<{ list: WhitelistRequest[] }>(
      `/v1/admin/whitelist-requests?status=${encodeURIComponent(status)}`,
    ),
  whitelistRequestApprove: (id: number) =>
    req<{ ok: boolean; status?: string }>(`/v1/admin/whitelist-requests/${id}/approve`, {
      method: "POST",
    }),
  whitelistRequestReject: (id: number) =>
    req<{ ok: boolean; status?: string }>(`/v1/admin/whitelist-requests/${id}/reject`, {
      method: "POST",
    }),
  whitelistRemoveBatch: (items: Item[]) =>
    req<{ ok: boolean; error?: string }>("/v1/admin/whitelist-batch", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    }),
  ruleCreate: (body: Record<string, string | undefined>) =>
    req<{ ok: boolean; id?: number; error?: string; detail?: string }>("/v1/admin/keyword-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  ruleToggle: (id: number, enabled: boolean) =>
    req<{ ok: boolean }>(`/v1/admin/keyword-rules/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  ruleDelete: (id: number) =>
    req<{ ok: boolean }>(`/v1/admin/keyword-rules/${id}`, { method: "DELETE" }),
  rulesApply: () =>
    req<{ ok: boolean; matched: number; perRule?: { id: number; hits: number }[]; error?: string }>(
      "/v1/admin/keyword-rules/apply-to-queue",
      { method: "POST" },
    ),
};

/** Split a Set of "uid|handle" keys into {handle,xUserId} items, chunked at 100. */
export function selToItems(keys: string[]): Item[] {
  return keys.map((k) => {
    const [uid, h] = k.split("|");
    return uid ? { handle: h, xUserId: uid } : { handle: h };
  });
}
export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
export const BATCH_CHUNK = 100;
export const rowKey = (a: Account) => `${a.x_user_id || ""}|${a.handle}`;

export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "time_desc", label: "更新时间 ↓" },
  { value: "created_desc", label: "注册时间 新→旧" },
  { value: "created_asc", label: "注册时间 旧→新" },
  { value: "followers_desc", label: "粉丝数 多→少" },
  { value: "followers_asc", label: "粉丝数 少→多" },
  { value: "following_desc", label: "关注数 多→少" },
  { value: "following_asc", label: "关注数 少→多" },
];
