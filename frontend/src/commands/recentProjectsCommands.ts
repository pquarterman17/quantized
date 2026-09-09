// Recent Projects palette commands (P1.1 C4) — published into the shared
// command registry (store/commands.ts's `useCommands`) rather than appended
// to appCommands.ts's curated list. Same "wire through the registry, never
// inline in the pinned list" reason components/windows/useWindowCommands and
// components/history/useHistoryCommands document: this list is per-project
// and must re-publish whenever it changes, which appCommands.ts's
// build-once list (its own header comment: "App builds the list once —
// store setters are stable") cannot do.
//
// Recent FILES (imports) surface today as rows inside the MenuBar's File
// dropdown (components/Shell/MenuBar.tsx), driven by useApp's `recent`
// slice (store/recents.ts). That slice lives INSIDE store/useApp.ts, which
// is PINNED for this lane (a pre-bank extraction is in flight on it — see
// store/recentProjects.ts's header for the fuller rationale). Mirroring the
// MenuBar row-by-row would mean adding a matching slice there, which the pin
// forbids, so this takes the contract's own documented fallback instead:
// "if recent files have no menu surface yet, expose recent projects as
// palette commands only — match existing patterns, invent nothing." The
// existing pattern reused for "invent nothing" is the dynamic-registry one
// (useHistoryCommands' reactive re-publish-on-change), not a literal
// MenuBar row — the nearest existing mechanism that does not touch the pin.
//
// Reopening an entry mirrors lib/reopenRecent.ts's missing-vs-offline
// handling for datasets: check `pathState` first (desktop_bridge.py's
// `path_status`, reused here exactly as P1.1 C2 names) and only attempt the
// read when the volume is actually reachable — never guess "missing" for an
// unmounted share, same rule, same reason.

import { useEffect } from "react";

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { CANCELLED, openProject, pathState, readProject, type OpenProjectResult } from "../lib/desktopBridge";
import { baseName, parentDirectory } from "../lib/importEntry";
import { hasWorkspaceContent, replaceConfirmMessage, replaceWorkspace } from "../lib/openWorkspaceReplace";
import { currentViewport } from "../lib/parseWorkspaceFile";
import { parseWorkspace } from "../lib/workspace";
import { useCommands, type Action } from "../store/commands";
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
    ws = parseWorkspace(opened.content, currentViewport(), {
      projectDir: parentDirectory(opened.path) || undefined,
    });
  } catch (e) {
    toast(`${name}: ${e instanceof Error ? e.message : "invalid workspace file"}`, "danger");
    return "failed";
  }
  const s = useApp.getState;
  const identity = opened.path === path ? { name, path } : { name: baseName(opened.path), path: opened.path };
  const apply = () => {
    // A relocated project supersedes its stale entry; `replaceWorkspace`
    // pushes the new one and records its folder as the working path.
    if (relocating && opened.path !== path) useRecentProjects.getState().removeRecentProject(path);
    replaceWorkspace(s, ws, identity);
  };
  if (!hasWorkspaceContent(s)) {
    apply();
    return "applied";
  }
  const ok = await askConfirm(
    "Replace the current workspace?",
    replaceConfirmMessage(s().datasets.length),
    "Replace",
    true,
  );
  if (!ok) return "cancelled";
  apply();
  return "applied";
}

/** Publish one "Open recent project…" command per Recent Projects entry,
 *  re-publishing whenever the list changes (an entry added/removed, not just
 *  on mount) — see the module doc for why the registry (not a static list)
 *  is the right chokepoint here. */
export function useRecentProjectsCommands(): void {
  const recentProjects = useRecentProjects((s) => s.recentProjects);

  useEffect(() => {
    const actions: Action[] = recentProjects.map((entry) => ({
      id: `recent-project-${entry.path}`,
      group: "File",
      section: "Recent Projects",
      label: `Open recent project: ${entry.name}`,
      description: entry.path,
      // One command per recent project: data, not a capability. Keeps these
      // out of searchable Help (which would otherwise list a row per project
      // with its absolute path as the explanation) while leaving them in ⌘K,
      // where finding a specific project by name is the whole point.
      perEntity: true,
      keywords: "recent project workspace reopen dwk",
      run: () => void openRecentProject(entry.name, entry.path),
    }));
    useCommands.getState().setMenuCommands("recentProjects", actions);
  }, [recentProjects]);
}
