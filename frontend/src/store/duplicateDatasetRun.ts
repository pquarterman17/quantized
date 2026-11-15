// The body of `duplicateDataset` (store/datasetListEdits.ts), moved verbatim
// behind a dynamic `import()` (bundle diet slice 28, plans/BUNDLE_HEADROOM.md):
// it runs only from the Duplicate row/context/palette gesture, which is
// already async (it awaits `resolveDataset` first), so the clone builder and
// the per-dataset view reset it spells out stay out of the startup chunk.

import { cloneDataStruct } from "../lib/dataset";
import { nextStageTab } from "../lib/stagetab";
import type { Dataset } from "../lib/types";
import { refreshFitRefsLater } from "./computedColumns";
import { nextDatasetId } from "./idSeq";
import { QFIT_RESULT_RESET } from "./qfitResultReset";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function duplicateDatasetRun(id: string, set: SliceSet, get: SliceGet): void {
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
      ...QFIT_RESULT_RESET,
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
