export interface ProviderEnv {
  DB: D1Database;
  AI_USAGE_ENABLED?: string;
  LLM_API_BASE: string;
  LLM_API_MODEL: string;
  LLM_API_KEY: string;
}
export interface ProviderPayload {
  id?: unknown;
  usage?: unknown;
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string }>;
}
export class ModelCallError extends Error {
  constructor(readonly code: string) { super(code); }
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function reportedUsage(value: unknown) {
  const u = object(value);
  const input = integer(u.prompt_tokens ?? u.input_tokens);
  const output = integer(u.completion_tokens ?? u.output_tokens);
  const total = integer(u.total_tokens);
  const reasoning = integer(object(u.completion_tokens_details).reasoning_tokens ?? u.thinking_tokens);
  const cached = integer(object(u.prompt_tokens_details ?? u.input_tokens_details).cached_tokens);
  return { input, output, total, reasoning, cached,
    status: input !== null && output !== null && total !== null ? "reported" : Object.keys(u).length ? "partial" : "missing" };
}

/** Persist intent before submission; never infer zero usage from a failure.
 * Ambiguous delivery remains unknown, with no network retry here. */
export async function providerChat(
  env: ProviderEnv,
  body: Record<string, unknown>,
  meta: { operationId: string; entrypoint: string; attempt: number; accounts: number },
  fetcher: typeof fetch = fetch,
): Promise<{ payload: ProviderPayload; requestId: string | null }> {
  const metered = env.AI_USAGE_ENABLED === "1";
  const id = crypto.randomUUID();
  if (metered) {
    try {
      await env.DB.prepare(`INSERT INTO model_usage
        (request_id,operation_id,entrypoint,model,attempt,accounts,started_at,state,usage_status)
        VALUES (?,?,?,?,?,?,?,'started','missing')`)
        .bind(id, meta.operationId, meta.entrypoint, env.LLM_API_MODEL, meta.attempt, meta.accounts, Date.now()).run();
    } catch { throw new ModelCallError("usage_unavailable"); }
  }
  let response: Response;
  try {
    response = await fetcher(`${env.LLM_API_BASE}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${env.LLM_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    if (metered) await finish("unknown", null, null);
    throw new ModelCallError("model_outcome_unknown");
  }
  let payload: ProviderPayload | null = null;
  try { payload = object(await response.json()) as ProviderPayload; } catch { /* retain missing usage */ }
  if (metered) await finish(response.ok ? "response" : "http_error", response.status, payload);
  if (!response.ok) throw new ModelCallError("model_http_error");
  if (!payload) throw new ModelCallError("model_payload_invalid");
  return { payload, requestId: metered ? id : null };

  async function finish(state: string, status: number | null, payload: ProviderPayload | null) {
    const u = reportedUsage(payload?.usage);
    try {
      await env.DB.prepare(`UPDATE model_usage SET state=?,http_status=?,finished_at=?,
        input_tokens=?,output_tokens=?,total_tokens=?,reasoning_tokens=?,cached_input_tokens=?,
        usage_status=?,provider_request_id=? WHERE request_id=?`)
        .bind(state, status, Date.now(), u.input, u.output, u.total, u.reasoning, u.cached, u.status,
          typeof payload?.id === "string" ? payload.id.slice(0, 200) : null, id).run();
    } catch { throw new ModelCallError("model_outcome_unknown"); }
    console.log(JSON.stringify({ event: "model.attempt", requestId: id, entrypoint: meta.entrypoint,
      attempt: meta.attempt, accounts: meta.accounts, state, usageStatus: u.status }));
  }
}

export async function recordModelParse(env: ProviderEnv, requestId: string | null, status: "valid" | "invalid") {
  if (!requestId) return;
  try { await env.DB.prepare("UPDATE model_usage SET parse_status=? WHERE request_id=?").bind(status, requestId).run(); }
  catch { throw new ModelCallError("model_outcome_unknown"); }
}
