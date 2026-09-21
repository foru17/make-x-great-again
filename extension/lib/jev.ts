// AI 判定（TypeSafe Jev）—— 纯函数：构造请求 + 把概率答案映射回 Verdict。
//
// Jev 不生成文本，而是对「state + 类型化问题」直接返回概率分布
// （https://docs.typesafe.ai/api）。所以这里没有 prompt 拼接、没有 JSON 抽取：
// 服务端 SYSTEM prompt（services/edge/src/index.ts）里的几条特判拆成独立的
// 问题，一次请求并行问完，组合逻辑与阈值留在代码里，可以直接拿真实数据调。
//
// 用户自带 API Key，请求由扩展直接发往 TypeSafe，不经过本项目的服务器。

import type { SpamCategory } from "./category";
import type { Signals, Verdict } from "./types";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-latest";

// 攻击者可控字段的长度上限，与服务端 Signals 的截断口径一致：一个恶意
// profile 不得撑爆请求（token 成本）。
const MAX_HANDLE_CHARS = 60;
const MAX_DISPLAY_NAME_CHARS = 200;
const MAX_BIO_CHARS = 500;
const MAX_TWEET_CHARS = 500;
const MAX_TWEETS = 20;
const MAX_COMMENT_CHARS = 1000;
const MAX_TOPIC_CHARS = 500;

/** 垃圾类（porn_bot + spam）合计概率达到它才算命中。 */
export const ACT_AT = 0.85;
/** 老号（>2 年且有真实粉丝）要求更高 —— 服务端 prompt 的「老号偏向正常」。 */
export const ACT_AT_ESTABLISHED = 0.95;
/** 判为正常所需的概率。 */
export const LEGIT_AT = 0.8;
/** 垃圾类概率过半但没到命中线 → likely_spam（只标记）。 */
export const LIKELY_AT = 0.5;
/** 无链接引流话术 / 昵称简介里的色情广告话术：命中即视为色情引流号。 */
export const SEXUAL_EVIDENCE_AT = 0.9;
/** 真实商家的正常推广：没有色情证据时一票否决命中，最多只标记。 */
export const COMMERCE_AT = 0.8;

const VERDICT_OPTIONS = {
  porn_bot:
    "Pornographic / escort advertising bot: sexual solicitation or innuendo, escort copy " +
    "(同城上门, 上门喝茶, 喝茶选妃, 免费破处, 找炮友, 真实约见, 约, 看主页, 点击主页, 主页简介), " +
    "or a short sexual reply that redirects to another account, usually unrelated to the thread.",
  spam:
    "Commercial spam bot that is not sexual: crypto / investment / giveaway scams, gambling, " +
    "phishing, pirated-resource or link promotion, engagement farming unrelated to the thread.",
  legit:
    "A genuine person or legitimate business — including rude, off-topic, political, " +
    "low-activity users, and ordinary self-promotion by a real account.",
  uncertain:
    "Not enough evidence either way, e.g. a thin profile on an older account with no " +
    "promotional or sexual content.",
} as const;

type VerdictOption = keyof typeof VERDICT_OPTIONS;

const CATEGORY_OPTIONS: Record<SpamCategory, string> = {
  porn: "Sexual / escort solicitation or porn-site funneling",
  crypto: "Crypto, trading signals, investment or giveaway scams",
  gambling: "Online casinos, betting, lottery",
  resource: "Pirated resources, cloud-drive links, paid content groups",
  marketing: "Other product ads, follower / engagement selling, traffic funneling",
  other: "None of the above",
};

export interface JevRequest {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
}

