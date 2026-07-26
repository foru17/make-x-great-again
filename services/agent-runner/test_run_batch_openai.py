from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import urllib.error

from run_batch_openai import (
    DailyUsageLedger,
    RunnerConfig,
    config_from_env,
    decision_body,
    limit_for_daily_usage,
    make_llm_call,
    make_worker_call,
    run_cycle,
    single_instance_lock,
)


class BatchRunnerAdapterTests(unittest.TestCase):
    def test_daily_usage_ledger_sums_provider_token_fields(self) -> None:
        with TemporaryDirectory() as directory:
            ledger = DailyUsageLedger(Path(directory), day="2026-07-26")
            ledger.record(
                {
                    "prompt_tokens": 100,
                    "completion_tokens": 40,
                    "total_tokens": 140,
                }
            )
            ledger.record(
                {
                    "input_tokens": 60,
                    "output_tokens": 20,
                    "total_tokens": 80,
                }
            )

            self.assertEqual(
                {"input_tokens": 160, "output_tokens": 60, "total_tokens": 220},
                ledger.totals(),
            )

    def test_single_instance_lock_rejects_an_overlapping_cycle(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / ".batch-openai.lock"
            with single_instance_lock(path) as first:
                with single_instance_lock(path) as second:
                    self.assertTrue(first)
                    self.assertFalse(second)

    def test_reject_is_staged_as_agent_whitelist_not_published(self) -> None:
        body = decision_body(
            {
                "handle": "normal_person",
                "x_user_id": "801",
                "signals_hash": "hash-801",
                "decision": "reject",
                "label": "legit",
                "confidence": 0.98,
                "signals": [],
                "reason": "normal personal speech",
            },
            model="test-model",
        )

        self.assertEqual("whitelist", body["decision"])
        self.assertEqual("reject_legit", body["action"])
        self.assertEqual("801", body["x_user_id"])
        self.assertEqual("hash-801", body["signals_hash"])
        self.assertNotIn("published_tier", body)

    def test_blacklist_and_pending_remain_private_agent_staging_decisions(self) -> None:
        base = {
            "handle": "candidate",
            "x_user_id": "802",
            "signals_hash": "hash-802",
            "label": "spam",
            "confidence": 0.99,
            "signals": ["P6"],
            "reason": "guaranteed-profit Telegram funnel",
        }

        blacklist = decision_body({**base, "decision": "blacklist"}, model="test-model")
        pending = decision_body(
            {
                **base,
                "decision": "pending",
                "label": "uncertain",
                "confidence": 0.5,
                "signals": [],
            },
            model="test-model",
        )

        self.assertEqual(("blacklist", "approve_block"), (blacklist["decision"], blacklist["action"]))
        self.assertEqual(("pending", "needs_human"), (pending["decision"], pending["action"]))
        self.assertNotIn("published_tier", blacklist)
        self.assertNotIn("published_tier", pending)

    def test_missing_model_reason_gets_a_compact_audit_reason(self) -> None:
        blacklist = decision_body(
            {
                "handle": "candidate",
                "x_user_id": "804",
                "decision": "blacklist",
                "label": "spam",
                "confidence": 0.99,
                "signals": ["P6"],
            },
            model="test-model",
        )
        reject = decision_body(
            {
                "handle": "normal_person",
                "x_user_id": "805",
                "decision": "reject",
                "label": "legit",
                "confidence": 0.95,
                "signals": [],
            },
            model="test-model",
        )
        pending = decision_body(
            {
                "handle": "uncertain_person",
                "x_user_id": "806",
                "decision": "pending",
                "label": "uncertain",
                "confidence": 0.5,
                "signals": [],
            },
            model="test-model",
        )

        self.assertEqual(["hard evidence P6"], blacklist["reasons"])
        self.assertEqual(["no blacklistable evidence"], reject["reasons"])
        self.assertEqual(["insufficient hard evidence"], pending["reasons"])

    def test_run_cycle_defaults_to_dry_run_and_only_reads_the_worker_queue(self) -> None:
        worker_calls = []

        def worker_call(method, path, body=None):
            worker_calls.append((method, path, body))
            if method == "GET":
                return {
                    "queue": [
                        {
                            "x_user_id": "803",
                            "handle": "obvious_scam",
                            "display_name": "Signals",
                            "evidence_text": "Join Telegram for guaranteed profit",
                            "verdict_label": "spam",
                            "confidence": 0.97,
                            "signals_hash": "hash-803",
                        }
                    ]
                }
            self.fail("dry-run must not POST")

        def llm_call(batch):
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "decisions": [
                                        {
                                            "id": batch[0]["id"],
                                            "decision": "blacklist",
                                            "label": "spam",
                                            "confidence": 0.99,
                                            "signals": ["P6"],
                                            "reason": "guaranteed-profit Telegram funnel",
                                        }
                                    ]
                                }
                            )
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 40,
                    "total_tokens": 140,
                },
            }

        result = run_cycle(
            RunnerConfig(model="test-model"),
            worker_call=worker_call,
            llm_call=llm_call,
        )

        self.assertEqual([("GET", "/v1/agent/queue?limit=100", None)], worker_calls)
        self.assertEqual(0, result["applied"])
        self.assertEqual("blacklist", result["decisions"][0]["decision"])

    def test_environment_requires_explicit_one_to_enable_apply(self) -> None:
        base = {"AGENT_LLM_MODEL": "test-model"}

        self.assertFalse(config_from_env(base).apply)
        self.assertFalse(config_from_env({**base, "APPLY_DECISIONS": "true"}).apply)
        self.assertTrue(config_from_env({**base, "APPLY_DECISIONS": "1"}).apply)

    def test_daily_budget_requires_headroom_for_a_full_cycle(self) -> None:
        config = RunnerConfig(
            model="test-model",
            max_input_tokens=30_000,
            max_output_tokens=10_000,
            daily_input_tokens=150_000,
            daily_output_tokens=90_000,
        )

        limited = limit_for_daily_usage(
            config,
            {"input_tokens": 140_000, "output_tokens": 85_000, "total_tokens": 225_000},
        )

        self.assertIsNone(limited)
        self.assertEqual(
            config,
            limit_for_daily_usage(
                config,
                {
                    "input_tokens": 120_000,
                    "output_tokens": 80_000,
                    "total_tokens": 200_000,
                },
            ),
        )
        self.assertIsNone(
            limit_for_daily_usage(
                config,
                {
                    "input_tokens": 150_000,
                    "output_tokens": 85_000,
                    "total_tokens": 235_000,
                },
            )
        )

    def test_environment_cannot_raise_the_cycle_above_100_accounts(self) -> None:
        with self.assertRaisesRegex(ValueError, "MAX_ITEMS_PER_CYCLE"):
            config_from_env(
                {
                    "AGENT_LLM_MODEL": "test-model",
                    "MAX_ITEMS_PER_CYCLE": "101",
                }
            )

    def test_default_cycle_uses_ten_provider_safe_calls_for_100_accounts(self) -> None:
        items = [
            {
                "x_user_id": str(uid),
                "handle": f"candidate_{uid}",
                "evidence_text": "normal conversation",
            }
            for uid in range(900, 1000)
        ]
        batch_sizes = []

        def worker_call(method, _path, _body=None):
            self.assertEqual("GET", method)
            return {"queue": items}

        def llm_call(batch):
            batch_sizes.append(len(batch))
            decisions = [
                {
                    "id": item["id"],
                    "decision": "reject",
                    "label": "legit",
                    "confidence": 0.95,
                    "signals": [],
                    "reason": "normal conversation",
                }
                for item in batch
            ]
            return {
                "choices": [{"message": {"content": json.dumps({"decisions": decisions})}}],
                "usage": {
                    "prompt_tokens": 500,
                    "completion_tokens": 200,
                    "total_tokens": 700,
                },
            }

        result = run_cycle(
            RunnerConfig(model="test-model"),
            worker_call=worker_call,
            llm_call=llm_call,
        )

        self.assertEqual([10] * 10, batch_sizes)
        self.assertEqual(100, len(result["decisions"]))

    def test_worker_call_returns_stale_conflict_for_safe_skipping(self) -> None:
        conflict = urllib.error.HTTPError(
            "https://example.test/v1/agent/decide",
            409,
            "Conflict",
            {},
            BytesIO(b'{"ok":false,"error":"stale_agent_decision"}'),
        )
        call = make_worker_call(
            base_url="https://example.test",
            token="test-token",
            agent_id="test-agent",
        )

        with patch("run_batch_openai.urllib.request.urlopen", side_effect=conflict):
            result = call(
                "POST",
                "/v1/agent/decide",
                {"handle": "candidate", "decision": "pending"},
            )

        self.assertEqual(
            {"ok": False, "error": "stale_agent_decision"},
            result,
        )

    def test_llm_call_records_usage_before_the_cycle_can_fail(self) -> None:
        payload = {
            "choices": [{"message": {"content": '{"decisions":[]}'}}],
            "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 30,
                "total_tokens": 150,
            },
        }

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(payload).encode()

        recorded = []
        call = make_llm_call(
            base_url="https://example.test",
            api_key="test-key",
            model="test-model",
            prompt_template="ACCOUNTS_JSON_PLACEHOLDER",
            timeout_s=10,
            usage_callback=recorded.append,
        )

        with patch("run_batch_openai.urllib.request.urlopen", return_value=Response()):
            result = call([])

        self.assertEqual(payload, result)
        self.assertEqual([payload["usage"]], recorded)

    def test_llm_call_caps_total_completion_tokens_per_sub_batch(self) -> None:
        payload = {
            "choices": [{"message": {"content": '{"decisions":[]}'}}],
            "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 30,
                "total_tokens": 150,
            },
        }

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(payload).encode()

        call = make_llm_call(
            base_url="https://example.test",
            api_key="test-key",
            model="test-model",
            prompt_template="ACCOUNTS_JSON_PLACEHOLDER",
            timeout_s=10,
            max_output_tokens=900,
        )

        with patch(
            "run_batch_openai.urllib.request.urlopen", return_value=Response()
        ) as urlopen:
            call([])

        request = urlopen.call_args.args[0]
        body = json.loads(request.data)
        self.assertEqual(900, body["max_completion_tokens"])
        self.assertNotIn("max_tokens", body)


if __name__ == "__main__":
    unittest.main()
