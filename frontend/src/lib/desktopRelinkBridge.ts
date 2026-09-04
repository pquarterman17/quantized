// Source probing + relink consent wire calls (P1.7, C1) — the relink half of
// lib/desktopBridge.ts, split out when that file crossed the repo's general
// 500-line `.ts` ceiling (architecture.test.ts's RSM_CUTS_PLAN #20 guard) as
// P1.2's save-refusal path landed there. Same rules as the parent module and
// the sibling lib/desktopLockBridge.ts: `null` = no usable bridge (degrade,
// never guess), `CANCELLED` = the user backed out (do nothing), an error
// object = a real failure the caller should SAY. Reuses `api`/`str`/`num`
// from desktopBridge.ts rather than duplicating them; desktopBridge.ts
// re-exports everything here so importers and test mocks of
// "lib/desktopBridge" are unchanged.

import { api, CANCELLED, num, str, type PathState } from "./desktopBridge";
/** A source path's reachability + optional fingerprint
 *  (quantized/desktop_bridge.py's `probe_source` — see that module's doc
 *  for the full missing/offline/changed/permission-denied consent story).
 *  `checksum` is `null` whenever the backend didn't compute one — either
 *  because the path wasn't read-consented this session, or the file was
 *  reachable by stat but not by content read — never a stand-in for "the
 *  checksum is empty". */
export interface SourceProbe {
  state: PathState | "permission_denied";
  path: string | null;
  size: number | null;
  mtime: number | null;
  checksum: string | null;
}

const SOURCE_PROBE_STATES: readonly SourceProbe["state"][] = [
  "ok",
  "missing",
  "offline",
  "invalid",
  "permission_denied",
];

/** Probe one source path. `null` = no usable bridge (relink degrades to
 *  "source checks unavailable" in a browser — never guesses a state). Never
 *  throws — a bridge error is reported the same as no bridge, matching
 *  `pathState`'s convention. */
export async function probeSource(path: string): Promise<SourceProbe | null> {
  const bridge = api();
  if (!bridge?.probe_source) return null;
  try {
    const out = await bridge.probe_source(path);
    const state = str(out.state);
    if (state === null || !(SOURCE_PROBE_STATES as readonly string[]).includes(state)) return null;
    return {
      state: state as SourceProbe["state"],
      path: str(out.path),
      size: num(out.size),
      mtime: num(out.mtime),
      checksum: str(out.checksum),
    };
  } catch {
    return null;
  }
}

/** Extend read consent to paths ALREADY recorded as a project's own
 *  `Dataset.source.path` values (quantized/desktop_bridge.py's
 *  `grant_source_paths` — see its doc for the consent ruling: opening the
 *  project itself already required a real dialog, and this extends that
 *  same trust to the sources IT declares, never to an arbitrary list).
 *  Returns the subset actually granted (files that exist), `[]` when there
 *  is no usable bridge — callers proceed with checksum-less probing rather
 *  than treating this as fatal, matching `openFiles`'s "no bridge = degrade,
 *  don't fail" convention. */
export async function grantSourceReadPaths(paths: string[]): Promise<string[]> {
  const bridge = api();
  if (!bridge?.grant_source_paths) return [];
  try {
    const out = await bridge.grant_source_paths(paths);
    const granted = out.paths;
    return Array.isArray(granted) ? granted.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** A real dialog failure AFTER the bridge was reached — distinct from both
 *  `CANCELLED` (the user backed out; nothing to report) and `null` (no
 *  usable bridge; fall back to typing), because the user DID act and
 *  deserves to hear why nothing happened (the same error-vs-cancel split
 *  `openProject`'s doc above rules on for its own post-pick failures). */
export interface PickDirError {
  error: string;
}

/** C1 (relink consent): native folder dialog for the relink panel's
 *  "Browse..." control (quantized/desktop_bridge_dialogs.py's
 *  `pick_relink_directory`) — UNLIKE `pickNativeDirectory` above, a real
 *  return from THIS dialog mints a read-only, session-scoped grant on the
 *  backend covering the chosen folder and its descendants, which is what
 *  lets `probeSource` compute a checksum for a candidate under it. `null` =
 *  no usable bridge (the caller falls back to a typed path, which can be
 *  Previewed but never gets a grant — see `probeSource`'s doc); `CANCELLED`
 *  = the user backed out of the dialog — do nothing, and specifically do
 *  NOT fall back to treating whatever was already typed as consented; a
 *  `PickDirError` = the dialog or the grant itself failed after a real
 *  attempt (backend `{path: null, error}` response, or the bridge call
 *  throwing) — the caller should SAY so, never silently swallow it as a
 *  cancel or misreport it as a missing bridge. */
// Same redundant-constituent trim as `pickSaveDestination` above: `Cancelled`
// is a `string` literal, so folding it into the plain `string` member here
// changes nothing tsc can observe (callers still narrow with `=== CANCELLED`
// before the `typeof !== "string"` check that isolates `PickDirError`).
export async function pickRelinkDirectory(
  directory?: string,
): Promise<string | PickDirError | null> {
  const bridge = api();
  if (!bridge?.pick_relink_directory) return null;
  try {
    const out = await bridge.pick_relink_directory(directory ?? "");
    const path = str(out.path);
    if (path !== null) return path;
    const error = str((out as { error?: unknown }).error);
    return error === null ? CANCELLED : { error };
  } catch (exc) {
    return { error: String(exc) };
  }
}

/** Revoke every grant `pickRelinkDirectory` minted this session
 *  (quantized/desktop_bridge_dialogs.py's `revoke_relink_dir`) — called when
 *  the relink panel closes (Cancel, the window's own close, or a completed
 *  commit) so the read-only grant never outlives the session that asked for
 *  it. Best-effort and silent: there is nothing a caller can usefully do
 *  with a failure here, and no bridge at all is simply a no-op. */
export async function revokeRelinkDir(): Promise<void> {
  const bridge = api();
  if (!bridge?.revoke_relink_dir) return;
  try {
    await bridge.revoke_relink_dir();
  } catch {
    // best-effort — nothing more a caller can do with a revoke failure
  }
}

