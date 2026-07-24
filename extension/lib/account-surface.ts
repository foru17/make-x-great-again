function profileHeaderSurface(node: Element | null): HTMLElement | null {
  const userName = node?.closest<HTMLElement>('[data-testid="UserName"]');
  if (!userName) return null;

  const primaryColumn = userName.closest('[data-testid="primaryColumn"]');
  for (let el = userName.parentElement; el && el !== primaryColumn; el = el.parentElement) {
    if (el.querySelector('a[href$="/header_photo"]')) return el;
  }
  return null;
}

const HIDDEN_KEY_ATTR = "data-xss-hidden-key";
const PREVIOUS_DISPLAY_ATTR = "data-xss-previous-display";

export function hideAccountSurface(node: Element | null, key?: string): boolean {
  const surface =
    node?.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ??
    node?.closest<HTMLElement>("article") ??
    profileHeaderSurface(node);
  if (!surface) return false;
  if (key && !surface.hasAttribute(HIDDEN_KEY_ATTR)) {
    surface.setAttribute(HIDDEN_KEY_ATTR, key);
    surface.setAttribute(PREVIOUS_DISPLAY_ATTR, surface.style.display);
  }
  surface.style.display = "none";
  return true;
}

/** Restore surfaces whose local block key was removed in another extension
 * context (most commonly the options page's “恢复显示” action). */
export function restoreAccountSurfaces(
  activeBlockedKeys: ReadonlySet<string>,
  root: ParentNode = document,
): number {
  let restored = 0;
  for (const surface of root.querySelectorAll<HTMLElement>(`[${HIDDEN_KEY_ATTR}]`)) {
    const key = surface.getAttribute(HIDDEN_KEY_ATTR);
    if (!key || activeBlockedKeys.has(key)) continue;
    surface.style.display = surface.getAttribute(PREVIOUS_DISPLAY_ATTR) ?? "";
    surface.removeAttribute(HIDDEN_KEY_ATTR);
    surface.removeAttribute(PREVIOUS_DISPLAY_ATTR);
    restored++;
  }
  return restored;
}
