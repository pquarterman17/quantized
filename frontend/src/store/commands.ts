// Ported from fermiviewer frontend/src/store/commands.ts (shared platform
// code — keep in sync, modulo the MAIN_PLAN #9 multi-source extension noted
// below). Command registry for the ⌘K palette: the MenuBar publishes its
// flattened entries here each render; the palette reads them non-reactively
// on open and merges with App's curated actions.

import { create } from "zustand";

export interface Action {
  id: string;
  group: string;
  label: string;
  shortcut?: string;
  /** Extra space-separated search terms for the ⌘K palette (not displayed).
   *  Lets a command stay findable by names/aliases not in its visible label
   *  (e.g. "diraculator", or domain terms dropped to keep the label short). */
  keywords?: string;
  run: () => void;
}

interface CommandsState {
  menuCommands: Action[];
  /** Registers one publisher's Action[] under `source`, then recomputes
   *  `menuCommands` as the union of every source's latest list — so
   *  independent publishers (useWindowCommands' static Window group,
   *  useHistoryCommands' reactive Undo/Redo pair — MAIN_PLAN #9) coexist
   *  instead of clobbering each other's contribution with a full replace. */
  setMenuCommands: (source: string, cmds: Action[]) => void;
}

const _sources = new Map<string, Action[]>();

export const useCommands = create<CommandsState>((set) => ({
  menuCommands: [],
  setMenuCommands: (source, cmds) => {
    _sources.set(source, cmds);
    set({ menuCommands: [..._sources.values()].flat() });
  },
}));

/** Merge curated palette actions with published menu commands (curated wins
 *  on duplicate labels, so each command appears once). */
export function mergeCommands(curated: Action[], menu: Action[]): Action[] {
  const seen = new Set(curated.map((a) => a.label.toLowerCase()));
  const extra = menu.filter((a) => !seen.has(a.label.toLowerCase()));
  return [...curated, ...extra];
}
