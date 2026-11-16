// The app's z-index layers, in ONE place. Painting order, bottom to top:
//
//   tool windows        200 .. 899    (ToolWindow; focus order, renumbered
//                                      before it can reach the next band)
//   file-drop overlay   900           (window-wide drop target: above every
//                                      tool window, below any modal)
//   modal backdrops     1000 .. 1499  (lib/modalInert.ts stamps open order)
//   modal popovers      1500          (SymbolPalette: belongs to a dialog)
//   toasts / badges     1600
//   tooltips            2000
//   context menus       2100
//
// A modal is the only interactive surface while it is open (the rest of the
// page goes `inert`), so it must paint above every non-modal window; and what
// a modal may open or what must stay readable over it (popover, toast,
// tooltip, menu) sits above it. The same numbers are CSS custom properties in
// `styles/platform.css` (`--z-*`); layers.test.ts keeps the two in step.

export const Z = {
  toolBase: 200,
  /** Highest z a tool window can reach. */
  toolMax: 899,
  /** The window-wide file-drop highlight (styles/fileDrop.css). */
  fileDrop: 900,
  modalBase: 1000,
  modalPopover: 1500,
  toast: 1600,
  tooltip: 2000,
  menu: 2100,
} as const;

/** How many focus ranks a tool window may take before the set is renumbered. */
export const TOOL_Z_SPAN = Z.toolMax - Z.toolBase;
