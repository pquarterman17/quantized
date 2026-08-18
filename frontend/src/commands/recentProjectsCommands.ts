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
import { pathState, readProject } from "../lib/desktopBridge";
import { hasWorkspaceContent, replaceConfirmMessage, replaceWorkspace } from "../lib/openWorkspaceReplace";
import { currentViewport } from "../lib/parseWorkspaceFile";
import { parseWorkspace } from "../lib/workspace";
import { useCommands, type Action } from "../store/commands";
import { useRecentProjects } from "../store/recentProjects";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";

async function openRecentProject(name: string, path: string): Promise<void> {
  const state = await pathState(path);
  if (state === "offline") {
    toast(`${name}: the drive or share is not available right now — reconnect and try again`, "danger");
    return;
  }
  if (state === "missing" || state === "invalid") {
    toast(`${name}: not found at its saved location`, "danger");
    return;
  }
  // "ok", or "unknown" (no bridge to ask — but this whole command only
  // exists because a bridge granted this path earlier, so a bridge that
  // vanished mid-session is the only way to land here with "unknown").
  const result = await readProject(path);
  if (result === null) {
    toast(`${name}: could not be reopened`, "danger");
    return;
  }
  let ws;
  try {
    ws = parseWorkspace(result.content, currentViewport());
  } catch (e) {
    toast(`${name}: ${e instanceof Error ? e.message : "invalid workspace file"}`, "danger");
    return;
  }
  const s = useApp.getState;
  if (!hasWorkspaceContent(s)) {
    replaceWorkspace(s, ws);
    return;
  }
  const ok = await askConfirm(
    "Replace the current workspace?",
    replaceConfirmMessage(s().datasets.length),
    "Replace",
    true,
  );
  if (ok) replaceWorkspace(s, ws);
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
      keywords: "recent project workspace reopen dwk",
      run: () => void openRecentProject(entry.name, entry.path),
    }));
    useCommands.getState().setMenuCommands("recentProjects", actions);
  }, [recentProjects]);
}
