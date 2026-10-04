// Ported from fermiviewer frontend/src/store/commands.ts (shared platform
// code — keep in sync, modulo the MAIN_PLAN #9 multi-source extension noted
// below). Command registry for the ⌘K palette: the MenuBar publishes its
// flattened entries here each render; the palette reads them non-reactively
// on open and merges with App's curated actions.

import { create } from "zustand";

import { withOp } from "./pendingOps";
import { toast } from "./toasts";

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
  /** Optional menu state. Functions are evaluated when the menu renders so
   * long-lived command registries never publish stale UI state. */
  checked?: boolean | (() => boolean);
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
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
  return [...curated, ...menu].filter((action) => {
    const k = key(action);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
 *  A rejection (after `withOp` unregisters + rethrows) becomes a danger
 *  toast naming the command. A command that reports its own failure via
 *  status/toast resolves normally, so this never double-reports; it is the
 *  safety net for a rejection nothing else reported — a lazy command
 *  body's chunk failing to load was silent here before 2026-10-01. */
export function runAction(action: Action): void {
  const result = (action.run as () => unknown)();
  if (isThenable(result)) {
    // Silent-failure audit (2026-10-01): a command that reports its own
    // failure resolves, so a rejection reaching here was reported by nobody
    // (e.g. Pack Project's or Send to Origin's lazy chunk failing to load).
    void withOp(action.label, () => Promise.resolve(result)).catch((e: unknown) => {
      toast(`${action.label.replace(/…$/, "")} failed: ${e instanceof Error ? e.message : "error"}`, "danger");
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
