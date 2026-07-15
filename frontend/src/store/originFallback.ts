// Origin graph recovery fallbacks (#50): exact source worksheet focus and
// Graph Builder seeding. Composed into useApp to keep the root store bounded.

import { resolveOriginFigureSources, resolveOriginSourceManually } from "../lib/originSources";
import { ORIGIN_OVERLAY_VERSION } from "../lib/originOverlay";
import type { PlotSpec } from "../lib/plotspec";
import type { AppState } from "./useApp";
import { toast } from "./toasts";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface OriginWorksheetSeed {
  datasetId: string;
  columns: number[];
}

export interface OriginFallbackSlice {
  originWorksheetSeed: OriginWorksheetSeed | null;
  clearOriginWorksheetSeed: () => void;
  openOriginFigureSource: (
    figureId: string,
    datasetId?: string,
    opts?: { manual?: boolean },
  ) => Promise<void>;
  remakeOriginFigure: (figureId: string) => Promise<void>;
}

export function createOriginFallbackSlice(set: SliceSet, get: SliceGet): OriginFallbackSlice {
  return {
    originWorksheetSeed: null,
    clearOriginWorksheetSeed: () => set({ originWorksheetSeed: null }),
    openOriginFigureSource: async (figureId, requestedId, opts) => {
      const entry = get().originFigures.find((item) => item.id === figureId);
      if (!entry) return;
      const resolution = resolveOriginFigureSources(entry, get().originFigures, get().datasets);
      const manuallySelected = requestedId
        ? get().datasets.find((ds) => ds.id === requestedId)
        : undefined;
      let source = opts?.manual && manuallySelected
        ? resolveOriginSourceManually(entry, get().originFigures, manuallySelected) ?? undefined
        : requestedId
        ? resolution.sources.find((item) => item.datasetId === requestedId)
        : resolution.sources[0];
      if (!source && manuallySelected && entry.siblingIds.includes(manuallySelected.id)) {
        source = resolveOriginSourceManually(entry, get().originFigures, manuallySelected) ?? undefined;
      }
      if (!source) {
        toast(`No decoded source columns; Origin hint: ${entry.figure.source_hint || "unknown"}`, "info");
        return;
      }
      try {
        await get().resolveDatasets([source.datasetId]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "source book fetch failed";
        toast(`Couldn't open Origin source workbook — ${message}`, "danger");
        return;
      }
      set({
        worksheetId: source.datasetId,
        stageTab: "worksheet",
        originWorksheetSeed: { datasetId: source.datasetId, columns: source.columns },
        status: `opened ${source.book}; selected ${source.columns.length} bound column${source.columns.length === 1 ? "" : "s"}`,
      });
    },
    remakeOriginFigure: async (figureId) => {
      const entry = get().originFigures.find((item) => item.id === figureId);
      if (!entry) return;
      const resolution = resolveOriginFigureSources(entry, get().originFigures, get().datasets);
      // PlotSpec v1 edits one layer at a time. Resolve the whole graph family
      // above for lazy preflight/diagnostics, but seed the clicked layer's
      // curves; applyOriginFigure keeps the recovered multi-panel state live.
      const layerResolution = resolveOriginFigureSources(entry, [entry], get().datasets);
      if (layerResolution.sources.length === 0) {
        toast(`No decoded curve bindings; use the raw Origin hint ${entry.figure.source_hint || "unknown"}`, "info");
        return;
      }
      try {
        await get().resolveDatasets(resolution.sources.map((source) => source.datasetId));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "source book fetch failed";
        toast(`Couldn't seed Graph Builder — ${message}`, "danger");
        return;
      }

      // Apply the decoded figure first. This restores the recovered axes,
      // titles, styles, legend, annotations, regions, and layer state behind
      // the builder; the seed below supplies its editable channel wells.
      // Every lazy source is already resolved, so this is synchronous.
      get().applyOriginFigure(figureId);

      let datasetId: string;
      let yColumns: number[];
      let xColumn: number | null;
      // applyOriginFigure materializes a provenance-stamped overlay whenever
      // one editable plot needs more than one X block: cross-book curves OR a
      // single Origin worksheet laid out X,Y,X,Y,... . Prefer that overlay
      // regardless of source-book count. Falling through to sources[0] for a
      // one-book multi-X figure would collapse every Y back onto xColumns[0]
      // and recreate the hysteresis corruption fixed by PR #38.
      const overlayDataset = get().datasets.find(
        (ds) => (ds.data.metadata ?? {}).origin_overlay_source === entry.id
          && (ds.data.metadata ?? {}).origin_overlay_version === ORIGIN_OVERLAY_VERSION,
      );
      if (overlayDataset) {
        datasetId = overlayDataset.id;
        yColumns = overlayDataset.data.labels.map((_, index) => index);
        xColumn = null;
      } else if (layerResolution.sources.length === 1) {
        const source = layerResolution.sources[0];
        datasetId = source.datasetId;
        yColumns = source.yColumns;
        const sourceX = source.xColumns[0] ?? -1;
        // Graph Builder's empty X well means the dataset's pinned time/X
        // column; value-channel X columns use an explicit non-negative ref.
        xColumn = sourceX < 0 ? null : sourceX;
      } else {
        toast("Origin remake could not resolve every decoded curve", "info");
        return;
      }
      const spec: PlotSpec = {
        version: 1,
        zones: {
          x: xColumn === null ? null : { datasetId, channel: xColumn },
          y: yColumns.map((channel) => ({ datasetId, channel })),
          group: null,
          facet: null,
        },
        mark: entry.figure.curves?.some(
          (curve) => curve.style === "line" || curve.style === "line_symbol",
        ) ? "line" : "scatter",
      };
      get().openGraphBuilderSeeded(spec);
      set({ status: `opened ${entry.figure.name || "Origin graph"} layer ${entry.figure.layer ?? 1} in Graph Builder${resolution.unresolved.length ? `; ${resolution.unresolved.length} binding${resolution.unresolved.length === 1 ? "" : "s"} unresolved` : ""}` });
    },
  };
}
