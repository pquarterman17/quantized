// The lazy-only capability probe of lib/desktopBridge.ts (bundle diet, plans/
// BUNDLE_HEADROOM.md slice 34): `desktopCapabilities` / `probe` and the
// "nothing available" value they fall back to. No production module calls
// them today (the tests do), so the code moved
// here verbatim and lib/desktopBridge.ts re-exports it with `export *` -
// importers and test mocks are unchanged, and Rollup bundles this file with
// the lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { api, bool, str, type DesktopCapabilities, type DesktopShellKind } from "./desktopBridge";

export const NO_DESKTOP: DesktopCapabilities = {
  available: false,
  shell: null,
  canPickFiles: false,
  canPickDirectory: false,
  cwd: null,
  home: null,
};

const shellKind = (v: unknown): DesktopShellKind | null =>
  v === "pywebview" || v === "tauri" || v === "browser" ? v : null;

/** Ask the shell what it can actually do. Never throws — a bridge that errors
 *  is reported as unavailable, because a broken bridge and no bridge should
 *  lead the caller to the same fallback. */
export async function desktopCapabilities(): Promise<DesktopCapabilities> {
  const bridge = api();
  if (!bridge?.probe) return NO_DESKTOP;
  try {
    const p = await bridge.probe();
    return {
      available: true,
      shell: shellKind(p.shell),
      canPickFiles: bool(p.canPickFiles),
      canPickDirectory: bool(p.canPickDirectory),
      cwd: str(p.cwd),
      home: str(p.home),
    };
  } catch {
    return NO_DESKTOP;
  }
}

/** P1.1 C1: the contract-named alias of `desktopCapabilities`. Identical
 *  behavior, kept as a thin wrapper (not a rename) so existing callers of
 *  `desktopCapabilities` are untouched. */
export const probe = desktopCapabilities;
