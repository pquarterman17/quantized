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
  /** One concise sentence explaining the outcome. Shared by searchable Help
   *  and the command palette so those two discovery surfaces cannot drift. */
  description?: string;
  shortcut?: string;
  /** Menu-only live label (e.g. Edit > Delete names what it will delete now). The
   *  static `label` stays the palette name and the fallback. */
  labelFn?: () => string;
  /** Optional sub-topic header this command sits under WITHIN its menu
   *  (GUI_INTERACTION #17 — e.g. Analyze ▸ "Peaks & baseline"). Purely a menu
   *  presentation concern: the ⌘K palette ignores it, since the palette is
   *  searched, not browsed. Omit it and the command renders flat, exactly as
   *  before. See lib/menuSections.ts. */
  section?: string;
  /** Optional menu state. Functions are evaluated when the menu renders so
   * long-lived command registries never publish stale UI state. */
  checked?: boolean | (() => boolean);
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
  /** A search-only entry (a deep link into a dialog's operation, e.g.
   *  "Normalize · peak = 1"): reachable from ⌘K and Help, deliberately left
   *  out of the menus, which already list its parent command. */
  paletteOnly?: boolean;
  /** Destructive commands receive the shared danger treatment in menus. */
  danger?: boolean;
  /** True for a PER-ENTITY command — one published per recent project, per
   *  dataset, and so on. It names a piece of the user's DATA, not a capability
   *  of the app. The ⌘K palette wants these; searchable HELP does not: Help
   *  documents what the application can do, and a topic row per recent project
   *  carrying its absolute path as the "explanation" is both noise and a
   *  needless path disclosure. Set it on any publisher that mints one command
   *  per object; `helpContent.test.ts`'s prose guard now covers the merged Help
   *  index, so forgetting it fails the build rather than shipping quietly. */
  perEntity?: boolean;
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

/** Merge curated palette actions with published menu commands. Curated wins
 *  on duplicate labels within the same menu group; an identically named
 *  command in another group remains reachable instead of disappearing. */
export function mergeCommands(curated: Action[], menu: Action[]): Action[] {
  const key = (a: Action) => `${a.group.toLowerCase()}\0${a.label.toLowerCase()}`;
  const seen = new Set<string>();
  // The palette and Help search `mergeSearchable` (commands/hookCommandDocs.ts), which adds the hook
  // commands' help copy and the relabelled commands' old names; this stays the eager dedupe.
  return [...curated, ...menu].filter((action) => {
    const k = key(action);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The ONE canonical label + shortcut for "open the command palette".
 *
 *  GUI_INTERACTION #17 requires palette labels to match menu labels exactly.
 *  This action is reachable from four surfaces (the Edit-menu registry entry,
 *  the ⌘K palette's own list, the Help menu, and the menubar search chip's
 *  tooltip) and before this constant existed three of them hard-coded three
 *  DIFFERENT strings — "Command palette…", "Command palette", "Search…".
 *  Import these rather than retyping the text. */
export const PALETTE_LABEL = "Command palette…";
export const PALETTE_SHORTCUT = "⌘K";

// The command runner lives in ./commandsRun.ts (bundle diet slice 32).
export * from "./commandsRun";
