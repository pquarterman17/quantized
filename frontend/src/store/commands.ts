// Ported from fermiviewer frontend/src/store/commands.ts (shared platform
// code — keep in sync, modulo the MAIN_PLAN #9 multi-source extension noted
// below). Command registry for the ⌘K palette: the MenuBar publishes its
// flattened entries here each render; the palette reads them non-reactively
// on open and merges with App's curated actions.

import { create } from "zustand";

import { withOp } from "./pendingOps";

export interface Action {
  id: string;
  group: string;
  label: string;
  /** One concise sentence explaining the outcome. Shared by searchable Help
   *  and the command palette so those two discovery surfaces cannot drift. */
  description?: string;
  shortcut?: string;
  /** Optional sub-topic header this command sits under WITHIN its menu
   *  (GUI_INTERACTION #17 — e.g. Analyze ▸ "Peaks & baseline"). Purely a menu
   *  presentation concern: the ⌘K palette ignores it, since the palette is
   *  searched, not browsed. Omit it and the command renders flat, exactly as
   *  before. See lib/menuSections.ts. */
  section?: string;
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

/** True when `x` looks like a promise (has a callable `.then`) — the runtime
 *  check `runAction` needs because `Action.run` is typed `() => void` even
 *  though several commands are `async` bodies (TypeScript's void-return
 *  covariance rule lets that satisfy the type; the real value is only
 *  hidden from the STATIC type, never from what actually comes back at
 *  runtime). */
function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    (typeof x === "object" || typeof x === "function") &&
    x !== null &&
    typeof (x as { then?: unknown }).then === "function"
  );
}

/** THE chokepoint (P3.4 slice 2, 2026-07-26 audit gap #2): every surface that
 *  invokes an `Action` — the ⌘K palette, the menu bar (dropdown items AND
 *  the Help menu) — calls this instead of `action.run()` directly.
 *
 *  A sync command runs exactly as before: zero observable change. An async
 *  command (`run()` returns a thenable — every File-menu export is one)
 *  gets registered in the shared pendingOps store for its duration via
 *  `withOp`, which is what lets StatusBar show its label instead of nothing
 *  happening until the eventual completion/failure toast. This function
 *  never changes what a command DOES — it only observes the promise the
 *  command already returns.
 *
 *  A rejection is swallowed here (after `withOp` unregisters + rethrows):
 *  every current async command already reports its own failure via
 *  status/toast internally and resolves normally, so this only prevents an
 *  otherwise-inert "unhandled rejection" console warning from a wrapper
 *  that didn't exist before — it does not hide anything a user would have
 *  seen, since `a.run()` was already fire-and-forget (uncaught) at every
 *  call site before this chokepoint existed. */
export function runAction(action: Action): void {
  const result = (action.run as () => unknown)();
  if (isThenable(result)) {
    void withOp(action.label, () => Promise.resolve(result)).catch(() => {
      /* see doc comment above — the command's own status/toast already ran */
    });
  }
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
