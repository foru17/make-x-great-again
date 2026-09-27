import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright-core");
export const CHROME = process.env.CHROME;
if (!CHROME) throw new Error("Set CHROME to an extension-capable Chromium executable");
export const OUT = resolve(process.env.OUT ?? ".ui-acceptance/2026-09-07-review");
mkdirSync(OUT, { recursive: true });
