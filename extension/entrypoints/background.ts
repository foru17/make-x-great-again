// The background script for the consumer-side extension.
// Zero remote requests: health check and blacklist size lookup are fully local.
// GitHub login/auth is disabled.
import type { BgRequest, BgResponse } from "../lib/types";

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (msg: BgRequest, _s: chrome.runtime.MessageSender, sendResponse: (r: BgResponse) => void) => {
      (async () => {
        try {
          if (msg.type === "health") {
            const { indexSize, warmLocalIndex } = await import("../lib/local-index");
            await warmLocalIndex();
            sendResponse({ ok: true, data: { records: indexSize() } });
          } else if (msg.type === "stats") {
            const { getStats } = await import("../lib/stats");
            sendResponse({ ok: true, data: await getStats() });
          } else if (msg.type === "records") {
            sendResponse({ ok: true, data: { records: [] } });
          } else if (msg.type === "gh_start") {
            sendResponse({ ok: false, error: "GitHub login is disabled in the consumption-side extension." });
          } else if (msg.type === "gh_poll") {
            sendResponse({ ok: false, error: "GitHub login is disabled in the consumption-side extension." });
          } else if (msg.type === "gh_status") {
            sendResponse({ ok: true, data: { login: "" } });
          } else if (msg.type === "gh_logout") {
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
