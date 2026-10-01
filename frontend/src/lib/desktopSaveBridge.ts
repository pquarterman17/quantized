// Project save + Recent Projects re-read wire calls - the lazy-only half of
// lib/desktopBridge.ts (bundle diet slice 15). Only lazy modules call these
// (store/workspaceIO.ts's Save/Save As, commands/recentProjectReopen.ts), while
// the eager app needs only the shell check, the import picker, the project
// open dialog and `pathState`, so the code moved here verbatim. Same rules as
// the parent module: `null` = no usable bridge, `CANCELLED` = the user backed
// out. desktopBridge.ts re-exports everything here with `export *`, so
// importers and test mocks of "lib/desktopBridge" are unchanged, and Rollup
// bundles this file with the lazy chunks that use its names.
// architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import { api, bool, CANCELLED, str, type Cancelled, type OpenProjectResult, type SaveProjectResult } from "./desktopBridge";

/** I2 (P0-3/P1-1): `saveProjectTo`'s distinct outcome when a supplied lock
 *  token was refused by `desktop_bridge.py`'s `write_project_file` (the
 *  save-TOCTOU fix — see that method's doc). Distinct from `null` ("no
 *  bridge, or a generic write failure") because the caller's response must
 *  differ: a lock loss means "someone else may hold this now — drop to
 *  read-only, do not retry, do not fall back to a browser download that
 *  would silently create a SECOND copy of the user's edits". */
export const LOCK_LOST = "qz/desktop-bridge/lock-lost" as const;
export type LockLost = typeof LOCK_LOST;

/** Re-read a project path already covered by an earlier open/save grant this
 *  session (quantized/desktop_bridge.py's `read_project_file`) — no dialog.
 *  For reopening a Recent Projects entry. `null` covers both "no bridge" and
 *  "the grant lapsed / the read failed"; there is no dialog here to cancel,
 *  so unlike `openProject` there is no `CANCELLED` outcome. Callers that want
 *  the offline-vs-missing distinction before attempting this should check
 *  `pathState` first, same as `reopenRecent.ts` does for datasets. */
export async function readProject(path: string): Promise<OpenProjectResult | null> {
  const bridge = api();
  if (!bridge?.read_project_file) return null;
  try {
    const out = await bridge.read_project_file(path);
    const resolved = str(out.path);
    const content = str(out.content);
    if (resolved === null || content === null) return null;
    return { path: resolved, content };
  } catch {
    return null;
  }
}

/** Native "Save As" dialog ONLY — no write. Split out of `saveProjectAs`
 *  below (P2, adversarial review) for a caller that must insert a check
 *  BETWEEN the destination pick and the actual write — "a fresh native
 *  dialog is a deliberate destination pick" is not automatically a SAFE
 *  one (store/workspaceIO.ts's `runSaveWorkspaceToFile` uses this to refuse
 *  overwriting a path another LIVE instance holds the project lock for,
 *  before ever calling `saveProjectTo`). Same null/`CANCELLED` semantics as
 *  every other dialog method here: `null` = no usable bridge, `CANCELLED` =
 *  the user backed out. Requires BOTH `save_file_dialog` AND
 *  `write_project_file` to exist — the latter is what the caller will use
 *  next — so a caller is never handed a destination it then has no bridge
 *  method to write to. */
/** The save dialog REFUSED the pick (or failed) and said why — distinct from
 *  the user cancelling. P1.2 box 4 made this reachable on purpose:
 *  `save_file_dialog` now returns `{path: null, error}` when the chosen
 *  destination is the open project's own declared raw source, and mapping
 *  that onto `CANCELLED` (as this function did for every `path: null`) made
 *  the refusal SILENT — the user picked their raw file, nothing happened, no
 *  message. The caller shows `refused` as the save's status. */
export interface SaveRefused {
  readonly refused: string;
}

/** Narrow a save-path outcome to the refusal object (the only object shape
 *  besides `{path}` these calls return). */
export function isSaveRefused(v: unknown): v is SaveRefused {
  return typeof v === "object" && v !== null && "refused" in v;
}

/** Every refusal the backend can voice on a save path starts with one of
 *  these (desktop_bridge.py / desktop_bridge_dialogs.py); anything else in
 *  an `error` is a FAILURE (dialog crash, no window) and is reported as one. */
const REFUSAL_PREFIXES = ["refusing to save — ", "refusing to write — "] as const;

/** Turn a backend `error` string into the status a caller shows: a refusal
 *  becomes "save refused — <reason>" (the prefix is not doubled), a failure
 *  "save failed — <error>" (self-review on #291). */
