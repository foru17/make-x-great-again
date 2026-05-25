import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// Make X Great Again (MXGA) — strictly passive. Only the Worker host
// permission for our own API; X DOM is read via the content-script match.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  // Don't spawn a throwaway browser profile on `wxt dev`. Load the built
  // .output/chrome-mv3 into your own Chrome (logged into X) manually;
  // WXT still watches + hot-reloads it.
  webExt: { disabled: true },
  manifest: {
    name: "Make X Great Again",
    description:
      "Make X usable again. Passive AI: spam shield + KOL signal score + profile digest + social graph hints. Public-good, open source.",
    // Mascot 「小蓝」 — chubby blue bird with red MXGA cap, raised fist pose.
    // Generated PNGs live in extension/public/icon/<size>.png (WXT auto-picks
    // them up from `public/` so no extra config needed).
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
    permissions: ["storage"],
    host_permissions: [
      // Public Worker entry point (custom domain).
      "https://x.zuoluo.tv/*",
      // Legacy workers.dev URL kept as fallback for installs that still
      // hold an old edgeBase setting; safe to drop after the user base
      // has cycled the new release.
      "https://x-spam-sentinel-edge.zuoluotv.workers.dev/*",
      "https://github.com/*",
      "https://api.github.com/*",
      "http://127.0.0.1:8787/*",
      "http://localhost:8787/*",
    ],
    action: { default_title: "Make X Great Again" },
    options_ui: { open_in_tab: true },
  },
});
