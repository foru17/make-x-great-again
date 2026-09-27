/** Private, unresolved moderation states. AI review never removes work from this set. */
export const REVIEW_STATUSES = [
  "auto_pending_review",
  "agent_pending",
  "agent_blacklist",
  "agent_whitelist",
] as const;
export const REVIEW_STAGES = [
  { value: "", label: "全部待审", statuses: REVIEW_STATUSES },
  { value: "unreviewed", label: "未初审", statuses: ["auto_pending_review"] },
  {
    value: "reviewed",
    label: "AI 已初审",
    statuses: ["agent_pending", "agent_blacklist", "agent_whitelist"],
  },
  { value: "pending", label: "AI 待定", statuses: ["agent_pending"] },
  { value: "blacklist", label: "AI 建议拉黑", statuses: ["agent_blacklist"] },
  { value: "whitelist", label: "AI 建议放行", statuses: ["agent_whitelist"] },
] as const;

export function reviewStage(value: string | undefined) {
  return REVIEW_STAGES.find((stage) => stage.value === (value ?? ""));
}

export function reviewStatusSql(alias = "a", stage = ""): string {
  const selection = reviewStage(stage);
  if (!selection) throw new Error("invalid review_stage");
  return `${alias ? `${alias}.` : ""}status IN (${selection.statuses.map((s) => `'${s}'`).join(",")})`;
}

export function reviewStatusLabel(status?: string): string {
  return (
    REVIEW_STAGES.find((s) => s.statuses.length === 1 && s.statuses[0] === status)?.label ??
    "未初审"
  );
}
