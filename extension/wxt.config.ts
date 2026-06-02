import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// Make X Great Again (MXGA) — strictly passive. Only the Worker host
// permission for our own API; X DOM is read via the content-script match.
//
// Manifest is generated per-mode so the production build that ships to the
// Chrome Web Store doesn't contain dev-only host permissions (localhost,
// 127.0.0.1) — reviewers reject those.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  // Don't spawn a throwaway browser profile on `wxt dev`. Load the built
  // .output/chrome-mv3 into your own Chrome (logged into X) manually;
  // WXT still watches + hot-reloads it.
  webExt: { disabled: true },
  // data_collection_permissions is already declared in manifest below (none: true).
  // This silences WXT's redundant build-time reminder.
  suppressWarnings: { firefoxDataCollection: true },
  manifest: ({ mode }) => ({
    // Brand-forward name. CWS_LISTING.md keeps the fallback copy in case the
    // listing needs a more neutral store-facing title.
    name: "Make X Great Again",
    // Single-purpose description — what's shipped today, plus the framing
    // that anchors the brand: AI-driven, ambient, privacy-first.
    description:
      "AI 驱动的 X 旁路扩展 · 你刷 X 时它在后台静默识别色情/广告 spam 机器人，给你一键真拉黑。完全开源，零数据收集。",
    // Optional but recommended — author + homepage_url improve listing trust.
    author: { email: "foru17@foxmail.com" },
    homepage_url: "https://x.zuoluo.tv",
    // Mascot 「小蓝」 — chubby blue bird with red MXGA cap, raised fist pose.
    // Generated PNGs live in extension/public/icon/<size>.png (WXT auto-picks
    // them up from `public/` so no extra config needed).
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
    // `alarms` lets the background worker schedule a 6h whitelist refresh
    // (local L0a cache) without keeping the SW pinned awake.
    permissions: ["storage", "alarms"],
    host_permissions: [
      // Public Worker entry point (custom domain).
      "https://x.zuoluo.tv/*",
      // Legacy workers.dev URL — kept as a fallback ONLY for installs that
      // still hold an old edgeBase setting; drop after the user base has
      // fully cycled to the custom domain (post v0.3.x).
      "https://x-spam-sentinel-edge.zuoluotv.workers.dev/*",
      // GitHub Device Flow OAuth + user lookup. Narrowed from the previous
      // blanket `https://github.com/*` + `https://api.github.com/*` grants
      // to only the three endpoints we actually call — passes a stricter
      // reviewer audit and minimizes user-facing permission prompts.
      // Endpoints:
      //   POST https://github.com/login/device/code      (start device flow)
      //   POST https://github.com/login/oauth/access_token (poll for token)
      //   GET  https://api.github.com/user               (fetch numeric id)
      "https://github.com/login/*",
      "https://api.github.com/user",
      // Dev-only — never shipped to the Web Store.
      ...(mode === "development"
        ? ["http://127.0.0.1:8787/*", "http://localhost:8787/*"]
        : []),
    ],
    action: { default_title: "MXGA" },
    options_ui: { open_in_tab: true },
    // Firefox AMO requirement (Nov 2025+): declare that this extension
    // collects no user data. Matches the "零数据收集" promise in the description.
    data_collection_permissions: { none: true },
  }),
});
