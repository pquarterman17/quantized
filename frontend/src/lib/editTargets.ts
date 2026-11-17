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

let sheet: SheetBlockOps | null = null;

/** The worksheet pane publishes its block operations (every render, so
 *  `hasBlock` is current). */
export function registerSheetBlockOps(ops: SheetBlockOps): void {
  sheet = ops;
}

/** Cleanup: drop `ops` only if it is still the published one (a second pane
 *  that registered since keeps its own). */
export function unregisterSheetBlockOps(ops: SheetBlockOps): void {
  if (sheet === ops) sheet = null;
}

/** The mounted worksheet's block operations, only when a cell block is selected. */
export function sheetBlockOps(): SheetBlockOps | null {
  return sheet?.hasBlock ? sheet : null;
}
