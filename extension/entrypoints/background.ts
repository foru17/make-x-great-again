// The only place that talks to the service / GitHub, so page CSP/CORS never
// blocks us. Edge Worker /v1 API + GitHub Device-Flow login + admin proxy.
// NOTE: Consumer-side classify/confirm/lookup are now LOCAL (no remote calls).
// This background script only handles GitHub auth for admin users.
import { GH_CLIENT_ID, getGhToken, setGh } from "../lib/auth";
import { BRAND } from "../lib/brand";
import { getSettings } from "../lib/settings";
import type { BgRequest, BgResponse } from "../lib/types";

const DEFAULT_BASE = BRAND.edgeBase;

async function base(): Promise<string> {
  return (await getSettings()).edgeBase || DEFAULT_BASE;
}

async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch((await base()) + path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as Record<string, unknown>;
}

// ---- GitHub Device Flow (background = cross-origin allowed via host perms) ----
async function ghStart() {
  const clientId = GH_CLIENT_ID;
  if (!clientId) throw new Error("未配置 GitHub OAuth App client_id（管理面板·设置）");
  const r = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: "read:user" }),
  });
  const j = (await r.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  };
  return j;
}

async function ghPoll(deviceCode: string) {
  const clientId = GH_CLIENT_ID;
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const j = (await r.json()) as { access_token?: string; error?: string };
  if (!j.access_token) return { pending: j.error ?? "pending" };
  const u = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${j.access_token}`, "user-agent": "x-spam-sentinel" },
  });
  const user = (await u.json()) as { login?: string };
  await setGh(j.access_token, user.login ?? "github");
  return { login: user.login ?? "github" };
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (msg: BgRequest, _s: chrome.runtime.MessageSender, sendResponse: (r: BgResponse) => void) => {
      (async () => {
        try {
          if (msg.type === "health") {
            const h = await call("/v1/health");
            sendResponse({ ok: true, data: { records: (h.published as number) ?? 0 } });
          } else if (msg.type === "records") {
            sendResponse({ ok: true, data: { records: [] } });
          } else if (msg.type === "gh_start") {
            sendResponse({ ok: true, data: await ghStart() });
          } else if (msg.type === "gh_poll") {
            sendResponse({ ok: true, data: await ghPoll(msg.deviceCode) });
          } else if (msg.type === "gh_status") {
            const { getGhLogin } = await import("../lib/auth");
            sendResponse({ ok: true, data: { login: await getGhLogin() } });
          } else if (msg.type === "gh_logout") {
            const { clearGh } = await import("../lib/auth");
            await clearGh();
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: "unknown message" });
          }
        } catch (e) {
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      })();
      return true; // async response
    },
  );
});
