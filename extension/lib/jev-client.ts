// AI 判定客户端 —— 只在 background service worker 里运行：x.com 的 CSP 会挡掉
// 内容脚本的跨源 fetch，而 api.typesafe.ai 不对扩展源开放 CORS，得靠用户
// 授予的可选主机权限。这与举报 / 白名单申请走的是同一条路径。
//
// Key 由用户自备，存在本机 chrome.storage.local。

import {
  JEV_DEFAULT_MODEL,
  JEV_ENDPOINT,
  type JevJudgment,
  buildJevRequest,
  parseJevAnswers,
} from "./jev";
import type { Signals } from "./types";

export interface JevConfig {
  enabled: boolean;
  key: string;
  model: string;
}

export const JEV_CONFIG_KEY = "xss:jev:v1";
export const JEV_ORIGINS = ["https://api.typesafe.ai/*"];
export const JEV_DEFAULTS: JevConfig = { enabled: false, key: "", model: JEV_DEFAULT_MODEL };

export async function getJevConfig(): Promise<JevConfig> {
  try {
    const got = await chrome.storage.local.get(JEV_CONFIG_KEY);
    return { ...JEV_DEFAULTS, ...((got[JEV_CONFIG_KEY] as Partial<JevConfig>) ?? {}) };
  } catch {
    return { ...JEV_DEFAULTS };
  }
}

export async function setJevConfig(patch: Partial<JevConfig>): Promise<JevConfig> {
  const next = { ...(await getJevConfig()), ...patch };
  await chrome.storage.local.set({ [JEV_CONFIG_KEY]: next });
  return next;
}

/** 开着且填了 Key 才算可用。 */
export const jevReady = (c: JevConfig) => c.enabled && !!c.key.trim();

const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));

/**
 * 并发闸门。评论区一屏可能同时冒出十几个待判账号，不限流就会同时打出
 * 十几个请求 —— 既烧用户的额度又容易撞上 429。判定本来就是异步渲染的，
 * 排队即可。
 */
const MAX_CONCURRENT = 3;
let active = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release(): void {
  active--;
  waiting.shift()?.();
}

/** 一次账号判定。429 / 5xx（含 TypeSafe 的 529 过载）按官方建议指数退避重试。 */
export async function classifyWithJev(sig: Signals, cfg?: JevConfig): Promise<JevJudgment> {
  const c = cfg ?? (await getJevConfig());
  if (!c.key.trim()) throw new Error("jev_not_configured");
  const body = JSON.stringify(buildJevRequest(sig, c.model.trim() || JEV_DEFAULT_MODEL));
  await acquire();
  try {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await backoff(attempt - 1);
      let res: Response;
      try {
        res = await fetch(JEV_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${c.key.trim()}`,
            "content-type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        lastErr = err; // 网络错误 / 超时 —— 可重试
        continue;
      }
      if (res.ok) return parseJevAnswers(await res.json(), sig);
      const detail = `Jev HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) throw new Error(detail);
      lastErr = new Error(detail);
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  } finally {
    release();
  }
}

/** 设置页的「测试判定」：拿一个固定的良性样本走完整链路（不要求已开启）。 */
export async function testJev(): Promise<{ ms: number; label: string }> {
  const t0 = Date.now();
  const { verdict } = await classifyWithJev({
    isProfile: false,
    handle: "jack",
    displayName: "jack",
    bio: "no state is the best state",
    hasDefaultAvatar: false,
    recentTweets: ["just setting up my twttr"],
    accountAgeDays: 7000,
    followersCount: 6_000_000,
  });
  return { ms: Date.now() - t0, label: verdict.label };
}
