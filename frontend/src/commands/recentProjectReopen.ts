// The Recent Projects REOPEN body, moved verbatim out of
// commands/recentProjectsCommands.ts (bundle headroom slice 14,
// plans/BUNDLE_HEADROOM.md). That module is eager (Stage mounts its palette
// hook, HomeScreen calls its reopen) and now reaches this one only through
// `runLazy`; the crash-recovery chooser (lib/applyRecoveryChoice.ts, already
// lazy) imports it directly. See recentProjectsCommands.ts's header for the
// missing-vs-offline rationale this implements.

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { CANCELLED, openProject, pathState, readProject, type OpenProjectResult } from "../lib/desktopBridge";
import { baseName, parentDirectory } from "../lib/importEntry";
import { rejectIfImportRunning } from "../lib/importRunningGuard";
import {
  hasWorkspaceContent,
  replaceConfirmMessage,
  replaceWorkspace,
} from "../lib/openWorkspaceReplace";
import { currentViewport } from "../lib/parseWorkspaceFile";
import { workspaceCodec } from "../lib/workspaceCodecLazy";
import { useRecentProjects } from "../store/recentProjects";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";

/** What a reopen did: `applied` (the workspace was loaded), `cancelled`
 *  (the user backed out of a dialog or the replace confirm — nothing was
 *  said, because they just closed something), or `failed` (a reason was
 *  already toasted: offline, permission denied, unreadable, no bridge). */
export type ReopenProjectOutcome = "applied" | "cancelled" | "failed";

/** The native Open dialog seeded at the entry's own folder — the one
 *  recovery every non-offline failure below degrades to. A cancel is
 *  deliberately silent (the user just closed a dialog); no bridge / an
 *  unreadable pick is said out loud. */
async function pickProjectNear(
  name: string,
  path: string,
): Promise<OpenProjectResult | "cancelled" | "failed"> {
  const picked = await openProject(parentDirectory(path) || undefined);
  if (picked === CANCELLED) return "cancelled";
  if (picked === null) {
    toast(`${name}: could not be reopened`, "danger");
    return "failed";
  }
  return picked;
}

/** Reopen a Recent Projects entry — missing-vs-offline aware (see module
 *  doc). Exported (P1.2) so the crash-recovery chooser (useWorkspaceAutosave)
 *  can reuse the EXACT same reopen path for its "keep the last project"
 *  choice instead of a second implementation.
 *
 *  P1.1 (project reopen completion) — the four non-ok states get four
 *  different remedies, never one generic failure:
 *  - `offline`: say so and STOP. Retry is clicking again once the share is
 *    back; nothing is cleaned up or relocated.
 *  - `permission_denied`: present but unreadable — STOP too; the remedy is
 *    access, not a different path.
 *  - `missing` / `invalid`: offer LOCATE (the native dialog, seeded at the
 *    old folder). A located file replaces the stale entry — but only once
 *    the workspace is actually applied (DEFECT A's rule), never on the pick.
 *  - a read that fails on an `ok` path: consent is per-process
 *    (desktop_consent), so this is the NORMAL first reopen after a
 *    relaunch. Degrade to the same dialog, seeded at the file's own folder
 *    — `read_project_file`'s documented contract — rather than a dead end. */
export async function openRecentProject(name: string, path: string): Promise<ReopenProjectOutcome> {
  if (rejectIfImportRunning()) return "cancelled";
  const state = await pathState(path);
  if (state === "offline") {
    toast(`${name}: the drive or share is not available right now — reconnect and try again`, "danger");
    return "failed";
  }
  if (state === "permission_denied") {
    toast(`${name}: exists but cannot be read (permission denied)`, "danger");
    return "failed";
  }
  // Only a Locate… pick is a RELOCATION that supersedes the stale entry;
  // a different file picked in the lapsed-consent dialog leaves the (fine,
  // present) original alone.
  const relocating = state === "missing" || state === "invalid";
  let result: OpenProjectResult | "cancelled" | "failed";
  if (relocating) {
    const why =
      state === "missing"
        ? "The drive is reachable but the file is not there — it may have been moved, renamed, or deleted."
        : "Its saved path is not usable on this machine.";
    const locate = await askConfirm(
      `${name}: not found at its saved location`,
      `${path}\n\n${why} Locate it to update the Recent Projects entry.`,
      "Locate…",
    );
    if (!locate) return "cancelled";
    result = await pickProjectNear(name, path);
  } else {
    // "ok", or "unknown" (no bridge to ask — but this whole command only
    // exists because a bridge granted this path earlier, so a bridge that
    // vanished mid-session is the only way to land here with "unknown").
    const read = await readProject(path);
    if (read !== null) {
      result = read;
    } else {
      useApp.getState().setStatus(`${name}: confirm the file to reopen it — file access is re-granted each launch`);
      result = await pickProjectNear(name, path);
    }
  }
  if (typeof result === "string") return result;
  const opened = result;
  let ws;
  try {
    // P1.7 PR 3: a Recent Projects reopen is a native read of a real file at
    // a real path, same as `lib/openWorkspaceCommand.ts`'s native branch —
    // `opened.path` (NOT the stale `path` argument, which a relocated/
    // renamed reopen may have superseded) is this workspace's own directory.
    // Lazy codec chunk (lib/workspaceCodecLazy.ts): a load failure is toasted like a parse failure.
    const { parseWorkspace } = await workspaceCodec();
    ws = parseWorkspace(opened.content, currentViewport(), {
      projectDir: parentDirectory(opened.path) || undefined,
    });
  } catch (e) {
    toast(`${name}: ${e instanceof Error ? e.message : "invalid workspace file"}`, "danger");
    return "failed";
  }
  const s = useApp.getState;
  const identity = opened.path === path ? { name, path } : { name: baseName(opened.path), path: opened.path };
  const apply = (): boolean => {
    // A relocated project supersedes its stale entry; `replaceWorkspace`
    // pushes the new one and records its folder as the working path.
    const replaced = replaceWorkspace(s, ws, identity);
    if (replaced && relocating && opened.path !== path) useRecentProjects.getState().removeRecentProject(path);
    return replaced;
  };
  if (!hasWorkspaceContent(s)) {
    return apply() ? "applied" : "cancelled";
  }
  const ok = await askConfirm(
    "Replace the current workspace?",
    replaceConfirmMessage(s().datasets.length),
    "Replace",
    true,
  );
  if (!ok) return "cancelled";
  return apply() ? "applied" : "cancelled";
}

