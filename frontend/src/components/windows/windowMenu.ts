// GUI_INTERACTION #8 residual: the window title-bar's FIXED actions
// (duplicate/pin/link-cycle/bg-cycle/close) as context-action registry
// entries, so the title-bar right-click menu (`WindowTitleButtons`) and any
// future consumer share ONE definition per action instead of a third
// hand-rolled item list (the palette already has its own via
// `useWindowCommands.ts` — see the label-parity note below for why that one
// stays separate rather than being replaced by this registry).
//
// LABEL PARITY (pinned by windowMenu.test.ts): these labels deliberately
// match `useWindowCommands.ts`'s palette Action labels verbatim
// ("Duplicate Window", "Pin Window (toggle)",
// "Link Window Group (1 / 2 / 3 / Off)",
// "Window Background (Theme / Light / Dark)", "Close Window") so a user
// doesn't have to learn two names for "pin this window" depending on
// whether they right-clicked the title bar or opened ⌘K. But note the
// semantic difference: these entries target THIS window (`t.win.id`) via a
// right-click on ITS OWN title bar; `useWindowCommands`'s palette actions
// always target the FOCUSED window (`s.focusedWindowId`) — two different
// targets, intentionally identical wording.

import { nextPlotBg, type PlotWindow } from "../../lib/plotview";
import type { ContextAction } from "../../lib/contextActions";
import { useApp } from "../../store/useApp";

export interface WindowActionTarget {
  win: PlotWindow;
}

export const windowCoreActions: ContextAction<WindowActionTarget>[] = [
  {
    id: "window.duplicate",
    label: "Duplicate Window",
    run: (t) => {
      const s = useApp.getState();
      const id = s.duplicateWindow(t.win.id);
      if (id) s.focusWindow(id);
    },
  },
  // Link + pin only make sense on a kind:"plot" window — same guard
  // `WindowTitleButtons`'s ⧟/⚲ buttons already use (a snapshot is never
  // dataset-bound; a worksheet/map document window has no XY axes to sync).
  {
    id: "window.pin",
    label: "Pin Window (toggle)",
    hidden: (t) => t.win.kind !== "plot",
    checked: (t) => t.win.pinned,
    run: (t) => useApp.getState().toggleWindowPin(t.win.id),
  },
  {
    id: "window.linkCycle",
    label: "Link Window Group (1 / 2 / 3 / Off)",
    hidden: (t) => t.win.kind !== "plot",
    run: (t) => useApp.getState().cycleWindowLinkGroup(t.win.id),
  },
  // Bg applies to the plot PAGE draw colours — plot + snapshot only, the
  // same gate the physical ◐ button uses (a worksheet/map document window
  // draws its own surfaces, so offering the cycle would be a dead action).
  {
    id: "window.bgCycle",
    label: "Window Background (Theme / Light / Dark)",
    hidden: (t) => t.win.kind !== "plot" && t.win.kind !== "snapshot",
    run: (t) => {
      const s = useApp.getState();
      s.setWindowBg(t.win.id, nextPlotBg(t.win.bg));
    },
  },
];

/** Plain (no confirm/danger) — matches the existing ✕ button's directness. */
export const windowCloseAction: ContextAction<WindowActionTarget> = {
  id: "window.close",
  label: "Close Window",
  run: (t) => useApp.getState().closeWindow(t.win.id),
};

/** Every window action, flat — for callers that don't care about layout. */
export const windowActions: ContextAction<WindowActionTarget>[] = [...windowCoreActions, windowCloseAction];
