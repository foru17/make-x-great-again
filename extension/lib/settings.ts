import {
  DEFAULT_MODERATION_ACTION,
  type ModerationAction,
  normalizeModerationAction,
} from "./moderation-action";

// User-facing settings (chrome.storage.local, single object). Read at
// content-script start + live-updated via storage.onChanged. No PII.
export interface Settings {
  enabled: boolean; // master: passive detection on/off
  bubble: boolean; // show the corner bubble
  bubblePos: "tr" | "br"; // top-right / bottom-right
  replyAuto: boolean; // auto-check every replier in a tweet's reply section
  edgeBase: string; // advanced: override the edge service base URL
  /** Default account action. "mute" means X account mute: hide that user's
   *  posts from the viewer, not audio muting. "block" is available only as
   *  an explicit high-risk choice. */
  moderationAction: ModerationAction;
  /** When true, the corner bubble auto-expands the card view whenever a
   *  newly-discovered spam account appears. When false, only the pill flashes
   *  and the count goes up — the user has to click the pill to act. */
  autoExpandOnFinding: boolean;
  /** When true, any account the system has already concluded is spam is
   *  silently enqueued to the paced account-action queue on EVERY page the
   *  user visits — no badge, no card, no click required. Two sources count as
   *  "system-confirmed":
   *    - step 1 cache hit  → "cache_hit"  (this device LLM-classified it
   *      as spam in a prior session and stored the verdict locally).
   *    - step 2 list hit   → "list_hit"   (the public blacklist has it).
   *  Fresh in-session LLM verdicts (step 3) still require user action so
   *  the user has a chance to vet first-time classifications. Defaults
   *  to OFF — the conservative choice for a Chrome Web Store rollout. */
  autoBlockListHits: boolean;
}

export const DEFAULTS: Settings = {
  enabled: true,
  bubble: true,
  bubblePos: "tr",
  replyAuto: true,
  edgeBase: "",
  moderationAction: DEFAULT_MODERATION_ACTION,
  autoExpandOnFinding: true,
  autoBlockListHits: false,
};

const KEY = "xss:settings";

export async function getSettings(): Promise<Settings> {
  try {
    const g = await chrome.storage.local.get(KEY);
    return normalizeSettings((g[KEY] as Partial<Settings>) ?? {});
  } catch {
    return { ...DEFAULTS };
  }
}

function normalizeSettings(raw: Partial<Settings>): Settings {
  return {
    ...DEFAULTS,
    ...raw,
    moderationAction: normalizeModerationAction(raw.moderationAction),
  };
}

export async function setSetting<K extends keyof Settings>(
  k: K,
  v: Settings[K],
): Promise<void> {
  try {
    const s = await getSettings();
    await chrome.storage.local.set({ [KEY]: { ...s, [k]: v } });
  } catch {
    /* non-fatal */
  }
}

/** Fires whenever settings change (any tab/page). Returns an unsubscribe. */
export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const h = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === "local" && changes[KEY]) {
      cb(normalizeSettings((changes[KEY].newValue as Partial<Settings>) ?? {}));
    }
  };
  chrome.storage.onChanged.addListener(h);
  return () => chrome.storage.onChanged.removeListener(h);
}
