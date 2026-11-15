// Plot-style commands added by origin gap audit 4, kept beside (not inside)
// commands/plotCommands.ts, which sits at its module ceiling.

import type { Action } from "../store/commands";
import { openFigureDialog } from "../store/figureDialogs";

/** Origin's colour-list / colormap increment (gap audit 4 G1): the dialog is in
 *  the lazy FigureDialogs host. */
export const colorGradientCommand: Action = {
  id: "color-gradient",
  group: "Plot",
  section: "Layout",
  label: "Colour gradient…",
  run: () => openFigureDialog({ kind: "colorGradient" }),
};
