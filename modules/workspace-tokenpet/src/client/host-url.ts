/**
 * Resolve a host route against the page's real origin.
 *
 * The web carrier loads the shell over http, where a root-relative path (the
 * form the built-in plugin routes use) resolves normally. A file:// carrier
 * reports `location.origin` as the *string* "null", and a root-relative fetch
 * there resolves to nothing — the desktop shell's synthetic host is the
 * documented way out (`@deepseek-ai/dsh-client-file-upload` uses the same
 * fallback). One helper keeps both carriers working.
 *
 * @param path - an absolute host path such as "/workspace-tokenpet/skins".
 */
export function hostUrl(path: string): string {
  const origin = typeof window === 'undefined' ? undefined : window.location?.origin
  const base = origin === undefined || origin === '' || origin === 'null' ? 'http://dsh.internal' : origin
  try {
    return new URL(path, base).toString()
  } catch {
    return path
  }
}
