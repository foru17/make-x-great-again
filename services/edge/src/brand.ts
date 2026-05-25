// Single source of truth for the project's public identity. Used by the
// Worker SSR pages so the GitHub repo, public domain, and various deep
// links can be moved in one place when the project changes home.
//
// Keep in sync with `extension/lib/brand.ts`.

export const BRAND = {
  /** Full product name shown in title bars / hero / about. */
  name: "Make X Great Again",
  /** Short acronym for compact surfaces (badges, popup header, doc cross-refs). */
  acronym: "MXGA",
  /** Single-line positioning. */
  tagline: "让 X 重新能用 · 一个被动的 X 旁路扩展",
  /** Public GitHub repo URL (no trailing slash). */
  repo: "https://github.com/foru17/make-x-great-again",
  /** Latest GitHub Release page (auto-redirects to newest assets). */
  release: "https://github.com/foru17/make-x-great-again/releases/latest",
  /** Public Worker entry point (custom domain). */
  edgeBase: "https://x.zuoluo.tv",
  /** Governance doc inside the repo. */
  governance: "https://github.com/foru17/make-x-great-again/blob/main/docs/GOVERNANCE.md",
  /** Privacy doc inside the repo. */
  privacy: "https://github.com/foru17/make-x-great-again/blob/main/docs/PRIVACY.md",
  /** Appeal / removal request entry. */
  appealNewIssue: "https://github.com/foru17/make-x-great-again/issues/new",
  /** Generic issue tracker URL. */
  issues: "https://github.com/foru17/make-x-great-again/issues",
  /** Owner display name. */
  owner: "foru17",
  /** License id. */
  license: "AGPL-3.0",
} as const;
