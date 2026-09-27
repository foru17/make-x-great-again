const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const X_USER_ID_RE = /^\d{1,32}$/;

/** The lite artifact is consumed as a strict contract by browser extensions.
 * Keep legacy/corrupt database rows out instead of publishing one malformed
 * identity that causes clients to reject the entire snapshot. */
export function isArtifactIdentityValid(userId: string | null, handle: string): boolean {
  return (
    X_HANDLE_RE.test(handle) && (userId === null || userId === "" || X_USER_ID_RE.test(userId))
  );
}

export interface ArtifactVersionAccount {
  x_user_id: string | null;
  handle: string;
  verdict_label: string;
  category: string | null;
  published_tier: string | null;
}

/** Content-addressed artifact version: "v<16 hex of sha256>-<count>".
 * Must change whenever anything shipped in the artifacts changes, so a list
 * that returns to an earlier count never reuses an older version. Rows are
 * sorted because published_at ties come back from D1 in no fixed order, and a
 * version that churned every tick would re-upload the artifacts each run. */
export async function artifactVersion(
  accounts: ArtifactVersionAccount[],
  rules: unknown[],
): Promise<string> {
  const rows = accounts
    .map((a) =>
      JSON.stringify([a.x_user_id ?? "", a.handle, a.verdict_label, a.category, a.published_tier]),
    )
    .sort();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${rows.join("\n")}\n${JSON.stringify(rules)}`),
  );
  const prefix = [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `v${prefix}-${accounts.length}`;
}
