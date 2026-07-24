#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Expected --name value arguments, received: ${argv.join(" ")}`);
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function required(options, key) {
  const value = options[key];
  if (!value) throw new Error(`Missing required --${key} argument`);
  return path.resolve(value);
}

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(file));
  return hash.digest("hex");
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a GeckoDriver port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(label, callback, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ""}`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const driverPath = required(options, "geckodriver");
  const firefoxBinary = required(options, "firefox");
  const addonPath = required(options, "addon");
  const outputDir = required(options, "output");
  const manifestPath = path.join(path.dirname(addonPath), "firefox-mv3", "manifest.json");

  await Promise.all([
    fs.access(driverPath),
    fs.access(firefoxBinary),
    fs.access(addonPath),
    fs.access(manifestPath),
    fs.mkdir(outputDir, { recursive: true }),
  ]);

  const reportPath = path.join(outputDir, "runtime-smoke.json");
  const driverLogPath = path.join(outputDir, "geckodriver.log");
  const popupScreenshot = path.join(outputDir, "firefox-popup.png");
  const optionsScreenshot = path.join(outputDir, "firefox-options-settings.png");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logChunks = [];
  const driver = spawn(
    driverPath,
    ["--allow-system-access", "--host", "127.0.0.1", "--port", String(port), "--log", "debug"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const collectLog = (chunk) => {
    logChunks.push(chunk.toString());
    if (logChunks.length > 2_000) logChunks.splice(0, logChunks.length - 2_000);
  };
  driver.stdout.on("data", collectLog);
  driver.stderr.on("data", collectLog);

  let sessionId;
  let addonId;
  let passed = false;
  const report = {
    startedAt: new Date().toISOString(),
    artifact: {
      addonPath,
      addonSha256: await sha256(addonPath),
      manifestPath,
      manifestSha256: await sha256(manifestPath),
    },
  };

  async function command(endpoint, method = "GET", body) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json();
    if (!response.ok || payload.value?.error) {
      throw new Error(
        `WebDriver ${method} ${endpoint} failed: ${JSON.stringify(payload.value ?? payload)}`,
      );
    }
    return payload.value;
  }

  const sessionCommand = (endpoint, method = "GET", body) =>
    command(`/session/${sessionId}${endpoint}`, method, body);
  const execute = (script, args = []) =>
    sessionCommand("/execute/sync", "POST", { script, args });
  const executeAsync = (script, args = []) =>
    sessionCommand("/execute/async", "POST", { script, args });
  const navigate = (url) => sessionCommand("/url", "POST", { url });
  const bodyText = () => execute("return document.body?.innerText || '';");
  const currentUrl = () => sessionCommand("/url");
  const windowHandles = () => sessionCommand("/window/handles");
  const switchWindow = (handle) => sessionCommand("/window", "POST", { handle });
  const setWindowRect = (width, height) =>
    sessionCommand("/window/rect", "POST", { width, height });
  const setContext = (context) => sessionCommand("/moz/context", "POST", { context });

  async function screenshot(file) {
    const encoded = await sessionCommand("/screenshot");
    await fs.writeFile(file, Buffer.from(encoded, "base64"));
    return { path: file, sha256: await sha256(file) };
  }

  async function storageSettings() {
    return await executeAsync(`
      const done = arguments[arguments.length - 1];
      chrome.storage.local.get("xss:settings", (value) => {
        const error = chrome.runtime.lastError?.message;
        done({ value: value?.["xss:settings"] ?? null, error: error ?? null });
      });
    `);
  }

  try {
    await waitUntil("GeckoDriver readiness", async () => {
      const response = await fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    });

    const session = await command("/session", "POST", {
      capabilities: {
        alwaysMatch: {
          browserName: "firefox",
          acceptInsecureCerts: true,
          "moz:firefoxOptions": {
            binary: firefoxBinary,
            args: ["-headless"],
            prefs: {
              "browser.shell.checkDefaultBrowser": false,
              "browser.startup.page": 0,
              "datareporting.healthreport.uploadEnabled": false,
              "datareporting.policy.dataSubmissionEnabled": false,
              "devtools.console.stdout.content": true,
              "toolkit.telemetry.reportingpolicy.firstRun": false,
            },
            log: { level: "trace" },
          },
        },
      },
    });
    sessionId = session.sessionId;
    report.runtime = {
      browserName: session.capabilities.browserName,
      browserVersion: session.capabilities.browserVersion,
      platformName: session.capabilities.platformName,
      acceptInsecureCerts: session.capabilities.acceptInsecureCerts,
      profileIsolation: "GeckoDriver-created temporary profile",
    };

    addonId = await sessionCommand("/moz/addon/install", "POST", {
      path: addonPath,
      temporary: true,
    });
    if (addonId !== "x-spam-sentinel@zuoluo.tv") {
      throw new Error(`Firefox returned unexpected add-on ID: ${addonId}`);
    }

    await setContext("chrome");
    const uuidPreference = await execute(`
      return Services.prefs.getStringPref("extensions.webextensions.uuids", "{}");
    `);
    const extensionUuid = JSON.parse(uuidPreference)[addonId];
    if (!extensionUuid) throw new Error(`No runtime UUID found for ${addonId}`);
    report.install = { addonId, extensionUuid, temporary: true };
    await setContext("content");

    const extensionOrigin = `moz-extension://${extensionUuid}`;
    await setWindowRect(520, 720);
    await navigate(`${extensionOrigin}/popup.html`);
    const popupText = await waitUntil("popup background response", async () => {
      const text = await bodyText();
      return /名单已同步|名单未同步/.test(text) ? text : "";
    }, 30_000);
    const health = await executeAsync(`
      const done = arguments[arguments.length - 1];
      chrome.runtime.sendMessage({ type: "health" }, (response) => {
        const error = chrome.runtime.lastError?.message;
        done({ response: response ?? null, error: error ?? null });
      });
    `);
    if (health.error || !health.response?.ok) {
      throw new Error(`Background health message failed: ${JSON.stringify(health)}`);
    }
    const popupShot = await screenshot(popupScreenshot);

    const handlesBefore = await windowHandles();
    const opened = await execute(`
      const button = [...document.querySelectorAll("button")]
        .find((item) => item.textContent?.includes("打开管理面板"));
      if (!button) return false;
      button.click();
      return true;
    `);
    if (!opened) throw new Error("Popup management button was not found");
    const handlesAfter = await waitUntil("options tab opened from popup", async () => {
      const handles = await windowHandles();
      return handles.length > handlesBefore.length ? handles : null;
    });
    const optionsHandle = handlesAfter.find((handle) => !handlesBefore.includes(handle));
    if (!optionsHandle) throw new Error("Could not identify the options window handle");
    await switchWindow(optionsHandle);
    const optionsUrl = await waitUntil("options URL", async () => {
      const url = await currentUrl();
      return url.startsWith(`${extensionOrigin}/options.html`) ? url : "";
    });
    const overviewText = await waitUntil("options overview", async () => {
      const text = await bodyText();
      return text.includes("概览") && text.includes("关于") ? text : "";
    });

    const settingsClicked = await execute(`
      const button = [...document.querySelectorAll("button")]
        .find((item) => item.textContent?.trim() === "设置");
      if (!button) return false;
      button.click();
      return true;
    `);
    if (!settingsClicked) throw new Error("Options settings navigation was not found");
    const settingsText = await waitUntil("settings page", async () => {
      const text = await bodyText();
      return text.includes("检测行为") && text.includes("自动处理策略") ? text : "";
    });
    await setWindowRect(1440, 900);

    const initialSwitch = await execute(`
      const item = [...document.querySelectorAll('[role="switch"]')]
        .find((node) => node.parentElement?.innerText.includes("显示角标气泡"));
      return item ? item.getAttribute("aria-checked") : null;
    `);
    if (initialSwitch !== "true") {
      throw new Error(`Fresh-profile bubble switch was expected true, received ${initialSwitch}`);
    }
    const initialStorage = await storageSettings();
    if (initialStorage.error) throw new Error(`Initial storage read failed: ${initialStorage.error}`);

    const toggled = await execute(`
      const item = [...document.querySelectorAll('[role="switch"]')]
        .find((node) => node.parentElement?.innerText.includes("显示角标气泡"));
      if (!item) return false;
      item.click();
      return true;
    `);
    if (!toggled) throw new Error("Bubble switch could not be clicked");
    const disabledStorage = await waitUntil("bubble setting persistence", async () => {
      const stored = await storageSettings();
      return stored.value?.bubble === false ? stored : null;
    });

    await navigate(await currentUrl());
    const disabledAfterReload = await waitUntil("bubble setting after reload", async () => {
      const state = await execute(`
        const item = [...document.querySelectorAll('[role="switch"]')]
          .find((node) => node.parentElement?.innerText.includes("显示角标气泡"));
        return item?.getAttribute("aria-checked") ?? null;
      `);
      return state === "false" ? state : null;
    });

    const restored = await execute(`
      const item = [...document.querySelectorAll('[role="switch"]')]
        .find((node) => node.parentElement?.innerText.includes("显示角标气泡"));
      if (!item) return false;
      item.click();
      return true;
    `);
    if (!restored) throw new Error("Bubble switch could not be restored");
    const restoredStorage = await waitUntil("bubble setting restoration", async () => {
      const stored = await storageSettings();
      return stored.value?.bubble === true ? stored : null;
    });
    const restoredSwitch = await waitUntil("bubble switch restoration", async () => {
      const state = await execute(`
        const item = [...document.querySelectorAll('[role="switch"]')]
          .find((node) => node.parentElement?.innerText.includes("显示角标气泡"));
        return item?.getAttribute("aria-checked") ?? null;
      `);
      return state === "true" ? state : null;
    });
    await wait(250);
    const optionsShot = await screenshot(optionsScreenshot);

    await setContext("chrome");
    const consoleMessages = await execute(`
      return Services.console.getMessageArray().map((item) => ({
        message: String(item.message ?? item.errorMessage ?? item),
        sourceName: String(item.sourceName ?? item.sourceURL ?? ""),
        category: String(item.category ?? ""),
        flags: Number(item.flags ?? 0)
      }));
    `);
    await setContext("content");
    const relatedMessages = consoleMessages.filter((item) => {
      const haystack = `${item.message} ${item.sourceName} ${item.category}`;
      return (
        haystack.includes(addonId) ||
        haystack.includes(extensionUuid) ||
        haystack.includes("MXGA") ||
        haystack.includes("xss:")
      );
    });
    const firefoxInternalMessages = relatedMessages.filter(
      (item) =>
        item.message.includes("sendRemoveListener on closed conduit") &&
        item.message.includes("resource://gre/modules/ConduitsChild.sys.mjs"),
    );
    const relatedErrors = relatedMessages.filter(
      (item) =>
        !firefoxInternalMessages.includes(item) &&
        /\b(error|uncaught|exception|unhandled rejection|failed to load)\b/i.test(
          `${item.message} ${item.category}`,
        ),
    );
    if (relatedErrors.length) {
      throw new Error(`Extension console errors detected: ${JSON.stringify(relatedErrors)}`);
    }

    Object.assign(report, {
      popup: {
        backgroundHealth: health.response,
        renderedText: popupText,
        screenshot: popupShot,
      },
      options: {
        openedFromPopup: true,
        initialUrl: optionsUrl,
        overviewRendered: overviewText.includes("概览"),
        settingsRendered: settingsText.includes("自动处理策略"),
        screenshot: optionsShot,
      },
      storage: {
        key: "xss:settings",
        initialBubbleSwitch: initialSwitch,
        initialStoredValue: initialStorage.value,
        disabledStoredValue: disabledStorage.value,
        disabledAfterReload,
        restoredStoredValue: restoredStorage.value,
        restoredSwitch,
      },
      console: {
        relatedMessages,
        firefoxInternalMessages,
        relatedErrors,
      },
      completedAt: new Date().toISOString(),
      passed: true,
    });
    passed = true;
    console.log(
      JSON.stringify(
        {
          passed,
          browserVersion: report.runtime.browserVersion,
          addonId,
          popupScreenshot,
          optionsScreenshot,
          relatedErrors: relatedErrors.length,
          firefoxInternalMessages: firefoxInternalMessages.length,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    Object.assign(report, {
      completedAt: new Date().toISOString(),
      passed: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    throw error;
  } finally {
    if (sessionId && addonId) {
      try {
        await sessionCommand("/moz/addon/uninstall", "POST", { id: addonId });
      } catch {
        // Deleting the isolated session still removes a temporary add-on.
      }
    }
    if (sessionId) {
      try {
        await command(`/session/${sessionId}`, "DELETE");
      } catch {
        // The Firefox process may already have exited; the driver is killed below.
      }
    }
    driver.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => driver.once("exit", resolve)),
      wait(2_000),
    ]);
    if (driver.exitCode === null) driver.kill("SIGKILL");
    await fs.writeFile(driverLogPath, logChunks.join(""));
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (!passed) process.exitCode = 1;
  }
}

await main();
