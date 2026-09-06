// User-facing settings (chrome.storage.local, single object). Read at
// content-script start + live-updated via storage.onChanged. No PII.
import type { SpamCategory } from "./category";

/** How a confirmed spam account is handled when the user takes action:
 *  - "local": hide its posts only in this extension (display:none). Zero
 *    network — X never knows. Reversible from the options page. (default)
 *  - "mute":  X-native one-way mute. ta still exists for you, you just stop
 *    seeing them; ta is not notified; follow relationship is kept.
 *  - "block": X-native block. Mutual — breaks the follow relationship and
 *    hides you from each other. Strongest. */
export type ActionMode = "local" | "mute" | "block";

/** What happens automatically when an account on the public blacklist shows
 *  up in the timeline, per spam category:
 *  - "badge": only mark it (current shipped behavior) — user acts manually
 *  - "hide":  auto-hide locally (reversible from 处理记录)
 *  - "mute":  auto-hide + X-native mute (needs x.com permission)
 *  - "block": auto-hide + X-native block (needs x.com permission) */
export type CategoryAction = "badge" | "hide" | "mute" | "block";

export type CategoryActions = Record<SpamCategory, CategoryAction>;

/** WHERE the per-category auto actions are allowed to fire. Detection and
 *  badges always run everywhere; this only scopes the automatic
 *  hide/mute/block:
 *  - "replies": ONLY accounts replying under a tweet (the status-page 评论区,
 *    where the spam wave actually lives). Feed posts by the account itself
 *    and profile pages are detect-and-badge only. (default — least 误伤)
 *  - "all": feed, profile and replies all auto-process. */
export type AutoScope = "replies" | "all";

/** How PUBLIC-LIST hits that are auto-published (AI/rule/mention lane, not
 *  human-confirmed) may auto-act. Human-confirmed entries always follow the
 *  per-category policy in full; this only governs the auto tier:
 *  - "full":  run the per-category action incl. mute/block (default — the
 *             product line is "on the public list = auto-processable";
 *             precision is enforced at the publish source, where the AI
 *             lane is confined to the high-precision porn_bot class)
 *  - "hide":  cap at the reversible local hide; X mute/block stays
 *             human-confirmed-only
 *  - "badge": mark only — the most conservative stance */
export type AutoTierMode = "badge" | "hide" | "full";

export interface Settings {
  enabled: boolean; // master: passive detection on/off
  bubble: boolean; // show the corner bubble
  bubblePos: "tr" | "br"; // top-right / bottom-right
  actionMode: ActionMode; // what "隐藏" does to a flagged account
  categoryActions: CategoryActions; // per-category automatic action on list hits
  autoProcess: boolean; // master kill-switch for categoryActions auto hide/mute/block
  autoScope: AutoScope; // where auto actions may fire (replies-only by default)
  autoTierMode: AutoTierMode; // how far auto-published (non-human) list hits may auto-act
  autoExpand: boolean; // pop the bubble card open when auto-processing starts (off = pill pulse only; better on narrow/mobile viewports)
  edgeBase: string; // advanced: override the service base URL — list/whitelist sync source, whitelist-apply backend AND outbound links
  officialRulesEnabled: boolean; // master switch for the synced maintainer-curated keyword rules (per-rule disables live in xss:rules:disabled)
  ruleTelemetry: boolean; // anonymously report OFFICIAL rule hits (spam account identity + matched rule only, never the user's own info) so the maintainer can review & publish them
  followingWhitelist: boolean; // auto-add accounts the viewer follows to the LOCAL whitelist (never badged / auto-processed); entries live in xss:whitelist:local
}

export const DEFAULT_CATEGORY_ACTIONS: CategoryActions = {
  // All "badge" by default — identical to the shipped behavior (hits are
  // marked, nothing happens without the user). Users escalate per category.
  porn: "badge",
  crypto: "badge",
  gambling: "badge",
  resource: "badge",
  marketing: "badge",
  other: "badge",
};

export const DEFAULTS: Settings = {
  enabled: true,
  bubble: true,
  bubblePos: "tr",
  actionMode: "local",
  categoryActions: { ...DEFAULT_CATEGORY_ACTIONS },
  autoProcess: true,
  autoScope: "replies",
  autoTierMode: "full",
  autoExpand: true,
  edgeBase: "",
  officialRulesEnabled: true,
  ruleTelemetry: true,
  followingWhitelist: true,
};

const KEY = "xss:settings";
/** Storage key for the settings object — exported for modules (local-rules)
 *  that need to react to settings changes via storage.onChanged. */
export const SETTINGS_KEY = KEY;

/** Shallow merge + nested categoryActions merge (a stored partial object
 *  from an older version must not wipe the new keys). */
function withDefaults(partial: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULTS,
    ...(partial ?? {}),
    categoryActions: {
      ...DEFAULT_CATEGORY_ACTIONS,
      ...(partial?.categoryActions ?? {}),
    },
  };
}

export async function getSettings(): Promise<Settings> {
  try {
    const g = await chrome.storage.local.get(KEY);
    return withDefaults(g[KEY] as Partial<Settings>);
  } catch {
    return withDefaults(undefined);
  }
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

/** Update the action for one spam category. */
export async function setCategoryAction(
  cat: keyof CategoryActions,
  action: CategoryAction,
): Promise<void> {
  const s = await getSettings();
  await setSetting("categoryActions", { ...s.categoryActions, [cat]: action });
}

/** Fires whenever settings change (any tab/page). Returns an unsubscribe. */
export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const h = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === "local" && changes[KEY]) {
      cb(withDefaults(changes[KEY].newValue as Partial<Settings>));
    }
  };
  chrome.storage.onChanged.addListener(h);
  return () => chrome.storage.onChanged.removeListener(h);
}
