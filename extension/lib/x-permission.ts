interface HostPermissions {
  contains(details: { origins: string[] }): Promise<boolean>;
  request(details: { origins: string[] }): Promise<boolean>;
}

interface XPermissionContext {
  browser: string;
  userAgent: string;
  isSafari: boolean;
  origins: string[];
  permissions: HostPermissions;
}

/** Firefox for Android has no runtime host-permission doorhanger. */
export function isFirefoxAndroid(browser: string, userAgent: string): boolean {
  return browser === "firefox" && /Android/i.test(userAgent);
}

/**
 * Ensure X website access before enabling a native action.
 *
 * Firefox Android can only grant site access from add-on details, so requesting
 * it at runtime always fails. Detect existing access there; retain normal
 * contains-then-request behavior on desktop browsers.
 */
export async function ensureXPermission(context: XPermissionContext): Promise<boolean> {
  if (context.isSafari) return true;

  try {
    if (await context.permissions.contains({ origins: context.origins })) return true;
    if (isFirefoxAndroid(context.browser, context.userAgent)) return false;
    return await context.permissions.request({ origins: context.origins });
  } catch {
    return false;
  }
}
