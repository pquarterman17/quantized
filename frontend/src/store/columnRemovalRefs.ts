// Everything OUTSIDE a dataset that names one of its columns by index, remapped
// after `removedCol` disappears from dataset `id`: its bound plot windows, its
// saved editable figures, its live legacy FigureDocs, saved Graph Builder specs,
// and the live view when it is the active dataset. (`graphBuilderSeed` is
// consumed on the open it is set with, so no removal can land in between.)
// Extracted from `removeFormula` (store/computedColumns.ts) so the derived-sheet
// recalc (store/recalcDatasets.ts) — whose columns shift when its SOURCE loses
// one — applies the SAME remap instead of leaving every reference stale. The
// dataset's OWN fields (`remapDatasetChannels`, formulas) stay with each caller.

import {
  remapFigureBindings,
  remapFigureViewChannels,
  remapViewChannels,
  remapWindowViews,
} from "../lib/channelRemap";
import { remapLegacyFigureConfig, remapPlotSpecRefs } from "../lib/channelRemapDocs";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";
import { syncDatasetWindowDocuments } from "./windowDocuments";

export function columnRemovalRefsPatch(
  s: AppState,
  id: string,
  removedCol: number,
  datasets: readonly Dataset[],
): Partial<AppState> {
  return {
    plotWindows: syncDatasetWindowDocuments(
      remapWindowViews(s.plotWindows, id, removedCol),
      id,
      datasets.find((d) => d.id === id)?.errorRoles,
    ),
    // Finding 2 (independent review, round 2): a SAVED editable figure is
    // neither the live view nor a bound plotWindows entry -- it needs its own
    // remap of the same channel-indexed bindings. Task 3
    // (SILENT_STATE_CORRUPTION_PLAN): its `plot.view` carries its own copy of
    // seriesOrder/hiddenChannels/seriesStyles/seriesLabels -- remap those too.
    editableFigures: s.editableFigures.map((doc) =>
      doc.bindings.datasetId === id
        ? {
            ...doc,
            bindings: remapFigureBindings(doc.bindings, removedCol),
            plot: { ...doc.plot, view: remapFigureViewChannels(doc.plot.view, removedCol) },
          }
        : doc,
    ),
    // A LIVE legacy doc re-renders from current data; a frozen one carries its own snapshot.
    figureDocs: s.figureDocs.map((f) =>
      f.live && f.datasetId === id ? { ...f, config: remapLegacyFigureConfig(f.config, removedCol) } : f,
    ),
    savedPlotSpecs: s.savedPlotSpecs.map((p) => ({ ...p, spec: remapPlotSpecRefs(p.spec, id, removedCol) })),
    ...(s.activeId === id
      ? {
          ...remapViewChannels(s, removedCol),
          // Finding 3 (independent review, round 2): `composition` is an
          // EPHEMERAL render cache that `useEffectiveComposition` prefers over
          // the durable `facetKey` binding -- left alone, its pre-removal facet
          // panels keep rendering. Nulling it is NOT "drop the facet": that
          // hook is `rawComposition ?? facetCompositionFromBinding(active,
          // facetKey, xKey, yKeys)`, so the grid re-derives from the corrected
          // `facetKey` on the next render (and when `facetKey` WAS the removed
          // column, `remapViewChannels` already nulled it, ending the facet).
          composition: null,
        }
      : {}),
  };
}
