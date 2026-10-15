import { stripInvisibleSql } from "./text-normalization";

export const AGENT_AUTO_BLACKLIST_CONFIDENCE_FLOOR = 0.9;
export const AGENT_AUTO_BLACKLIST_BATCH_LIMIT = 100;
const SQL_BATCH_LIMIT = 100;
// The currently deployed batch reviewer recognizes exactly these hard signals.
const HARD_SIGNALS = ["P1", "P2", "P3", "P4", "P6"] as const;

interface AgentAutoPublishEnv {
  DB: D1Database;
  AGENT_AUTO_BLACKLIST_ENABLED?: string;
}

export function agentAutoBlacklistEnabled(env: Pick<AgentAutoPublishEnv, "AGENT_AUTO_BLACKLIST_ENABLED">): boolean {
  return env.AGENT_AUTO_BLACKLIST_ENABLED === "1";
}

// This predicate is shared by candidate selection, the audit INSERT and the
// final UPDATE. Rechecking it inside the transaction protects human decisions
// and new evidence arriving after the candidate read.
const ELIGIBLE_SQL = `
  a.status='agent_blacklist'
  AND a.agent_action='approve_block'
  AND a.agent_label IN ('spam','porn_bot')
  AND typeof(a.agent_confidence) IN ('real','integer')
  AND a.agent_confidence BETWEEN ${AGENT_AUTO_BLACKLIST_CONFIDENCE_FLOOR} AND 1
  AND (a.followers_count IS NULL OR (
    typeof(a.followers_count) IN ('real','integer') AND a.followers_count < 100000
  ))
  AND length(trim(coalesce(a.agent_id,''))) > 0
  AND length(trim(coalesce(a.agent_error,''))) = 0
  AND coalesce(a.last_decided_by,'') NOT LIKE 'human:%'
  AND length(trim(coalesce(a.signals_hash,''))) > 0
  AND a.agent_signals_hash=a.signals_hash
  AND length(trim(${stripInvisibleSql("a.evidence_text")},
    char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288))) > 0
  AND length(a.handle) BETWEEN 1 AND 15
  AND a.handle NOT GLOB '*[^A-Za-z0-9_]*'
  AND (a.x_user_id IS NULL OR (
    length(a.x_user_id) BETWEEN 1 AND 32 AND a.x_user_id NOT GLOB '*[^0-9]*'
  ))
  AND EXISTS (
    SELECT 1 FROM json_each(
      CASE WHEN json_valid(a.agent_signals) THEN
        CASE WHEN json_type(a.agent_signals)='array' THEN a.agent_signals ELSE '[]' END
      ELSE '[]' END
    ) signal
    WHERE signal.type='text' AND signal.value IN (${HARD_SIGNALS.map((s) => `'${s}'`).join(",")})
  )
  AND NOT EXISTS (
    SELECT 1 FROM accounts protected INDEXED BY idx_accounts_handle_norm
    WHERE protected.rowid<>a.rowid
      AND protected.status IN ('whitelisted','human_confirmed','rejected','removed')
      AND lower(protected.handle)=lower(a.handle)
  )
  AND (a.x_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM accounts protected INDEXED BY idx_accounts_uid
    WHERE protected.rowid<>a.rowid
      AND protected.status IN ('whitelisted','human_confirmed','rejected','removed')
      AND protected.x_user_id=a.x_user_id
  ))`;

interface Candidate {
  id: number;
  x_user_id: string | null;
  handle: string;
  agent_id: string;
  agent_at: number | null;
  signals_hash: string;
}

export interface AgentAutoPublishOptions {
  dryRun?: boolean;
  limit?: number;
  identity?: { handle: string; xUserId: string | null };
  now?: number;
}

export interface AgentAutoPublishResult {
  enabled: boolean;
  dry_run: boolean;
  eligible: number;
  published: number;
  sample: Array<{ id: number; x_user_id: string | null; handle: string }>;
  published_ids: number[];
}

