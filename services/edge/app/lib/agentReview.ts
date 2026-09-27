export interface AgentReviewLike {
  agent_label?: string;
  agent_signals?: string;
  agent_reasons?: string;
  agent_evidence?: string;
}

export interface AgentReviewSummary {
  conclusion: string;
  signals: string[];
  reasons: string[];
  evidence: string[];
}

const CONCLUSION_ZH: Record<string, string> = {
  spam: "高度疑似垃圾营销账号",
  porn_bot: "高度疑似色情招揽账号",
  likely_spam: "存在多项垃圾行为特征",
  legit: "更像正常用户，建议加入白名单",
  uncertain: "现有证据不足，建议人工复核",
};

const SIGNAL_ZH: Record<string, string> = {
  P1: "内容含色情或约炮推广",
  P2: "多次发布重复模板",
  P3: "回复与原话题无关，并带有引流",
  P5: "新账号、粉丝少且频繁促销",
  P6: "疑似诈骗、博彩或黑灰产推广",
  P7: "头像带有联系方式或促销文字",
  P8: "头像包含明显色情招揽内容",
  S1: "账号注册不足 90 天",
  S2: "粉丝数较少",
  S3: "关注数与粉丝数比例异常",
  S4: "发帖频率异常高",
  S5: "外链高度集中",
  S6: "存在泛化拉客或引流话术",
  L1: "内容更像真实个人表达",
  L2: "推广内容指向明确的自有产品",
  L3: "长期内容主题一致",
  L4: "粉丝与互动结构正常",
  N1: "粉丝较多，误伤风险较高",
  N2: "大号，需谨慎处理",
  N3: "老账号且内容主题稳定",
  N4: "存在正常的多轮对话",
  A1: "涉及观点或身份议题，需人工判断",
  A2: "可用内容太少，无法可靠判断",
  A3: "账号可能已停用或被封禁",
  A4: "只有账号名可疑，内容证据不足",
  hard_evidence: "存在直接垃圾推广证据",
  "hard evidence": "存在直接垃圾推广证据",
  bio_link_pattern: "简介带有重复引流链接",
};

function stringArray(raw: string | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function evidenceObject(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

function naturalReason(reason: string): string | null {
  const normalized = reason.replace(/_/g, " ").trim();
  const lower = normalized.toLowerCase();
  if (lower.includes("bio and recent replies") && lower.includes("off-site contact prompts")) {
    return "简介和近期回复反复引导到站外联系";
  }
  if (lower.includes("high confidence") && lower.includes("coordinated reply spam")) {
    return "多条回复高度重复，并带有明显引流意图";
  }
  if (lower.includes("avatar") && /promo|overlay|watermark/.test(lower)) {
    return "头像带有明显的促销文字或联系方式";
  }
  if (lower.includes("off-topic") && /promo|redirect|link bait/.test(lower)) {
    return "回复偏离原话题，并引导用户前往其它页面";
  }

  const code = normalized.match(/\b([PSLNA]\d+)\b/i)?.[1]?.toUpperCase();
  const withoutJargon = normalized
    .replace(/^\s*(?:[PSLNA]\d+\s*)?(?:hard\s+evidence\s*)?[:：·-]?\s*/i, "")
    .replace(/hard\s+evidence/gi, "直接证据")
    .trim();
  if (/[㐀-鿿]/.test(withoutJargon)) return withoutJargon;
  return code ? SIGNAL_ZH[code] || null : null;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function evidenceLabels(raw: string | undefined): string[] {
  const evidence = evidenceObject(raw);
  const labels: string[] = [];
  const accountAge = finiteNumber(evidence.account_age_days);
  const followers = finiteNumber(evidence.follower_count);
  const postingRate = finiteNumber(evidence.posting_rate_per_day);
  const offTopic = finiteNumber(evidence.reply_offtopic_ratio);
  if (accountAge != null) labels.push(`账号注册 ${Math.round(accountAge).toLocaleString("zh-CN")} 天`);
  if (followers != null) labels.push(`粉丝 ${Math.round(followers).toLocaleString("zh-CN")}`);
  if (postingRate != null) labels.push(`每天约 ${postingRate.toLocaleString("zh-CN")} 条发言`);
  if (offTopic != null) labels.push(`回复跑题 ${Math.round(offTopic * 100)}%`);

  const xStatus = typeof evidence.x_status === "string" ? evidence.x_status : "";
  const statusLabel: Record<string, string> = {
    suspended: "账号已被暂停",
    locked: "账号目前受限",
    deleted: "账号已删除",
    not_found: "账号已不存在",
  };
  if (statusLabel[xStatus]) labels.push(statusLabel[xStatus]);
  if (evidence.profile_pic_present === false) labels.push("未设置头像");
  return labels;
}

export function summarizeAgentReview(a: AgentReviewLike): AgentReviewSummary {
  return {
    conclusion: CONCLUSION_ZH[a.agent_label || "uncertain"] || "建议人工复核",
    signals: unique(stringArray(a.agent_signals).map((signal) => SIGNAL_ZH[signal] || null)),
    reasons: unique(stringArray(a.agent_reasons).map(naturalReason)),
    evidence: evidenceLabels(a.agent_evidence),
  };
}
