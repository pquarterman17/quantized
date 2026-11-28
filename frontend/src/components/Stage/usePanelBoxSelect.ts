// The Select rows box on a multi-panel layout (plan item 22). A box drawn inside one panel selects that panel's own
// points: a facet level's rows on a grid, a segment's rows on an x-break row. The rows are the sheet's, written through
// the row-state model (`setRowSelection`) as the single plot's box is, so the worksheet, Keep only and Exclude follow.
//
// A drag that crosses panels is CLIPPED to the panel it started in (uPlot clamps the box to its own plot area), not
// refused: the part over a neighbour is simply not selected. Layouts whose points cannot be named exactly refuse, with
// the reason: the per-channel stack and a page of panels from other sheets (their payloads are server-reduced), and a
// grid split by a group or an encoding or one that greys excluded rows (its panels no longer hold one row per point).

import { useCallback, useEffect, useRef } from "react";

import { breakPanelsOf, facetPanelsOf, type Composition } from "../../lib/composition";
import type { PanelBoxPick } from "../../lib/panelBoxRows";
import type { RowRange } from "../../lib/rowRange";
import { onLoadFailure, runLazy } from "../../lib/runLazy";
import type { Dataset } from "../../lib/types";
import { toast } from "../../store/toasts";
import type { PanelBoxHandler, PanelKind } from "./panelBoxSelect";

const REFUSED: Partial<Record<PanelKind, string>> = {
  stack: "a per-channel stack's panels show server-reduced points that cannot be traced to their rows. Select in the worksheet, or on the single plot",
  spatial: "a page of panels draws each panel from its own sheet, and its points cannot be traced to this sheet's rows. Select in the worksheet",
};
const SPLIT = "a facet grid split by a group or an encoding draws one series per level, not one per column";

export interface PanelBoxState {
  composition: Composition | null;
  /** The sheet the panels were cut from (the windowed one) and the whole sheet. */
  view: Dataset | null | undefined;
  sheet: Dataset | null | undefined;
  rowRange: RowRange | undefined;
  xKey: number | null;
  hiddenChannels: readonly number[];
  /** The grid is split by a group or an encoding (`useFacetEncoding`, or a group key). */
  split: boolean;
}

/** The handler the render legs call with a finished box. Its identity never changes (the legs' build effect must not
 *  rebuild every panel on each render); it reads the latest state through a ref. */
export function usePanelBoxSelect(state: PanelBoxState): PanelBoxHandler {
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  return useCallback((kind: PanelKind, index: number, pick: PanelBoxPick) => {
    const s = latest.current;
    const refuse = (why: string) => toast(`couldn't select those points: ${why}`, "danger");
    const known = REFUSED[kind];
    if (known) return refuse(known);
    if (kind === "facet" && s.split) return refuse(SPLIT);
    const panel = (kind === "facet" ? facetPanelsOf(s.composition) : breakPanelsOf(s.composition))?.[index];
    if (!panel || !s.view || !s.sheet) return refuse("that panel is not on the sheet any more");
    const [view, offset] = [s.view, s.view === s.sheet ? 0 : (s.rowRange?.from ?? 0)];
    const label = "label" in panel ? `“${panel.label}”` : `segment ${index + 1}`;
    void runLazy("Selecting points…", () => import("../../lib/panelBoxApply")).then(
      (m) => m.applyPanelBox(panel, { view, xKey: s.xKey, offset, hidden: kind === "break" ? s.hiddenChannels : [], label }, pick),
      onLoadFailure,
    );
  }, []);
}