const cap = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…[truncated]` : text;

/** state 用具名 JSON 字段，问题里用反引号路径引用它们。缺失值写 null 而不是省略。 */
export function buildJevRequest(s: Signals, model = JEV_DEFAULT_MODEL): JevRequest {
  const account = {
    handle: cap(s.handle, MAX_HANDLE_CHARS),
    displayName: cap(s.displayName, MAX_DISPLAY_NAME_CHARS),
    bio: cap(s.bio, MAX_BIO_CHARS),
    recentTweets: s.recentTweets.slice(0, MAX_TWEETS).map((t) => cap(t, MAX_TWEET_CHARS)),
    accountAgeDays: s.accountAgeDays ?? null,
    followers: s.followersCount ?? null,
    following: s.followingCount ?? null,
    hasDefaultAvatar: s.hasDefaultAvatar,
    tweetsAreMachineTranslated: s.tweetsTranslated === true,
  };
  const context = {
    threadTopic: s.threadTopic === undefined ? null : cap(s.threadTopic, MAX_TOPIC_CHARS),
    triggeringComment:
      s.triggeringComment === undefined ? null : cap(s.triggeringComment, MAX_COMMENT_CHARS),
  };
  return {
    model,
    state: { account, context },
    questions: {
      verdict: {
        type: "choice",
        instructions:
          "Classify the X (Twitter) account in `account` strictly for spam / " +
          "pornographic-advertising bot abuse. `context.triggeringComment` is the reply " +
          "that surfaced it and `context.threadTopic` is the post it replied to. Judge only " +
          "commercial spam and porn-ad bot behavior — never viewpoints, politics, language, " +
          "or who someone is. A brand-new account (accountAgeDays < 30) with default avatar, " +
          "near-zero followers and promotional or escort wording is almost certainly a bot; " +
          "an old established account should lean legit unless the spam evidence is blatant. " +
          "If `account.tweetsAreMachineTranslated` is true, the tweet language is not the " +
          "author's own and is no signal. Public false accusations are harmful.",
        criteria: VERDICT_OPTIONS,
      },
      category: {
        type: "choice",
        instructions:
          "Assuming `account` is a spam or porn-advertising bot, which kind of spam does it " +
          "mainly push?",
        criteria: CATEGORY_OPTIONS,
      },
      redirect_bait: {
        type: "noul",
        instructions:
          "Is `context.triggeringComment` (or a post in `account.recentTweets`) linkless " +
          "redirect bait: a short sexual-innuendo or solicitation line (e.g. 她好涩, 我不行了, " +
          "约, 看主页, 主页能打, 线下) that @mentions or points to another account, often " +
          "padded with garbled filler characters, and unrelated to `context.threadTopic`?",
        criteria: {
          true: "Sexual / solicitation bait redirecting to another account or profile",
          false: "An ordinary reply, even if rude, sexual joke, or off-topic, with no redirect",
        },
      },
      escort_copy: {
        type: "noul",
        instructions:
          "Does `account.displayName` or `account.bio` contain fixed escort / sexual-service " +
          "advertising copy — e.g. 同城上门, 上门喝茶, 喝茶选妃, 免费破处, 处男无偿, 找炮友, " +
          "真实约见, 点击主页, 查看主页简介, 主页简介, or equivalent wording in any language?",
        criteria: {
          true: "The name or bio advertises sexual services or funnels to them",
          false: "Ordinary name / bio, including dating-neutral, adult-humor, or empty ones",
        },
      },
      legit_commerce: {
        type: "noul",
        instructions:
          "Is `account` a real, identifiable business or creator promoting its own products or " +
          "work in an ordinary way (consistent brand identity, on-topic posts, no scams, no " +
          "sexual services, no mass off-topic replies)?",
        criteria: {
          true: "Legitimate commerce or self-promotion by a real business or creator",
          false: "Not a business, or promotion that is scammy, sexual, or spammed off-topic",
        },
      },
    },
  };
}

export interface JevJudgment {
  verdict: Verdict;
  category: SpamCategory;
}

interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
}
interface NoulAnswer {
  type: "noul";
  noul: number;
}

const pct = (p: number) => p.toFixed(2);

/**
 * Jev 响应 → Verdict + 类别。主判定形状不对就抛，绝不默认成 spam —— 一个被
 * 静默默认成 spam 的解析失败就是一次误杀。辅助 Noul 缺失按 0 处理：它们只会
 * 加严或否决，缺了就退回纯主判定。reasons 用英文短句，与服务端判定理由同口径，
 * 好让 reason-category 的现有正则归类。
 */
export function parseJevAnswers(raw: unknown, s: Signals): JevJudgment {
  const answers = (raw as { answers?: Record<string, unknown> } | null)?.answers;
  const v = answers?.verdict as ChoiceAnswer | undefined;
  if (!v || v.type !== "choice" || !v.probabilities) throw new Error("Jev: missing verdict answer");
  const p = (k: VerdictOption) => {
    const x = v.probabilities[k];
    if (typeof x !== "number" || !Number.isFinite(x)) throw new Error(`Jev: bad probability ${k}`);
    return x;
  };
  const porn = p("porn_bot");
  const spam = p("spam");
  const legit = p("legit");
  const unsure = p("uncertain");
  const noul = (id: string) => {
    const a = answers?.[id] as NoulAnswer | undefined;
    return a?.type === "noul" && Number.isFinite(a.noul) ? a.noul : 0;
  };
  const bait = noul("redirect_bait");
  const escort = noul("escort_copy");
  const commerce = noul("legit_commerce");

  const established = (s.accountAgeDays ?? 0) > 730 && (s.followersCount ?? 0) >= 50;
  const bar = established ? ACT_AT_ESTABLISHED : ACT_AT;
  // 引流话术 / 色情广告话术是服务端 prompt 里「不许判 uncertain」的两类硬证据。
  const sexualEvidence = Math.max(
    bait >= SEXUAL_EVIDENCE_AT ? bait : 0,
    escort >= SEXUAL_EVIDENCE_AT ? escort : 0,
  );
  const bad = Math.max(porn + spam, sexualEvidence);
  const pornish = sexualEvidence > 0 || porn >= spam;
  // 正常商家推广否决命中 —— 但色情证据成立时不听它的（色情号常伪装成店铺）。
  const commerceVeto = commerce >= COMMERCE_AT && sexualEvidence === 0;

  const reasons: string[] = [];
  if (porn >= 0.2) reasons.push(`porn / escort solicitation (p=${pct(porn)})`);
  if (spam >= 0.2) reasons.push(`commercial spam promotion (p=${pct(spam)})`);
  if (bait >= 0.5) reasons.push(`linkless redirect bait with @mention (p=${pct(bait)})`);
  if (escort >= 0.5) reasons.push(`escort advertising copy in name/bio (p=${pct(escort)})`);
  if (commerce >= 0.5) reasons.push(`legitimate business self-promotion (p=${pct(commerce)})`);
  if (legit >= 0.2) reasons.push(`looks like a genuine account (p=${pct(legit)})`);
  if (!reasons.length) reasons.push(`insufficient evidence (p=${pct(unsure)})`);
  if (established && bad >= ACT_AT && bad < bar) {
    reasons.push("established account — held to a higher bar");
  }
  if (commerceVeto && bad >= bar) reasons.push("legitimate commerce — not acted on");

  const verdict: Verdict =
    bad >= bar && !commerceVeto
      ? { label: pornish ? "porn_bot" : "spam", confidence: bad, reasons }
      : legit >= LEGIT_AT
        ? { label: "legit", confidence: legit, reasons }
        : bad >= LIKELY_AT
          ? { label: "likely_spam", confidence: bad, reasons }
          : { label: "uncertain", confidence: Math.max(unsure, legit), reasons };

  // 色情引流号的类别恒为 porn，别让类别题把它分去别处；其余取类别题的答案。
  const c = answers?.category as ChoiceAnswer | undefined;
  const picked: SpamCategory =
    c?.type === "choice" && c.choice in CATEGORY_OPTIONS ? (c.choice as SpamCategory) : "other";
  const category = verdict.label === "porn_bot" ? "porn" : picked;
  return { verdict, category };
}
