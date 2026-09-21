import type { CategoryAction, Settings } from "./settings";

/** Where a hit came from, for auto-action eligibility purposes. */
export type AutoSource = "list" | "rule" | "ai" | "cache" | "fresh";

/**
 * Whether a hit may enter the automatic-processing path at all (the
 * per-category action policy is applied after this gate; ineligible hits
 * degrade to badge-only).
 *
 * PRODUCT LINE (2026-07-07, reaffirmed 2026-07-18): on the public list =
 * auto-processable, regardless of tier — precision is enforced at the
 * publish source (AI lane confined to porn_bot; rules maintainer-curated).
 * settings.autoTierMode lets cautious users narrow the auto tier: "full"
 * (default) runs the per-category policy as-is, "hide" admits them but
 * `capAutoTierAction` limits them to the reversible local hide, "badge"
 * keeps the old mark-only stance. Tier gating exists server-side ONLY for
 * legacy ≤0.4 clients (`/v1/check` human-only), which auto-block with no
 * tier awareness and no cap.
 *
 * Official keyword-rule hits are maintainer-curated but target first-seen
 * accounts with no human review, so they are confined to reply sections
 * regardless of autoScope — AND (2026-07-24) they count as auto-tier for
 * autoTierMode purposes: the options copy promises "仅标记 = 自动收录条目
 * 永不自动处理" and rule hits are exactly that tier, so "badge" must gate
 * them too. Before this they bypassed the tier setting entirely.
 *
 * AI 判定 hits (the user's own TypeSafe Jev key, judged on-device, never
 * published) get exactly the rule-hit treatment: reply sections only, and
 * auto-tier for autoTierMode — "badge" gates them, "hide" caps them. They
 * only ever fire above Jev's calibrated threshold (lib/jev.ts).
 *
 * Cache and fresh verdicts never auto-act.
 */
export function autoEligible(opts: {
  source: AutoSource;
  tier: "confirmed" | "auto";
  inReply: boolean;
  autoScope: Settings["autoScope"];
  autoTierMode: Settings["autoTierMode"];
}): boolean {
  if (opts.source === "list") {
    if (opts.tier !== "confirmed" && opts.autoTierMode === "badge") return false;
    return opts.autoScope === "all" || opts.inReply;
  }
  if (opts.source === "rule" || opts.source === "ai") {
    if (opts.autoTierMode === "badge") return false;
    return opts.inReply;
  }
  return false;
}

/** Cap the per-category action for an eligible hit by its tier. Irreversible
 *  X-native mute/block stays human-confirmed-only unless the user explicitly
 *  opted the auto tier into "full"; under "hide" the action degrades to the
 *  local (reversible, zero-network) hide. This covers BOTH auto-tier list
 *  entries and official keyword-rule hits — everything that isn't
 *  human-confirmed (2026-07-24: rule hits used to pass through uncapped,
 *  contradicting the options copy "X 静音/拉黑仍只对人工确认条目执行"). */
export function capAutoTierAction(
  action: CategoryAction,
  opts: { source: AutoSource; tier: "confirmed" | "auto"; autoTierMode: Settings["autoTierMode"] },
): CategoryAction {
  if (opts.source === "list" && opts.tier === "confirmed") return action;
  if (opts.autoTierMode === "full") return action;
  return action === "badge" ? "badge" : "hide";
}