export function saveErrorStatus(error: string): string {
  for (const prefix of REFUSAL_PREFIXES) {
    if (error.startsWith(prefix)) return `save refused — ${error.slice(prefix.length)}`;
  }
  return `save failed — ${error}`;
}

function isRefusal(error: string): boolean {
  return REFUSAL_PREFIXES.some((prefix) => error.startsWith(prefix));
}

// `string` already subsumes the `Cancelled` literal (a `qz/desktop-bridge/
// cancelled`-valued string) at the type level — the return type keeps just
// `string` (callers still narrow with `=== CANCELLED`); the eliminated
// literal added no-redundant-type-constituents noise without adding a
// distinguishable case for tsc. `SaveRefused` IS a distinguishable case (an
// object), so it stays.
//
// `directory` (P1.1) seeds where the dialog opens — the caller's current
// working path, the same hint `openFiles`/`openProject` already forward.
export async function pickSaveDestination(
  suggestedName: string,
  directory?: string,
): Promise<string | SaveRefused | null> {
  const bridge = api();
  if (!bridge?.save_file_dialog || !bridge.write_project_file) return null;
  try {
    const dialogOut = await bridge.save_file_dialog(suggestedName, directory ?? "");
    const path = str(dialogOut.path);
    if (path !== null) return path;
    const error = str(dialogOut.error);
    return error === null ? CANCELLED : { refused: error };
  } catch {
    return null;
  }
}

/** Native "Save As" dialog, then an in-process write of `contents` to the
 *  chosen path — `pickSaveDestination` followed by `saveProjectTo`, so the
 *  two refusal shapes those voice (the dialog refusing the pick, the write
 *  refusing the path) reach this caller too, never collapsed into a cancel
 *  (self-review on #291: this combo used to map every `path: null` onto
 *  `CANCELLED`, the exact defect `pickSaveDestination` had already fixed).
 *  `null` = no usable bridge OR the write itself failed after a real pick
 *  (fall back to the browser download — the content is not lost, just not
 *  landed at a native path); `CANCELLED` = the user backed out of the save
 *  dialog — do nothing, never fall back to a download the user did not ask
 *  for; `SaveRefused` = say why, and do not fall back either. A caller that
 *  needs a lock check BETWEEN the pick and the write (store/workspaceIO.ts's
 *  Save As) uses the two halves directly. */
export async function saveProjectAs(
  suggestedName: string,
  contents: string,
  directory?: string,
): Promise<SaveProjectResult | Cancelled | SaveRefused | null> {
  const destination = await pickSaveDestination(suggestedName, directory);
  if (destination === null || destination === CANCELLED || isSaveRefused(destination)) return destination;
  const written = await saveProjectTo(destination, contents);
  return written === LOCK_LOST ? null : written; // no token was supplied, so LOCK_LOST cannot occur
}

/** Write `contents` directly to an already-known project `path` — no dialog.
 *  `null` covers both "no bridge" and "the write failed / the path was
 *  never consented" — there is no dialog here to cancel, so no `CANCELLED`
 *  outcome. `lockToken`, when supplied, is forwarded to
 *  `write_project_file`'s I2 lock-token binding (P0-3/P1-1): the backend
 *  verifies it under the SAME exclusive-OS-lock CAS every other lock
 *  mutation uses, immediately before the write, and this resolves
 *  `LOCK_LOST` (never `null`) when it was refused — see that constant's
 *  doc for why the two must stay distinguishable to the caller. Omitting
 *  `lockToken` (or passing `""`) skips the check entirely, byte-identical
 *  to this function's pre-I2 behavior. A `SaveRefused` is the backend
 *  declining the destination itself (a declared raw source) — distinct from
 *  both `null` and `LOCK_LOST`, since the caller must say why and must not
 *  fall back to a download. */
export async function saveProjectTo(
  path: string,
  contents: string,
  lockToken?: string,
): Promise<SaveProjectResult | LockLost | SaveRefused | null> {
  const bridge = api();
  if (!bridge?.write_project_file) return null;
  try {
    const out = await bridge.write_project_file(path, contents, lockToken ?? "");
    const error = str(out.error);
    if (error === "lock lost") return LOCK_LOST;
    // P1.2 box 4, self-review on #291: the WRITE can refuse too — the
    // destination is one of the payload's own declared sources (a spelling
    // the frontend pre-check and the dialog's cached set never matched).
    // A refusal must reach the caller as one, never as a generic `null`
    // that Save As would turn into a browser download with an OK toast.
    if (error !== null && isRefusal(error)) return { refused: error };
    if (!bool(out.ok)) return null;
    return { path: str(out.path) ?? path };
  } catch {
    return null;
  }
}
