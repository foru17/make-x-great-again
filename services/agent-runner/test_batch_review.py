import json
import unittest

from batch_review import ReviewLimits, review_batch


class BatchReviewTests(unittest.TestCase):
    def test_dry_run_returns_decisions_and_usage_without_writes(self) -> None:
        items = [
            {
                "x_user_id": "101",
                "handle": "obvious_scam",
                "display_name": "VIP signals",
                "evidence_text": "Join Telegram for guaranteed profit",
                "verdict_label": "spam",
                "confidence": 0.97,
                "signals_hash": "hash-101",
            },
            {
                "x_user_id": "102",
                "handle": "normal_person",
                "display_name": "Normal Person",
                "evidence_text": "The weather is lovely today",
                "verdict_label": "legit",
                "confidence": 0.92,
                "signals_hash": "hash-102",
            },
        ]

        def llm_call(batch):
            self.assertEqual(["101", "102"], [item["id"] for item in batch])
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "decisions": [
                                        {
                                            "id": "101",
                                            "decision": "blacklist",
                                            "label": "spam",
                                            "confidence": 0.99,
                                            "signals": ["P6"],
                                            "reason": "guaranteed-profit Telegram funnel",
                                        },
                                        {
                                            "id": "102",
                                            "decision": "reject",
                                            "label": "legit",
                                            "confidence": 0.98,
                                            "signals": [],
                                            "reason": "normal personal speech",
                                        },
                                    ]
                                }
                            )
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 321,
                    "completion_tokens": 87,
                    "total_tokens": 408,
                },
            }

        def writer(_decision):
            self.fail("dry-run must not write decisions")

        result = review_batch(
            items,
            llm_call=llm_call,
            writer=writer,
            apply=False,
            limits=ReviewLimits(),
        )

        self.assertEqual(2, result["processed"])
        self.assertEqual(1, result["calls"])
        self.assertEqual(0, result["applied"])
        self.assertFalse(result["halted"])
        self.assertEqual(
            {"input_tokens": 321, "output_tokens": 87, "total_tokens": 408},
            result["usage"],
        )
        self.assertEqual(["blacklist", "reject"], [row["decision"] for row in result["decisions"]])

    def test_malformed_response_trips_parse_failure_fuse_without_writes(self) -> None:
        items = [
            {
                "x_user_id": str(uid),
                "handle": f"candidate_{uid}",
                "evidence_text": "enough evidence text",
            }
            for uid in range(201, 204)
        ]

        def llm_call(_batch):
            return {
                "choices": [{"message": {"content": "not-json"}}],
                "usage": {
                    "prompt_tokens": 200,
                    "completion_tokens": 20,
                    "total_tokens": 220,
                },
            }

        writes = []
        result = review_batch(
            items,
            llm_call=llm_call,
            writer=writes.append,
            apply=True,
            limits=ReviewLimits(max_parse_failures=2),
        )

        self.assertTrue(result["halted"])
        self.assertEqual("parse_failure_fuse", result["halted_reason"])
        self.assertEqual(3, result["parse_failures"])
        self.assertEqual(0, result["applied"])
        self.assertEqual([], writes)

    def test_token_budget_halts_before_the_next_sub_batch(self) -> None:
        items = [
            {
                "x_user_id": str(uid),
                "handle": f"candidate_{uid}",
                "evidence_text": "enough evidence text",
            }
            for uid in range(301, 327)
        ]
        calls = []

        def llm_call(batch):
            calls.append(batch)
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "decisions": [
                                        {
                                            "id": item["id"],
                                            "decision": "pending",
                                            "label": "uncertain",
                                            "confidence": 0.5,
                                            "signals": [],
                                            "reason": "not enough hard evidence",
                                        }
                                        for item in batch
                                    ]
                                }
                            )
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 30_001,
                    "completion_tokens": 500,
                    "total_tokens": 30_501,
                },
            }

        writes = []
        result = review_batch(
            items,
            llm_call=llm_call,
            writer=writes.append,
            apply=True,
            limits=ReviewLimits(max_input_tokens=30_000, max_output_tokens=10_000),
        )

        self.assertEqual(1, len(calls))
        self.assertTrue(result["halted"])
        self.assertEqual("token_budget", result["halted_reason"])
        self.assertEqual(0, result["applied"])
        self.assertEqual([], writes)

    def test_safety_gate_downgrades_unsupported_blocks_and_protects_high_following(self) -> None:
        items = [
            {
                "x_user_id": "401",
                "handle": "normal",
                "evidence_text": "normal speech",
                "following_count": 10,
            },
            {
                "x_user_id": "402",
                "handle": "weak_spam",
                "evidence_text": "maybe promotional",
                "following_count": 10,
            },
            {
                "x_user_id": "403",
                "handle": "large_nonporn",
                "evidence_text": "guaranteed profit Telegram funnel",
                "following_count": 100_001,
            },
            {
                "x_user_id": "404",
                "handle": "large_porn",
                "evidence_text": "escort booking in bio",
                "following_count": 100_001,
            },
            {
                "x_user_id": "405",
                "handle": "weak_reject",
                "evidence_text": "ambiguous short text",
                "following_count": 10,
            },
        ]

        def llm_call(batch):
            decisions = [
                {
                    "id": "401",
                    "decision": "blacklist",
                    "label": "legit",
                    "confidence": 0.99,
                    "signals": ["P6"],
                    "reason": "invalid model combination",
                },
                {
                    "id": "402",
                    "decision": "blacklist",
                    "label": "spam",
                    "confidence": 0.99,
                    "signals": [],
                    "reason": "no hard evidence code",
                },
                {
                    "id": "403",
                    "decision": "blacklist",
                    "label": "spam",
                    "confidence": 0.99,
                    "signals": ["P6"],
                    "reason": "non-porn high-following account",
                },
                {
                    "id": "404",
                    "decision": "blacklist",
                    "label": "porn_bot",
                    "confidence": 0.99,
                    "signals": ["P1"],
                    "reason": "explicit escort promotion",
                },
                {
                    "id": "405",
                    "decision": "reject",
                    "label": "uncertain",
                    "confidence": 0.55,
                    "signals": [],
                    "reason": "not enough evidence",
                },
            ]
            return {
                "choices": [{"message": {"content": json.dumps({"decisions": decisions})}}],
                "usage": {
                    "prompt_tokens": 400,
                    "completion_tokens": 200,
                    "total_tokens": 600,
                },
            }

        result = review_batch(
            items,
            llm_call=llm_call,
            writer=lambda _decision: None,
            apply=False,
            limits=ReviewLimits(),
        )

        self.assertEqual(
            ["pending", "pending", "reject", "blacklist", "pending"],
            [row["decision"] for row in result["decisions"]],
        )

    def test_configuration_cannot_exceed_four_model_calls_for_100_items(self) -> None:
        items = [
            {
                "x_user_id": str(uid),
                "handle": f"candidate_{uid}",
                "evidence_text": "enough evidence text",
            }
            for uid in range(501, 601)
        ]

        with self.assertRaisesRegex(ValueError, "max_calls=4"):
            review_batch(
                items,
                llm_call=lambda _batch: self.fail("invalid configuration must fail before LLM"),
                writer=lambda _decision: None,
                apply=False,
                limits=ReviewLimits(sub_batch_size=20, max_calls=4),
            )

    def test_missing_or_duplicate_ids_fail_the_entire_sub_batch(self) -> None:
        items = [
            {
                "x_user_id": str(uid),
                "handle": f"candidate_{uid}",
                "evidence_text": "enough evidence text",
            }
            for uid in range(601, 604)
        ]

        def llm_call(_batch):
            duplicate = {
                "id": "601",
                "decision": "blacklist",
                "label": "spam",
                "confidence": 0.99,
                "signals": ["P6"],
                "reason": "duplicate output id",
            }
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({"decisions": [duplicate, duplicate]})
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 200,
                    "completion_tokens": 50,
                    "total_tokens": 250,
                },
            }

        writes = []
        result = review_batch(
            items,
            llm_call=llm_call,
            writer=writes.append,
            apply=True,
            limits=ReviewLimits(max_parse_failures=2),
        )

        self.assertTrue(result["halted"])
        self.assertEqual("parse_failure_fuse", result["halted_reason"])
        self.assertEqual(3, result["parse_failures"])
        self.assertEqual([], result["decisions"])
        self.assertEqual([], writes)

    def test_reasoning_content_and_json_fences_are_supported(self) -> None:
        item = {
            "x_user_id": "701",
            "handle": "obvious_scam",
            "evidence_text": "Join Telegram for guaranteed profit",
        }
        decision = {
            "id": "701",
            "decision": "blacklist",
            "label": "spam",
            "confidence": 0.99,
            "signals": ["P6"],
            "reason": "guaranteed-profit Telegram funnel",
        }

        result = review_batch(
            [item],
            llm_call=lambda _batch: {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "reasoning_content": f"```json\n{json.dumps({'decisions': [decision]})}\n```",
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 40,
                    "total_tokens": 140,
                },
            },
            writer=lambda _decision: None,
            apply=False,
            limits=ReviewLimits(),
        )

        self.assertFalse(result["halted"])
        self.assertEqual("blacklist", result["decisions"][0]["decision"])

    def test_reasoning_prose_before_the_final_json_is_supported(self) -> None:
        item = {
            "x_user_id": "703",
            "handle": "obvious_scam",
            "evidence_text": "Join Telegram for guaranteed profit",
        }
        decision = {
            "id": "703",
            "decision": "blacklist",
            "label": "spam",
            "confidence": 0.99,
            "signals": ["P6"],
            "reason": "guaranteed-profit Telegram funnel",
        }
        reasoning = (
            "I considered a stray object {not valid json}. "
            f"Final answer: {json.dumps({'decisions': [decision]})}"
        )

        result = review_batch(
            [item],
            llm_call=lambda _batch: {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "reasoning_content": reasoning,
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 40,
                    "total_tokens": 140,
                },
            },
            writer=lambda _decision: None,
            apply=False,
            limits=ReviewLimits(),
        )

        self.assertFalse(result["halted"])
        self.assertEqual("blacklist", result["decisions"][0]["decision"])

    def test_missing_usage_fails_closed_when_apply_is_enabled(self) -> None:
        item = {
            "x_user_id": "702",
            "handle": "candidate",
            "evidence_text": "enough evidence text",
        }
        decision = {
            "id": "702",
            "decision": "pending",
            "label": "uncertain",
            "confidence": 0.5,
            "signals": [],
            "reason": "not enough hard evidence",
        }
        writes = []

        result = review_batch(
            [item],
            llm_call=lambda _batch: {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({"decisions": [decision]})
                        }
                    }
                ]
            },
            writer=writes.append,
            apply=True,
            limits=ReviewLimits(),
        )

        self.assertTrue(result["halted"])
        self.assertEqual("usage_missing", result["halted_reason"])
        self.assertEqual([], writes)

    def test_apply_skips_stale_rows_and_counts_only_confirmed_writes(self) -> None:
        items = [
            {
                "x_user_id": str(uid),
                "handle": f"candidate_{uid}",
                "evidence_text": "normal conversation",
            }
            for uid in range(711, 713)
        ]

        def llm_call(batch):
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
                    "prompt_tokens": 100,
                    "completion_tokens": 40,
                    "total_tokens": 140,
                },
            }

        outcomes = iter(
            [
                {"ok": False, "error": "stale_agent_decision"},
                {"ok": True, "status": "agent_whitelist"},
            ]
        )
        result = review_batch(
            items,
            llm_call=llm_call,
            writer=lambda _decision: next(outcomes),
            apply=True,
            limits=ReviewLimits(),
        )

        self.assertEqual(1, result["applied"])
        self.assertEqual(1, result["skipped_stale"])
        self.assertFalse(result["halted"])


if __name__ == "__main__":
    unittest.main()
