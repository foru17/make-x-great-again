/** Return the current UserName block for a handle.
 *
 * X virtualizes timeline rows. A DOM element captured while scanning can stay
 * connected after X has recycled it for another author, so callers must
 * validate the author immediately before mutating the row.
 */
export function findCurrentAuthorAnchor(
  root: ParentNode,
  handle: string,
  preferred?: HTMLElement | null,
): HTMLElement | null {
  const wanted = handle.toLowerCase();

  const handleIn = (nameBlock: HTMLElement): string | undefined => {
    for (const a of nameBlock.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
      const parts = (a.getAttribute("href") ?? "").split("/").filter(Boolean);
      if (parts.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(parts[0] ?? "")) {
        return parts[0];
      }
    }
    return undefined;
  };

  const nameBlockFor = (node: HTMLElement): HTMLElement | null => {
    const own = node.matches('[data-testid="User-Name"]') ? node : null;
    const block = own ?? node.closest<HTMLElement>('[data-testid="User-Name"]');
    return block && handleIn(block)?.toLowerCase() === wanted ? block : null;
  };

  if (preferred && root.contains(preferred)) {
    const current = nameBlockFor(preferred);
    if (current) return current;
  }

  for (const nameBlock of root.querySelectorAll<HTMLElement>('[data-testid="User-Name"]')) {
    if (handleIn(nameBlock)?.toLowerCase() === wanted) return nameBlock;
  }
  return null;
}
