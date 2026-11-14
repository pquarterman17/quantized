// "Duplicate" (store/datasetListEdits.ts's `duplicateDataset`), moved here
// verbatim behind an import() so the action's body leaves the startup bundle
// (bundle offset for gap audit 2's live graphs, plans/BUNDLE_HEADROOM.md's
// "async store actions whose bodies are still eager"). Deep-copies a dataset
// (incl. raw/corrections/bgRef) as an independent "(copy)" -- for trying
// different corrections/formulas while keeping the original. Lands right after
// the source and becomes active, resetting per-dataset view. A live graph's
// copy is a PLAIN dataset: `linkedCurves` is not copied, so it can be edited.

import { cloneDataStruct } from "../lib/dataset";
import { nextStageTab } from "../lib/stagetab";
import type { Dataset } from "../lib/types";
import { refreshFitRefsLater } from "./computedColumns";
import { nextDatasetId } from "./idSeq";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export async function runDuplicateDataset(set: SliceSet, get: SliceGet, id: string): Promise<void> {
  await get().resolveDataset(id);
  get().recordHistory("duplicate dataset");
  set((s) => {
    const idx = s.datasets.findIndex((d) => d.id === id);
    if (idx < 0) return {};
    const src = s.datasets[idx];
    const clone: Dataset = {
      id: nextDatasetId(),
      name: `${src.name} (copy)`,
      data: cloneDataStruct(src.data),
      ...(src.raw ? { raw: cloneDataStruct(src.raw) } : {}),
      ...(src.corrections ? { corrections: { ...src.corrections } } : {}),
      ...(src.bgRef ? { bgRef: { ...src.bgRef } } : {}),
      ...(src.notes ? { notes: src.notes } : {}),
      ...(src.tags?.length ? { tags: [...src.tags] } : {}),
      ...(src.group ? { group: src.group } : {}),
      ...(src.formulas?.length ? { formulas: src.formulas.map((f) => ({ ...f })) } : {}),
      ...(src.channelRoles ? { channelRoles: { ...src.channelRoles } } : {}),
      ...(src.channelTypes ? { channelTypes: { ...src.channelTypes } } : {}),
      ...(src.columnDesignations ? { columnDesignations: { ...src.columnDesignations } } : {}),
      ...(src.columnProps ? { columnProps: { ...src.columnProps } } : {}),
      ...(src.errorRoles ? { errorRoles: [...src.errorRoles] } : {}), // F5: [] is truthy, carries the O1 marker too
    };
    const datasets = [...s.datasets];
    datasets.splice(idx + 1, 0, clone);
    return {
      datasets,
      activeId: clone.id,
      worksheetId: null, // item 15: the clone becomes the plot AND worksheet target
      selectedIds: [clone.id],
      librarySelection: null, // L0.25 coherence (retrospective-audit fix)
      stageTab: nextStageTab(clone, s.stageTab),
      xKey: null,
      yKeys: null,
      groupKey: null,
      facetKey: null,
      y2Keys: null,
      y2Lim: null,
      y2Scale: null,
      y2Step: null,
      y2AxisLabel: "",
      seriesStyles: {},
      errKeys: {},
      hiddenChannels: [],
      xLim: null,
      yLim: null,
      xStep: null,
      yStep: null,
      composition: null, // #54 — the clone becomes active, not an arrangement
      rsmPeaks: null,
      integral: null,
      fwhmResult: null,
      qfitRoi: null,
      qfitResult: null,
      qfitBusy: false,
      qfitError: null,
      gadgetBusy: false,
      gadgetError: null,
      gadgetIntegrateResult: null,
      gadgetStatsResult: null,
      gadgetDerivResult: null,
      gadgetFftPreview: null,
      gadgetCursors: null,
      gadgetCursorResult: null,
    };
  });
  refreshFitRefsLater(get().activeId ?? "", get); // P2.5: the clone has no saved fit of its own
}
