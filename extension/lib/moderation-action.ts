export type ModerationAction = "mute" | "block";

export const DEFAULT_MODERATION_ACTION: ModerationAction = "mute";

export interface ModerationActionLabels {
  verb: string;
  gerund: string;
  done: string;
  queued: string;
  active: string;
  background: string;
  automatic: string;
  description: string;
  risk: string;
}

const LABELS: Record<ModerationAction, ModerationActionLabels> = {
  mute: {
    verb: "静音",
    gerund: "静音中",
    done: "已静音",
    queued: "待静音",
    active: "静音中",
    background: "后台静音",
    automatic: "自动静音",
    description: "静音用户，隐藏该用户的帖子",
    risk: "推荐默认：比拉黑更克制，降低 X 风控风险",
  },
  block: {
    verb: "拉黑",
    gerund: "拉黑中",
    done: "已拉黑",
    queued: "待拉黑",
    active: "拉黑中",
    background: "后台拉黑",
    automatic: "自动拉黑",
    description: "拉黑用户，阻止该用户与你互动",
    risk: "高风险：短时间大量拉黑更容易触发 X 风控",
  },
};

export function normalizeModerationAction(action: unknown): ModerationAction {
  return action === "block" ? "block" : "mute";
}

export function actionApiPath(action: ModerationAction): string {
  return action === "block"
    ? "/i/api/1.1/blocks/create.json"
    : "/i/api/1.1/mutes/users/create.json";
}

export function actionLabels(action: ModerationAction): ModerationActionLabels {
  return LABELS[action];
}
