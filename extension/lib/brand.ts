// Single source of truth for the project's public identity, mirrored from
// `services/edge/src/brand.ts`. Used by every extension entry-point + the
// content-script so links can be moved in one place when the project
// changes home.

export const BRAND = {
  /** Full product name shown in title bars / hero / about. */
  name: "Make X Great Again",
  /** Short acronym for compact surfaces (popup header, content-script badges). */
  acronym: "MXGA",
  /** Single-line positioning. Mirrored from services/edge/src/brand.ts. */
  tagline: "AI 帮你拦 X 上的垃圾",
  /** Public GitHub repo URL (no trailing slash). */
  repo: "https://github.com/foru17/make-x-great-again",
  /** Latest GitHub Release page (auto-redirects to newest .zip). */
  release: "https://github.com/foru17/make-x-great-again/releases/latest",
  /** Chrome Web Store listing — the primary install path for normal users. */
  chromeWebStore:
    "https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea",
  /** Public Worker base URL (custom domain). Extension can override in settings. */
  edgeBase: "https://x.zuoluo.tv",
  /** Governance doc inside the repo. */
  governance:
    "https://github.com/foru17/make-x-great-again/blob/main/docs/GOVERNANCE.md",
  /** Privacy doc inside the repo. */
  privacy:
    "https://github.com/foru17/make-x-great-again/blob/main/docs/PRIVACY.md",
  /** Appeal / removal request entry (used by content-script bubble). */
  appealNewIssue:
    "https://github.com/foru17/make-x-great-again/issues/new?template=appeal.yml",
  /** Generic issue tracker URL. */
  issues: "https://github.com/foru17/make-x-great-again/issues",
  /** Owner display name. */
  owner: "foru17",
  /** License id. */
  license: "AGPL-3.0",
} as const;
