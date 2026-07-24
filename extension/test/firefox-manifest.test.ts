import assert from "node:assert/strict";
import test from "node:test";
import config from "../wxt.config";

test("Firefox manifest uses the consent-compatible release baselines", async () => {
  assert.equal(config.manifestVersion, 3);
  assert.equal(typeof config.manifest, "function");
  if (typeof config.manifest !== "function") return;

  const manifest = await config.manifest({
    browser: "firefox",
    command: "build",
    manifestVersion: 3,
    mode: "production",
  });
  const settings = manifest.browser_specific_settings;

  assert.equal(settings?.gecko?.id, "x-spam-sentinel@zuoluo.tv");
  assert.equal(settings?.gecko?.strict_min_version, "140.0");
  assert.equal(settings?.gecko_android?.strict_min_version, "142.0");
  assert.deepEqual(settings?.gecko?.data_collection_permissions, {
    required: ["none"],
    optional: ["authenticationInfo", "personallyIdentifyingInfo"],
  });
  assert.deepEqual(manifest.optional_permissions, [
    "*://x.com/*",
    "*://twitter.com/*",
    "https://github.com/*",
  ]);
  assert.equal(manifest.optional_host_permissions, undefined);
});
