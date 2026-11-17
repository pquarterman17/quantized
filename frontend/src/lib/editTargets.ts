// The Edit menu's Cut / Copy / Delete act on "the current focus", but opening a
// menu moves DOM focus onto the menu, so the target cannot be read off
// `document.activeElement`. The worksheet's cell-block operations live in a
// component hook (components/Stage/worksheet/useWorksheetBlockOps.ts), so the
// pane publishes them here while mounted and the commands
// (commands/editClipboardCommands.ts) call the SAME functions its Ctrl+C /
// Ctrl+X / Delete handlers call — no second implementation of cell copy/cut.

/** The slice of the worksheet's `BlockOpsApi` the Edit commands call (declared
 *  here, structurally, so lib/ never imports a component). */
export interface SheetBlockOps {
  copyBlock: () => void;
  cutBlock: () => void;
  clearBlock: () => void;
  hasBlock: boolean;
}

interface Entry {
  root: Element | null;
  get: () => SheetBlockOps;
}

const entries = new Set<Entry>();
/** The pane the user last worked in; null once they moved to anything else. */
let focused: Entry | null = null;

/** Surfaces that RUN commands (menus, palette, dialogs): interacting with them
 *  must not make a stale cell selection look abandoned or acquired. */
const TRANSIENT = '[role="menu"],[role="menubar"],[role="dialog"],[role="listbox"],[role="combobox"]';

function onInteract(ev: Event): void {
  const t = ev.target;
  if (!(t instanceof Element)) return;
  const hit = [...entries].find((e) => e.root?.contains(t));
  if (hit) focused = hit;
  else if (!t.closest(TRANSIENT)) focused = null; // plot, Library, inspector...: the sheet is no longer the target
}

function listen(on: boolean): void {
  for (const type of ["pointerdown", "focusin"]) {
    if (on) document.addEventListener(type, onInteract, true);
    else document.removeEventListener(type, onInteract, true);
  }
}

/** The worksheet pane publishes its block operations while mounted. `get` is
 *  read live (the hook's object changes every render). The ops become the Edit
 *  target only once the user has pointed or focused INTO `root`, and stop being
 *  it as soon as they interact with another surface: a selection left behind in
 *  a hidden or background sheet must never be what Edit > Delete clears.
 *  Returns the unregister function. */
export function publishSheetBlockOps(root: Element | null, get: () => SheetBlockOps): () => void {
  const entry: Entry = { root, get };
  if (entries.size === 0) listen(true);
  entries.add(entry);
  if (root?.contains(document.activeElement)) focused = entry;
  return () => {
    entries.delete(entry);
    if (focused === entry) focused = null;
    if (entries.size === 0) listen(false);
  };
}

/** The focused worksheet's block operations, only when a cell block is selected. */
export function sheetBlockOps(): SheetBlockOps | null {
  const ops = focused?.get();
  return ops?.hasBlock ? ops : null;
}
