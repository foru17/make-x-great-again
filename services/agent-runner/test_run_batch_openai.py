import json
import unittest

from run_batch_openai import RunnerConfig, config_from_env, decision_body, run_cycle


class BatchRunnerAdapterTests(unittest.TestCase):
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

    def test_environment_cannot_raise_the_cycle_above_100_accounts(self) -> None:
        with self.assertRaisesRegex(ValueError, "MAX_ITEMS_PER_CYCLE"):
            config_from_env(
                {
                    "AGENT_LLM_MODEL": "test-model",
                    "MAX_ITEMS_PER_CYCLE": "101",
                }
            )


if __name__ == "__main__":
    unittest.main()
