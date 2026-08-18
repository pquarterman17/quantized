// Project identity + dirty-state slice (P1.2 box "show project name/path and
// dirty state"). Composed into store/useApp.ts via the same
// `createXSlice(set)` pattern as recents.ts (see that module's header) —
// useApp.ts itself gains only the import + spread line, per its size ratchet
// (architecture.test.ts's STORE_PINS).
//
// `currentProject` is set ONLY from a genuine NATIVE path — a successful
// openProject/saveProjectAs/saveProjectTo, or a Recent Projects reopen.
// Mirrors lib/recentProjects.ts's "a browser download has no path, so it
// never gets a Recent entry" rule: a browser-mode save has nothing durable
// to name the project after, so it must leave `currentProject` untouched
// rather than inventing an identity for something with no real location.
//
// `projectDirty` is the "has the live workspace changed since the last
// successful save/open" flag Shell/TitleBar renders as a marker. Every
// setter here that represents "the project now matches disk" (setCurrentProject,
// markProjectClean) resets it to false in the SAME set() call — callers must
// never split "update identity" and "clear dirty" into two calls, or a
// caller in between could observe a project with a name but no clean state.
// The flip to `true` is driven from useWorkspaceAutosave.ts's existing
// autosave-relevant field comparison (`shouldAutosave`), so "what counts as
// a change" can never drift between the dirty marker and autosave itself.

import type { AppState } from "./useApp";

/** A project's on-disk identity — always a durable native path, never a
 *  browser download (which has none). */
export interface ProjectIdentity {
  /** Display name — the file's basename, e.g. `workspace.dwk`. */
  name: string;
  /** The native, resolved path this project lives at. */
  path: string;
}

export interface ProjectSlice {
  /** The currently open/saved project, or null when nothing has a durable
   *  location yet (a fresh session, or a browser-only save/download). */
  currentProject: ProjectIdentity | null;
  /** True when the live workspace has changed since the last successful
   *  save/open of `currentProject`. Meaningless (but harmless) when
   *  `currentProject` is null — there is nothing named to compare against. */
  projectDirty: boolean;
  /** Record a successful native open/save. Always clears `projectDirty` in
   *  the same update — the project now IS what's on disk. */
  setCurrentProject: (project: ProjectIdentity | null) => void;
  /** The live workspace changed since the last save/open. */
  markProjectDirty: () => void;
  /** The live workspace now matches what's on disk (a successful Save),
   *  without changing WHICH project that is. */
  markProjectClean: () => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createProjectSlice(set: SliceSet): ProjectSlice {
  return {
    currentProject: null,
    projectDirty: false,

    setCurrentProject: (project) => set({ currentProject: project, projectDirty: false }),
    markProjectDirty: () => set({ projectDirty: true }),
    markProjectClean: () => set({ projectDirty: false }),
  };
}
