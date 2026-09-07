# Review regressions

Run from the repository root after `npm --prefix extension run build`.
Use an extension-capable Chromium binary (Chrome for Testing) and an installed
`playwright-core` module. The module can live outside the repository:

```sh
export CHROME=/absolute/path/to/chrome
export PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs
node scripts/ui-acceptance/review/backup-ui.mjs
node scripts/ui-acceptance/review/whitelist-actions.mjs
node scripts/ui-acceptance/review/detection-lifecycle.mjs
```

Each run uses an isolated temporary browser profile. Fixtures and intercepted X
POST requests exercise the real extension build without acting on a real X
account. Classification responses use an in-memory mock. Polls have fixed bounds;
the tests do not call a paid model provider. Output defaults to
`.ui-acceptance/2026-09-07-review` and can be changed with `OUT`.

- `backup-ui`: empty-section replacement, grouped hidden-record selection,
  malformed identities, storage failure reporting, secondary-copy contrast and
  screenshots at 390/1440 pixels in both themes.
- `whitelist-actions`: a saved block action must not execute against an account
  already in the local whitelist, and an old local hide must be restored.
- `detection-lifecycle`: a delayed classification cannot reinsert an account
  into findings after it is added to the whitelist.
