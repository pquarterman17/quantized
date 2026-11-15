// Plot-style commands added by origin gap audit 4, kept beside (not inside)
// commands/plotCommands.ts, which sits at its module ceiling.

import type { Action } from "../store/commands";
import { openFigureDialog } from "../store/figureDialogs";

/** Legend formatting (audit 6 M): the keyboard route to the dialog a legend
 *  double-click opens (show, corner, entry labels, Reset position). */
export const legendFormatCommand: Action = {
  id: "legend-format",
  group: "Plot",
  section: "Layout",
  label: "Legend…",
  run: () => openFigureDialog({ kind: "legend" }),
};

/** Origin's colour-list / colormap increment (gap audit 4 G1): the dialog is in
 *  the lazy FigureDialogs host. */
export const colorGradientCommand: Action = {
  id: "color-gradient",
  group: "Plot",
  section: "Layout",
  label: "Colour gradient…",
  run: () => openFigureDialog({ kind: "colorGradient" }),
};
