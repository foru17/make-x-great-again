-- Local implementation only; apply to isolated local D1 for verification.
-- No handles, account text, reporter fingerprints, keys, or raw responses.
CREATE TABLE IF NOT EXISTS model_usage (
  request_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  entrypoint TEXT NOT NULL,
  model TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  accounts INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  state TEXT NOT NULL,
  http_status INTEGER,
  provider_request_id TEXT,
  usage_status TEXT NOT NULL,
  parse_status TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  reasoning_tokens INTEGER,
  cached_input_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS idx_model_usage_started ON model_usage(started_at);
