// The ONE "is a facet actually showing" answer, shared by every consumer
// that needs it (FIGURE_AUTHORING_WORKFLOW_PLAN F4.4 review round K1).
//
// `composition` (the store singleton) is the immediate render cache
// `facetByColumn` fills in right away; it goes back to null on a focus
// switch, a workspace reopen, or a resolved recipe's freshly-focused window
// -- exactly the moments `facetKey` (the durable, bindings-owned binding —
// `lib/plotview.ts`, mirrors `groupKey`) is what's actually left to render
// from. Before this hook existed, `MultiPanelStage.tsx` read `composition`
// with the durable fallback applied while `PlotStage.tsx`'s OWN mount gate
// (`stackMode && (... || (facetPanels?.length ?? 0) >= 1)`) read the RAW
// ephemeral `composition` directly — so a restored 1-channel facet
// (composition null, facetKey set) satisfied `MultiPanelStage`'s own render
// logic perfectly well, but PlotStage never mounted it in the first place:
// the gate saw `facetPanels: null` and fell through to the plain single-plot
// return. `useLiveSnapshotPublish`'s `altModeShowing` recomputes the
// identical condition from the SAME `spatialPanels`/`facetPanels` PlotStage
// passes it as plain args (see that file's own doc) — it has no store read
// of its own, so fixing the source here (this hook) fixes both consumers at
// once; there is no second call site to patch.
//
// ONE hook, ONE derivation — `MultiPanelStage.tsx` and `PlotStage.tsx` both
// call this instead of reading `s.composition` raw, so the two can never
// disagree on what's showing again.

import { useMemo } from "react";

import type { Composition } from "../../lib/composition";
import { facetCompositionFromBinding } from "../../lib/facet";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

export function useEffectiveComposition(active: Dataset | null): Composition | null {
  const rawComposition = useApp((s) => s.composition);
  const facetKey = useApp((s) => s.facetKey);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  return useMemo(
    () => rawComposition ?? facetCompositionFromBinding(active, facetKey, xKey, yKeys),
    [rawComposition, active, facetKey, xKey, yKeys],
  );
}
