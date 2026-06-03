import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// x-spam-sentinel — strictly passive. Only localhost host permission; no
// X host permissions beyond the content-script match (we only read the DOM
// already rendered for the user).
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  // Don't spawn a throwaway browser profile on `wxt dev`. Load the built
  // .output/chrome-mv3 into your own Chrome (logged into X) manually; WXT
  // still watches + hot-reloads it.
  webExt: { disabled: true },
  // Force Manifest V3 for all browsers (including Firefox).
  manifestVersion: 3,
  manifest: {
    name: "x-spam-sentinel",
    description:
      "Passive AI spam / porn-bot detection for X. Public-good, open source.",
    permissions: ["storage"],
    host_permissions: [
      // Public Worker entry point (custom domain).
      "https://x.zuoluo.tv/*",
      // Legacy workers.dev URL — kept so installs that still have an old
      // edgeBase setting can still talk to the Worker until they update.
      "https://x-spam-sentinel-edge.zuoluotv.workers.dev/*",
      "https://github.com/*",
      "https://api.github.com/*",
      "http://127.0.0.1:8787/*",
      "http://localhost:8787/*",
    ],
    action: { default_title: "x-spam-sentinel" },
    options_ui: { open_in_tab: true },
  },
});
