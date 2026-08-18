// Standalone store for Recent Projects (P1.1 C4).
//
// Recent FILES (imports) live as a slice INSIDE store/useApp.ts
// (createRecentsSlice in ./recents.ts) so the MenuBar's File ▸ Recent rows
// can read them with the ordinary `useApp((s) => s.recent)` selector. Recent
// Projects would ideally mirror that exactly — but store/useApp.ts is
// PINNED for this lane (a pre-bank extraction is in flight on it), so this
// is its own tiny Zustand store instead of a new useApp slice. Nothing else
// in the app needs Recent Projects to live inside useApp's single store —
// the extra store instance costs nothing beyond that one indirection — and
// commands/recentProjectsCommands.ts is the reason this needs to be
// reactive at all (a plain module-level array wouldn't re-publish palette
// commands when the list changes).
//
// Shape mirrors store/recents.ts's slice API (push/remove/clear over the
// lib/recentProjects.ts pure functions) so a future P1.2+ fold-in, once
// useApp.ts's extraction lands, is a near-mechanical move rather than a
// redesign.

import { create } from "zustand";

import {
  addRecentProjectEntry,
  clearRecentProjectsMeta,
  loadRecentProjects,
  removeRecentProjectEntry,
  saveRecentProjects,
  type RecentProject,
} from "../lib/recentProjects";

export interface RecentProjectsState {
  /** Recent-projects history, newest first; persisted via lib/recentProjects. */
  recentProjects: RecentProject[];
  /** Record a successful NATIVE open or save. Browser-mode saves (no path)
   *  must never call this — see lib/recentProjects.ts's module doc; callers
   *  (workspaceIO.ts, fileCommands.ts) only reach this branch when the
   *  bridge itself returned a real path. */
  pushRecentProject: (name: string, path: string) => void;
  /** Drop ONE entry. Distinct from `clearRecentProjects`: a single stale
   *  entry should be removable without wiping the list. */
  removeRecentProject: (path: string) => void;
  clearRecentProjects: () => void;
}

export const useRecentProjects = create<RecentProjectsState>((set) => ({
  recentProjects: loadRecentProjects(),

  pushRecentProject: (name, path) =>
    set((s) => {
      const next = addRecentProjectEntry(s.recentProjects, {
        name,
        path,
        at: new Date().toISOString(),
      });
      saveRecentProjects(next);
      return { recentProjects: next };
    }),

  removeRecentProject: (path) =>
    set((s) => {
      const next = removeRecentProjectEntry(s.recentProjects, path);
      saveRecentProjects(next);
      return { recentProjects: next };
    }),

  clearRecentProjects: () => {
    clearRecentProjectsMeta();
    set({ recentProjects: [] });
  },
}));
