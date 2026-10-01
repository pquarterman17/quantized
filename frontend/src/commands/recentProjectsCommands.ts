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

import { runLazy } from "../lib/runLazy";
import { useCommands, type Action } from "../store/commands";
import { useRecentProjects } from "../store/recentProjects";
import type { ReopenProjectOutcome } from "./recentProjectReopen";

export type { ReopenProjectOutcome } from "./recentProjectReopen";

/** Reopen a Recent Projects entry — missing-vs-offline aware (see module
 *  doc). The body lives in commands/recentProjectReopen.ts and loads on the
 *  first reopen (bundle headroom slice 14): this module is eager, and every
 *  caller is a click followed by a bridge round trip. A chunk that will not
 *  load is toasted by `runLazy` and settles `"failed"`, the outcome that
 *  means "a reason was already toasted". */
export function openRecentProject(name: string, path: string): Promise<ReopenProjectOutcome> {
  return runLazy("Loading project reopen…", () => import("./recentProjectReopen")).then(
    (m) => m.openRecentProject(name, path),
    (): ReopenProjectOutcome => "failed",
  );
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
