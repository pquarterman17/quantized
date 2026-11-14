// The figures-audit dialogs' OPEN FLAG (#6 axis dialog, #8 plot-type
// gallery) -- a dependency-free store (zustand only, the
// store/recodePanel.ts shape) so AppOverlays.tsx can gate the ONE lazy
// `FigureDialogs` chunk without importing any of it. Every behaviour lives
// in that chunk (components/overlays/figuredialogs/).

import { create } from "zustand";

export type AxisId = "x" | "y" | "y2";

/** `plotDetails` (gap audit 2 #8): one curve's colour, line, symbol and error
 *  bars, by dataset channel index — opened by double-clicking the curve or
 *  from its right-click menu. */
export type FigureDialog =
  | { kind: "axis"; axis: AxisId }
  | { kind: "plotType" }
  | { kind: "plotDetails"; channel: number }
  | null;

export const useFigureDialog = create<{ open: FigureDialog }>(() => ({ open: null }));

export function openFigureDialog(dialog: FigureDialog): void {
  useFigureDialog.setState({ open: dialog });
}
