#!/bin/bash
set -euo pipefail

job_dir="${HOME}/.hermes-jobs/x-spam-agent"

export AGENT_ENV="${job_dir}/.env"
export AGENT_ID="batch-openai-v2"
export AGENT_LLM_MODEL="gpt-5.5"
export AGENT_REASONING_EFFORT="none"
export APPLY_DECISIONS="1"
export MAX_ITEMS_PER_CYCLE="100"
export LLM_SUB_BATCH_SIZE="20"
export MAX_INPUT_TOKENS_PER_CYCLE="15000"
export MAX_OUTPUT_TOKENS_PER_CYCLE="9000"
export DAILY_INPUT_TOKEN_BUDGET="150000"
export DAILY_OUTPUT_TOKEN_BUDGET="90000"
export MAX_PARSE_FAILURES="2"
export LOG_DIR="${job_dir}/logs"
export BATCH_LOCK_FILE="${job_dir}/logs/.batch-openai.lock"
export PROMPT_FILE_BATCH_OPENAI="${job_dir}/prompt_batch_openai.tmpl"

exec /opt/homebrew/bin/python3 "${job_dir}/run_batch_openai.py"
