// Whether the Plot stage is showing a figure of its own instead of the XY plot
// (UX menus audit M1): a G15 view (parallel / hexbin / KDE / Pareto /
// Bland-Altman, lib/plots2Mode.ts) or the polar MAP (lib/polarMapMode.ts).
// Both are server-rendered pictures with their own Export button; the XY
// commands (axes, legend, Insert tools, File > Export PDF/SVG/PNG) would act on
// the hidden XY plot underneath. Two ~20-line external stores, so this stays
// eager-safe: it pulls neither stage's chunk.

import { getPlots2Mode } from "./plots2Mode";
import { getPolarMapMode } from "./polarMapMode";

/** The two reasons a command is withheld while such a view is the stage. */
export const AUX_VIEW_HAS_OWN_EXPORT = "This view has its own Export (the button above the preview).";
export const AUX_VIEW_IS_NOT_XY = "Not available in this view: switch back to the XY plot first (Plot > Display > Plot type…).";

/** Minimal store view: the dataset must be active for the stage to show the view. */
interface AuxView {
  activeId: string | null;
  polarMode: boolean;
}

/** True while a Plots2 or polar-map view is what the Plot stage draws
 *  (PlotStage mounts them only for an active dataset; a polar map only in polar mode). */
export function auxFigureViewShown(st: AuxView): boolean {
  if (!st.activeId) return false;
  return getPlots2Mode() !== null || (st.polarMode && getPolarMapMode());
}
