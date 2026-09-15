// The ONE "what arrangement is actually showing" answer, shared by every
// consumer that needs it (FIGURE_AUTHORING_WORKFLOW_PLAN F4.4 review round K1).
//
// `composition` (the store singleton) is the immediate render cache
// `facetByColumn`/`breakAtGaps` fill in right away; it goes back to null on a
// focus switch, a workspace reopen, or a resolved recipe's freshly-focused
// window -- exactly the moments the DURABLE bindings are what's actually left
// to render from: `facetKey` (bindings-owned -- `lib/plotview.ts`, mirrors
// `groupKey`) and, since BUG-012, the focused figure's own persisted
// `plot.axisBreaks.x` (`lib/figureDocument.ts`, the canonical home the export
// path already reads -- `lib/figureSpec.ts`'s `overrides.x_breaks`).
// Before this hook existed, `MultiPanelStage.tsx` read `composition`
// with the durable fallback applied while `PlotStage.tsx`'s OWN mount gate
// (`stackMode && (... || (facetPanels?.length ?? 0) >= 1)`) read the RAW
// ephemeral `composition` directly — so a restored 1-channel facet
// (composition null, facetKey set) satisfied `MultiPanelStage`'s own render
// logic perfectly well, but PlotStage never mounted it in the first place:
// the gate saw `facetPanels: null` and fell through to the plain single-plot
// return. That mount gate is now `multiPanelShowing` below, called by
// PlotStage AND by `useLiveSnapshotPublish`'s `altModeShowing` (which used to
// restate the identical condition from the same panel arrays PlotStage passed
// it) — ONE predicate, so the canvas and the snapshot publish cannot disagree
// about what is on screen.
//
// ONE hook, ONE derivation — `MultiPanelStage.tsx` and `PlotStage.tsx` both
// call this instead of reading `s.composition` raw, so the two can never
// disagree on what's showing again.

import { useMemo } from "react";

import { breakPanelsOf, facetPanelsOf, spatialPanelsOf, type Composition } from "../../lib/composition";
import { durableComposition } from "../../lib/facet";
import type { Dataset } from "../../lib/types";
import { useApp, type AppState } from "../../store/useApp";

/** The focused plot window's persisted x-break ranges, or null. A derived
 *  selector over the document field itself — reference-stable (the array the
 *  document holds, never a fresh one), so it is safe under Zustand's
 *  stable-snapshot rule, the same shape `PlotStage.tsx` uses for the focused
 *  window's `bg`/`linkGroup`/`document.bindings.errors`. */
const focusedXBreaks = (s: AppState): readonly [number, number][] | null =>
  s.plotWindows.find((w) => w.id === s.focusedWindowId)?.document?.plot.axisBreaks.x ?? null;

export function useEffectiveComposition(active: Dataset | null): Composition | null {
  const rawComposition = useApp((s) => s.composition);
  const facetKey = useApp((s) => s.facetKey);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const xBreaks = useApp(focusedXBreaks);
  return useMemo(
    // `lib/facet.durableComposition` owns the fallback AND its facet-beats-
    // break precedence -- the same function the P4.2 matrix's screen leg
    // projects, so the two cannot answer "what is the canvas showing?"
    // differently.
    () => rawComposition ?? durableComposition(active, facetKey, xBreaks, xKey, yKeys),
    [rawComposition, active, facetKey, xKey, yKeys, xBreaks],
  );
}

/** Whether `MultiPanelStage` is what the Stage is actually rendering.
 *
 *  A break arrangement is its OWN explicit-intent gate, independent of the
 *  `stackMode` toggle (BUG-012): `breakAtGaps` turns `stackMode` on with the
 *  same gesture that installs its composition, but a figure whose break was
 *  authored into `plot.axisBreaks.x` (the Figure Builder's breaks panel, a
 *  plot recipe) has no such toggle to restore — gating it on `stackMode`
 *  would leave the reopened figure rendering an unbroken line, which is the
 *  bug. `breakCompositionFromBreaks` already refuses anything under two
 *  panels, so this never mounts a one-panel "break". */
export function multiPanelShowing(
  composition: Composition | null,
  stackMode: boolean,
  plottedCount: number,
): boolean {
  return (
    breakPanelsOf(composition) !== null ||
    (stackMode &&
      (plottedCount >= 2 ||
        (spatialPanelsOf(composition)?.length ?? 0) >= 2 ||
        (facetPanelsOf(composition)?.length ?? 0) >= 1))
  );
}
