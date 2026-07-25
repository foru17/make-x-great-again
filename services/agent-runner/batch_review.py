"""Pure batch-review core shared by the production runner and local tests."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class ReviewLimits:
    max_items: int = 100
    sub_batch_size: int = 25
    max_calls: int = 4
    max_parse_failures: int = 2
    max_input_tokens: int = 30_000
    max_output_tokens: int = 10_000


def _item_id(item: dict[str, Any]) -> str:
    return str(item.get("x_user_id") or item["handle"])


def _llm_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _item_id(item),
        "handle": item["handle"],
        "display_name": (item.get("display_name") or "")[:120],
        "evidence": (item.get("evidence_text") or "")[:240],
        "worker_label": item.get("verdict_label") or "uncertain",
        "worker_confidence": float(item.get("confidence") or 0.0),
        "followers": item.get("followers_count"),
        "following": item.get("following_count"),
    }


def _parse_response(payload: dict[str, Any]) -> list[dict[str, Any]]:
    message = payload["choices"][0]["message"]
    raw = message.get("content") or message.get("reasoning_content") or ""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```\s*$", "", raw.strip(), flags=re.S)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as original_error:
        decoder = json.JSONDecoder()
        parsed = None
        for index, character in enumerate(cleaned):
            if character != "{":
                continue
            try:
                candidate, _end = decoder.raw_decode(cleaned[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict) and "decisions" in candidate:
                parsed = candidate
                break
        if parsed is None:
            raise original_error
    decisions = parsed["decisions"]
    if not isinstance(decisions, list):
        raise ValueError("decisions must be an array")
    return decisions


_HARD_BLOCK_SIGNALS = {"P1", "P3", "P6"}
_SPAM_LABELS = {"spam", "porn_bot"}


def _apply_safety_gate(
    source: list[dict[str, Any]], decisions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    source_ids = [_item_id(item) for item in source]
    decision_ids = [str(row.get("id")) for row in decisions]
    if (
        len(set(source_ids)) != len(source_ids)
        or len(set(decision_ids)) != len(decision_ids)
        or set(source_ids) != set(decision_ids)
    ):
        raise ValueError("response ids must match the input ids exactly once")
    source_by_id = {_item_id(item): item for item in source}
    decisions_by_id = {str(row["id"]): row for row in decisions}
    gated: list[dict[str, Any]] = []
    for item_id in source_ids:
        raw = decisions_by_id[item_id]
        row = dict(raw)
        item = source_by_id[item_id]
        label = str(row.get("label") or "uncertain")
        confidence = float(row.get("confidence") or 0.0)
        signals = {str(signal) for signal in (row.get("signals") or [])}
        requested = row.get("decision")
        hard_block = (
            requested == "blacklist"
            and label in _SPAM_LABELS
            and confidence >= 0.95
            and bool(signals & _HARD_BLOCK_SIGNALS)
        )
        high_following = int(item.get("following_count") or 0) > 100_000

        if high_following and label != "porn_bot" and confidence >= 0.9:
            row["decision"] = "reject"
            row["safety_reason"] = "high_following_nonporn"
        elif hard_block:
            row["decision"] = "blacklist"
        elif requested == "reject" and label == "legit" and confidence >= 0.9:
            row["decision"] = "reject"
        else:
            row["decision"] = "pending"
            if requested == "blacklist":
                row["safety_reason"] = "blacklist_evidence_gate"
        row["handle"] = item["handle"]
        row["x_user_id"] = item.get("x_user_id")
        row["signals_hash"] = item.get("signals_hash")
        gated.append(row)
    return gated


def review_batch(
    items: list[dict[str, Any]],
    *,
    llm_call: Callable[[list[dict[str, Any]]], dict[str, Any]],
    writer: Callable[[dict[str, Any]], Any],
    apply: bool,
    limits: ReviewLimits,
) -> dict[str, Any]:
    if len(items) > limits.max_items:
        raise ValueError(f"batch exceeds max_items={limits.max_items}")
    if limits.sub_batch_size < 1:
        raise ValueError("sub_batch_size must be positive")
    required_calls = (len(items) + limits.sub_batch_size - 1) // limits.sub_batch_size
    if required_calls > limits.max_calls:
        raise ValueError(f"batch would exceed max_calls={limits.max_calls}")

    decisions: list[dict[str, Any]] = []
    usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    calls = 0
    applied = 0
    parse_failures = 0
    halted = False
    halted_reason = None

    for start in range(0, len(items), limits.sub_batch_size):
        source = items[start : start + limits.sub_batch_size]
        payload = llm_call([_llm_item(item) for item in source])
        calls += 1
        raw_usage = payload.get("usage") or {}
        input_tokens = raw_usage.get("prompt_tokens", raw_usage.get("input_tokens"))
        output_tokens = raw_usage.get("completion_tokens", raw_usage.get("output_tokens"))
        if apply and (input_tokens is None or output_tokens is None):
            halted = True
            halted_reason = "usage_missing"
            break
        input_count = int(input_tokens or 0)
        output_count = int(output_tokens or 0)
        usage["input_tokens"] += input_count
        usage["output_tokens"] += output_count
        usage["total_tokens"] += int(raw_usage.get("total_tokens") or input_count + output_count)
        if (
            usage["input_tokens"] > limits.max_input_tokens
            or usage["output_tokens"] > limits.max_output_tokens
        ):
            halted = True
            halted_reason = "token_budget"
            break
        try:
            decisions.extend(_apply_safety_gate(source, _parse_response(payload)))
        except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
            parse_failures += len(source)
            if parse_failures > limits.max_parse_failures:
                halted = True
                halted_reason = "parse_failure_fuse"
                break

    if apply and not halted:
        for decision in decisions:
            writer(decision)
            applied += 1

    return {
        "processed": len(items),
        "calls": calls,
        "applied": applied,
        "halted": halted,
        "halted_reason": halted_reason,
        "parse_failures": parse_failures,
        "usage": usage,
        "decisions": decisions,
    }
