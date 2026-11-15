// The canvas side of a graph's colour gradient (`lib/seriesRamp.ts`): the
// window's channel styles with the ramp resolved onto every uncoloured curve,
// for `usePlotPayload` (the flat plot and its legend) and the x-break panels.
// The export resolves the SAME ramp over the SAME list in
// `figureSpec.buildFigureSpecForView`; both gate on `seriesRampImpl.rampApplies`.
// The resolver rides the lazy marks chunk (`lib/marksLoader.ts`): a graph with
// a ramp starts the load and keeps its palette colours until it lands.

import type { FigureDocument } from "../../lib/figureDocument";
import { loadMarks, marks, useMarksVersion } from "../../lib/marksLoader";
import type { RampView } from "../../lib/seriesRampImpl";
import type { Dataset, SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";

/** `view`'s styles with its ramp applied, or the same reference when it has
 *  none, refuses it, or the resolver is still on its way. */
function rampedOrRaw(view: RampView, ds: Dataset | null | undefined, doc: FigureDocument | undefined): Record<number, SeriesStyle> {
  if (!view.seriesRamp) return view.seriesStyles;
  if (!marks()) void loadMarks();
  return marks()?.rampedStyles(view, ds, doc) ?? view.seriesStyles;
}

/** A window's ramped styles, from its own view. */
export function useRampedStyles(view: RampView, dataset: Dataset | null | undefined, doc: FigureDocument | undefined): Record<number, SeriesStyle> {
  useMarksVersion();
  return rampedOrRaw(view, dataset, doc);
}

/** The FOCUSED window's, from the live store fields. */
export function useFocusedRampedStyles(dataset: Dataset | null | undefined, doc: FigureDocument | undefined): Record<number, SeriesStyle> {
  useMarksVersion();
  return useApp((s) => rampedOrRaw(s, dataset, doc));
}
