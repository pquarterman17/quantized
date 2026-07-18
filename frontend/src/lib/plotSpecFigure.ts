// Bounded Graph Builder -> Figure Builder bridge (GUI_INTERACTION #11).
// Only the ordinary single-dataset XY family is representable by today's
// FigureDoc. Grouped, faceted, and statistical specs fail closed instead of
// being flattened into a misleading publication figure.

import { buildExportStyles, type ExportSeriesStyle } from "./exportStyles";
import type { FigureDoc } from "./figuredoc";
import { specDatasetId, type PlotSpec } from "./plotspec";
import type { SeriesStyle } from "./types";

export function plotSpecFigureReason(spec: PlotSpec): string | null {
  if (spec.mark !== "line" && spec.mark !== "scatter") return "Only line and scatter plots can open in Figure Builder.";
  if (spec.zones.y.length === 0) return "Assign at least one Y channel first.";
  if (spec.zones.group) return "Grouped plots need a grouped Figure Builder contract first.";
  if (spec.zones.facet) return "Faceted plots need a multi-panel Figure Builder contract first.";
  const datasetIds = new Set(
    [spec.zones.x, ...spec.zones.y].filter((ref) => ref !== null).map((ref) => ref.datasetId),
  );
  if (datasetIds.size !== 1) return "Every plotted channel must belong to one dataset.";
  if (specDatasetId(spec) === null) return "Every plotted channel must belong to one dataset.";
  return null;
}

function stylesForMark(
  spec: PlotSpec,
  seriesStyles: Record<number, SeriesStyle>,
): (ExportSeriesStyle | null)[] {
  const base = buildExportStyles(spec.zones.y.map((r) => r.channel), seriesStyles);
  if (spec.mark === "line") return base;
  return base.map((style) => ({ ...(style ?? {}), line: "none", marker: true }));
}

/** Create an ephemeral FigureDoc seed. The caller opens it without adding it
 * to the saved-figure library; the user can explicitly Save from the builder. */
export function plotSpecToFigureDoc(
  spec: PlotSpec,
  name: string,
  seriesStyles: Record<number, SeriesStyle>,
): FigureDoc | null {
  const datasetId = specDatasetId(spec);
  if (plotSpecFigureReason(spec) !== null || datasetId === null) return null;
  return {
    id: `plotspec-${Date.now().toString(36)}`,
    name: name.trim() || "Graph Builder plot",
    datasetId,
    live: true,
    config: {
      xKey: spec.zones.x?.channel ?? null,
      yKeys: spec.zones.y.map((r) => r.channel),
      xScale: "linear",
      yScale: "linear",
      title: "",
      xLabel: "",
      yLabel: "",
      style: "default",
      fmt: "pdf",
      dpi: 300,
      overrides: null,
      seriesStyles: stylesForMark(spec, seriesStyles),
    },
  };
}