export async function autoPublishAgentBlacklist(
  env: AgentAutoPublishEnv,
  options: AgentAutoPublishOptions = {},
): Promise<AgentAutoPublishResult> {
  const enabled = agentAutoBlacklistEnabled(env);
  const result: AgentAutoPublishResult = {
    enabled,
    dry_run: options.dryRun === true,
    eligible: 0,
    published: 0,
    sample: [],
    published_ids: [],
  };
  // A disabled lane makes no database calls during normal decisions or cron.
  // Admin dry-runs can still inspect eligibility before enabling publication.
  if (!enabled && !result.dry_run) return result;
  const limit = Number.isFinite(options.limit)
    ? Math.min(AGENT_AUTO_BLACKLIST_BATCH_LIMIT, Math.max(1, Math.floor(options.limit!)))
    : AGENT_AUTO_BLACKLIST_BATCH_LIMIT;
  const identitySql = options.identity ? " AND lower(a.handle)=? AND a.x_user_id IS ?" : "";
  const candidateIndex = options.identity
    ? options.identity.xUserId === null ? "idx_accounts_handle_norm" : "idx_accounts_uid"
    : "idx_accounts_status";
  const binds: unknown[] = options.identity
    ? [options.identity.handle.trim().replace(/^@+/, "").toLowerCase(), options.identity.xUserId, limit]
    : [limit];
  const rows = await env.DB.prepare(
    `SELECT a.rowid AS id, a.x_user_id, a.handle, a.agent_id, a.agent_at, a.signals_hash
       FROM accounts a INDEXED BY ${candidateIndex}
      WHERE ${ELIGIBLE_SQL}${identitySql}
      ORDER BY a.rowid LIMIT ?`,
  ).bind(...binds).all<Candidate>();
  const candidates = rows.results ?? [];
  result.eligible = candidates.length;
  result.sample = candidates.map(({ id, x_user_id, handle }) => ({ id, x_user_id, handle }));
  if (result.dry_run || candidates.length === 0) return result;

  const now = options.now ?? Date.now();
  // Two statements per candidate. A transaction logs only rows that still
  // qualify, then updates those same rows; a losing concurrent attempt logs
  // nothing. Any SQL failure rolls back both the audit and the publication.
  for (let start = 0; start < candidates.length; start += SQL_BATCH_LIMIT / 2) {
    const chunk = candidates.slice(start, start + SQL_BATCH_LIMIT / 2);
    const statements = chunk.flatMap((row) => {
      const guard = `a.rowid=? AND a.x_user_id IS ? AND a.handle IS ?
        AND a.agent_id IS ? AND a.agent_at IS ? AND a.signals_hash IS ?
        AND ${ELIGIBLE_SQL}`;
      const snapshot = [row.id, row.x_user_id, row.handle, row.agent_id, row.agent_at, row.signals_hash];
      return [
        env.DB.prepare(
          `INSERT INTO review_log (x_user_id,handle,action,actor,note,at)
           SELECT a.x_user_id,a.handle,'ai_blacklist','agent:' || a.agent_id,
                  'Agent auto-published at confidence ' || a.agent_confidence,?
             FROM accounts a WHERE ${guard}`,
        ).bind(now, ...snapshot),
        env.DB.prepare(
          `UPDATE accounts AS a
              SET status='human_confirmed', published_at=?, published_tier='ai',
                  verdict_label=agent_label, confidence=agent_confidence,
                  reasons=agent_reasons, model=coalesce(agent_model,model),
                  category=CASE WHEN agent_label='porn_bot' THEN 'porn' ELSE coalesce(category,'other') END,
                  last_decided_by='agent:' || agent_id, last_decided_at=?
            WHERE ${guard}`,
        ).bind(now, now, ...snapshot),
      ];
    });
    const writes = await env.DB.batch(statements);
    for (let i = 0; i < chunk.length; i++) {
      if (Number(writes[i * 2 + 1]?.meta?.changes ?? 0) > 0) {
        result.published_ids.push(chunk[i].id);
      }
    }
  }
  result.published = result.published_ids.length;
  console.log(JSON.stringify({
    event: "agent_auto_blacklist.completed",
    origin: options.identity ? "decide" : "backfill",
    eligible: result.eligible,
    published: result.published,
    limit,
  }));
  return result;
}
