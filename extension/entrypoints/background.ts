// Background service worker: owns the remote blocklist sync (download-only —
// a public artifact GET; nothing about the user is ever uploaded) and serves
// local health/stats lookups for the popup.
import { syncIfStale, syncList } from "../lib/list-sync";
import type { BgRequest, BgResponse } from "../lib/types";

// ---- GitHub Device Flow (v0.4's login interaction, restored for the
// whitelist self-service). Public device-flow client id — NOT a secret
// (device flow has no client secret by design). The fetches live in the
// background because github.com's device endpoints don't serve CORS; the
// options page requests the optional github.com host permission first.
const GH_CLIENT_ID = "Ov23liP2AbdNePTyKUEA";

async function ghStart() {
  const r = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: GH_CLIENT_ID, scope: "read:user" }),
  });
  return (await r.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  };
}

async function ghPoll(deviceCode: string) {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: GH_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const j = (await r.json()) as { access_token?: string; error?: string };
  if (!j.access_token) return { pending: j.error ?? "pending" };
  const { setGh } = await import("../lib/auth");
  const u = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${j.access_token}`, accept: "application/vnd.github+json" },
  });
  const user = (await u.json()) as { login?: string };
  await setGh(j.access_token, user.login ?? "github");
  return { login: user.login ?? "github" };
}

const SYNC_ALARM = "xss:list-sync";
// 6h cadence matches the server's mirror cron; the artifact itself only
// changes when the confirmed set changes, and version-match syncs are a
// single small meta GET.
const SYNC_PERIOD_MIN = 360;

export default defineBackground(() => {
  const ensureAlarm = () => {
    try {
      chrome.alarms.create(SYNC_ALARM, {
        periodInMinutes: SYNC_PERIOD_MIN,
        delayInMinutes: 1,
      });
    } catch {
      /* non-fatal */
    }
  };

  chrome.runtime.onInstalled.addListener(() => {
    ensureAlarm();
    void syncList(true); // fresh install / update → fetch immediately
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureAlarm();
    void syncIfStale();
  });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === SYNC_ALARM) void syncList();
  });

  chrome.runtime.onMessage.addListener(
    (msg: BgRequest, _s: chrome.runtime.MessageSender, sendResponse: (r: BgResponse) => void) => {
      (async () => {
        try {
          if (msg.type === "health") {
            const { indexSize, warmLocalIndex } = await import("../lib/local-index");
            const { getStoredList } = await import("../lib/list-sync");
            await warmLocalIndex();
            const stored = await getStoredList();
            sendResponse({
              ok: true,
              data: {
                records: stored?.count ?? indexSize(),
                listVersion: stored?.version ?? null,
                listFetchedAt: stored?.fetchedAt ?? null,
              },
            });
          } else if (msg.type === "list-sync") {
            sendResponse({ ok: true, data: await syncList(!!msg.force) });
          } else if (msg.type === "stats") {
            const { getStats } = await import("../lib/stats");
            sendResponse({ ok: true, data: await getStats() });
          } else if (msg.type === "records") {
            sendResponse({ ok: true, data: { records: [] } });
          } else if (msg.type === "gh_start") {
            sendResponse({ ok: true, data: await ghStart() });
          } else if (msg.type === "gh_poll") {
            sendResponse({ ok: true, data: await ghPoll(msg.deviceCode) });
          } else if (msg.type === "auth_status") {
            const { getGhToken } = await import("../lib/auth");
            sendResponse({ ok: true, data: { authenticated: !!(await getGhToken()) } });
          } else if (msg.type === "open_options") {
            chrome.runtime.openOptionsPage();
            sendResponse({ ok: true });
          } else if (msg.type === "classify") {
            const { getGhToken } = await import("../lib/auth");
            const { edgeBase } = await import("../lib/list-sync");
            const { postOnlineClassification } = await import("../lib/online-detection");
            sendResponse(
              await postOnlineClassification({
                base: await edgeBase(),
                token: (await getGhToken()) || null,
                sig: msg.sig,
              }),
            );
          } else if (msg.type === "report") {
            // Authenticated POST /v1/report from the SHARED extension origin
            // (same path the whitelist-apply flow uses), not the content
            // script — x.com's CORS/CSP would otherwise block it.
            const { getGhToken } = await import("../lib/auth");
            const { edgeBase } = await import("../lib/list-sync");
            const token = await getGhToken();
            if (!token) {
              sendResponse({ ok: false, error: "no_token" });
            } else {
              const base = await edgeBase();
              const res = await fetch(`${base}/v1/report`, {
                method: "POST",
                headers: {
                  authorization: `Bearer ${token}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify(msg.sig),
              });
              let body: unknown = {};
              try {
                body = await res.json();
              } catch {
                /* non-JSON error page */
              }
              sendResponse({ ok: true, data: { status: res.status, body } });
            }
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
