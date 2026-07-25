#!/usr/bin/env python3
"""Budgeted OpenAI-compatible batch reviewer for the MXGA agent queue.

Dry-run is the default. Set APPLY_DECISIONS=1 explicitly to write private
agent staging decisions; this runner never publishes directly.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Callable
import urllib.error
import urllib.request

from batch_review import ReviewLimits, review_batch


@contextmanager
def single_instance_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a")
    acquired = True
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        acquired = False
    try:
        yield acquired
    finally:
        if acquired:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


@dataclass
class DailyUsageLedger:
    log_dir: Path
    day: str | None = None

    @property
    def path(self) -> Path:
        day = self.day or datetime.now(timezone.utc).date().isoformat()
        return self.log_dir / f"batch-usage-{day}.jsonl"

    def record(self, raw_usage: dict[str, Any]) -> None:
        input_tokens = int(
            raw_usage.get("prompt_tokens", raw_usage.get("input_tokens")) or 0
        )
        output_tokens = int(
            raw_usage.get("completion_tokens", raw_usage.get("output_tokens")) or 0
        )
        total_tokens = int(
            raw_usage.get("total_tokens") or input_tokens + output_tokens
        )
        self.log_dir.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as handle:
            handle.write(
                json.dumps(
                    {
                        "at": int(time.time()),
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "total_tokens": total_tokens,
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )

    def totals(self) -> dict[str, int]:
        totals = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        if not self.path.exists():
            return totals
        for line in self.path.read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            for key in totals:
                totals[key] += int(row.get(key) or 0)
        return totals


@dataclass(frozen=True)
class RunnerConfig:
    model: str
    apply: bool = False
    max_items: int = 100
    sub_batch_size: int = 10
    max_input_tokens: int = 30_000
    max_output_tokens: int = 10_000
    daily_input_tokens: int = 150_000
    daily_output_tokens: int = 90_000
    max_parse_failures: int = 2


def config_from_env(env: dict[str, str]) -> RunnerConfig:
    model = env.get("AGENT_LLM_MODEL")
    if not model:
        raise ValueError("AGENT_LLM_MODEL missing")
    max_items = int(env.get("MAX_ITEMS_PER_CYCLE", "100"))
    if not 1 <= max_items <= 100:
        raise ValueError("MAX_ITEMS_PER_CYCLE must be between 1 and 100")
    config = RunnerConfig(
        model=model,
        apply=env.get("APPLY_DECISIONS") == "1",
        max_items=max_items,
        sub_batch_size=int(env.get("LLM_SUB_BATCH_SIZE", "10")),
        max_input_tokens=int(env.get("MAX_INPUT_TOKENS_PER_CYCLE", "30000")),
        max_output_tokens=int(env.get("MAX_OUTPUT_TOKENS_PER_CYCLE", "10000")),
        daily_input_tokens=int(env.get("DAILY_INPUT_TOKEN_BUDGET", "150000")),
        daily_output_tokens=int(env.get("DAILY_OUTPUT_TOKEN_BUDGET", "90000")),
        max_parse_failures=int(env.get("MAX_PARSE_FAILURES", "2")),
    )
    if config.daily_input_tokens < 1 or config.daily_output_tokens < 1:
        raise ValueError("daily token budgets must be positive")
    return config


def limit_for_daily_usage(
    config: RunnerConfig, totals: dict[str, int]
) -> RunnerConfig | None:
    input_remaining = config.daily_input_tokens - int(totals.get("input_tokens") or 0)
    output_remaining = config.daily_output_tokens - int(
        totals.get("output_tokens") or 0
    )
    if input_remaining <= 0 or output_remaining <= 0:
        return None
    return replace(
        config,
        max_input_tokens=min(config.max_input_tokens, input_remaining),
        max_output_tokens=min(config.max_output_tokens, output_remaining),
    )


def load_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    loaded: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        loaded[key.strip()] = value.strip().strip('"').strip("'")
    return loaded


def decision_body(decision: dict[str, Any], *, model: str) -> dict[str, Any]:
    routing = {
        "blacklist": ("blacklist", "approve_block"),
        "reject": ("whitelist", "reject_legit"),
        "pending": ("pending", "needs_human"),
    }
    route = routing.get(decision["decision"])
    if route is None:
        raise ValueError("unsupported decision")
    reason = str(decision.get("reason") or "").strip()
    if not reason:
        if decision["decision"] == "blacklist":
            reason = f"hard evidence {'/'.join(str(s) for s in decision.get('signals') or [])}"
        elif decision["decision"] == "reject":
            reason = "no blacklistable evidence"
        else:
            reason = "insufficient hard evidence"
    body: dict[str, Any] = {
        "handle": decision["handle"],
        "decision": route[0],
        "label": decision["label"],
        "confidence": float(decision["confidence"]),
        "reasons": [reason[:200]],
        "signals": decision.get("signals") or [],
        "action": route[1],
        "model": model,
        "notes": "batch dry-run calibrated review",
    }
    if decision.get("x_user_id"):
        body["x_user_id"] = decision["x_user_id"]
    if decision.get("signals_hash"):
        body["signals_hash"] = decision["signals_hash"]
    return body


def run_cycle(config: RunnerConfig, *, worker_call, llm_call) -> dict[str, Any]:
    queue_response = worker_call("GET", f"/v1/agent/queue?limit={config.max_items}")
    if not isinstance(queue_response, dict) or "queue" not in queue_response:
        raise RuntimeError("worker queue response is missing queue")
    items = queue_response.get("queue") or []

    def writer(decision: dict[str, Any]) -> Any:
        body = decision_body(decision, model=config.model)
        return worker_call("POST", "/v1/agent/decide", body)

    return review_batch(
        items,
        llm_call=llm_call,
        writer=writer,
        apply=config.apply,
        limits=ReviewLimits(
            max_items=config.max_items,
            sub_batch_size=config.sub_batch_size,
            max_calls=10,
            max_parse_failures=config.max_parse_failures,
            max_input_tokens=config.max_input_tokens,
            max_output_tokens=config.max_output_tokens,
        ),
    )


def build_prompt(template: str, batch: list[dict[str, Any]]) -> str:
    accounts = json.dumps(batch, ensure_ascii=False, separators=(",", ":"))
    if "ACCOUNTS_JSON_PLACEHOLDER" not in template:
        raise ValueError("batch prompt template is missing ACCOUNTS_JSON_PLACEHOLDER")
    return template.replace("ACCOUNTS_JSON_PLACEHOLDER", accounts)


def make_worker_call(*, base_url: str, token: str, agent_id: str):
    def call(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{base_url.rstrip('/')}{path}",
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
        )
        request.add_header("Authorization", f"Bearer {token}")
        request.add_header("X-Agent-Id", agent_id)
        request.add_header("User-Agent", f"mxga-batch-review/{agent_id}")
        if body is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode() or "{}")
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:400]
            if error.code == 409:
                try:
                    conflict = json.loads(detail)
                except json.JSONDecodeError:
                    conflict = None
                if (
                    isinstance(conflict, dict)
                    and conflict.get("error") == "stale_agent_decision"
                ):
                    return conflict
            raise RuntimeError(f"worker HTTP {error.code}: {detail}") from error
        if not isinstance(payload, dict):
            raise RuntimeError("worker response is not a JSON object")
        return payload

    return call


def make_llm_call(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt_template: str,
    timeout_s: int,
    usage_callback: Callable[[dict[str, Any]], None] | None = None,
):
    def call(batch: list[dict[str, Any]]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{base_url.rstrip('/')}/chat/completions",
            data=json.dumps(
                {
                    "model": model,
                    "messages": [
                        {
                            "role": "user",
                            "content": build_prompt(prompt_template, batch),
                        }
                    ],
                    "temperature": 0,
                    "max_tokens": 4096,
                    "response_format": {"type": "json_object"},
                },
                ensure_ascii=False,
            ).encode(),
            method="POST",
        )
        request.add_header("Authorization", f"Bearer {api_key}")
        request.add_header("Content-Type", "application/json")
        request.add_header("User-Agent", "mxga-batch-review/openai-compatible")
        try:
            with urllib.request.urlopen(request, timeout=timeout_s) as response:
                payload = json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:400]
            raise RuntimeError(f"LLM HTTP {error.code}: {detail}") from error
        if not isinstance(payload, dict):
            raise RuntimeError("LLM response is not a JSON object")
        raw_usage = payload.get("usage")
        if usage_callback is not None and isinstance(raw_usage, dict):
            usage_callback(raw_usage)
        return payload

    return call


def _required(env: dict[str, str], key: str) -> str:
    value = env.get(key)
    if not value:
        raise ValueError(f"{key} missing")
    return value


def main() -> int:
    env_path = Path(
        os.environ.get(
            "AGENT_ENV",
            os.path.expanduser("~/.hermes-jobs/x-spam-agent/.env"),
        )
    )
    env = {**load_env(env_path), **os.environ}
    try:
        config = config_from_env(env)
    except (OSError, ValueError, RuntimeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1

    log_dir = Path(
        env.get(
            "LOG_DIR",
            os.path.expanduser("~/.hermes-jobs/x-spam-agent/logs"),
        )
    )
    ledger = DailyUsageLedger(log_dir)
    lock_path = Path(env.get("BATCH_LOCK_FILE", str(log_dir / ".batch-openai.lock")))
    with single_instance_lock(lock_path) as acquired:
        if not acquired:
            print(
                json.dumps(
                    {"ok": True, "skipped": "lock_busy"},
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
            return 0
        try:
            daily_before = ledger.totals()
            limited_config = limit_for_daily_usage(config, daily_before)
            if limited_config is None:
                print(
                    json.dumps(
                        {
                            "ok": True,
                            "skipped": "daily_token_budget",
                            "daily_usage": daily_before,
                            "daily_budget": {
                                "input_tokens": config.daily_input_tokens,
                                "output_tokens": config.daily_output_tokens,
                            },
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                )
                return 0
            config = limited_config
            worker_call = make_worker_call(
                base_url=env.get("WORKER_URL", "https://x.zuoluo.tv"),
                token=_required(env, "AGENT_TOKEN"),
                agent_id=env.get("AGENT_ID", "batch-openai-v2"),
            )
            prompt_path = Path(
                env.get(
                    "PROMPT_FILE_BATCH_OPENAI",
                    str(Path(__file__).with_name("prompt_batch_openai.tmpl")),
                )
            )
            llm_call = make_llm_call(
                base_url=_required(env, "AGENT_LLM_BASE_URL"),
                api_key=_required(env, "AGENT_LLM_API_KEY"),
                model=config.model,
                prompt_template=prompt_path.read_text(),
                timeout_s=int(env.get("AGENT_LLM_TIMEOUT_S", "90")),
                usage_callback=ledger.record,
            )
            result = run_cycle(config, worker_call=worker_call, llm_call=llm_call)
            daily_after = ledger.totals()
        except (OSError, ValueError, RuntimeError) as error:
            print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
            return 1

    result["ok"] = not result["halted"]
    result["mode"] = "apply" if config.apply else "dry-run"
    result["model"] = config.model
    result["daily_usage_before"] = daily_before
    result["daily_usage_after"] = daily_after
    result["daily_budget"] = {
        "input_tokens": config.daily_input_tokens,
        "output_tokens": config.daily_output_tokens,
    }
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 2 if result["halted"] else 0


if __name__ == "__main__":
    sys.exit(main())
