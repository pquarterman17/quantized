/** Pure compatibility boundary: legacy Publication Preview figures become
 * canonical v2 drafts only when explicitly opened, never during workspace load. */
import { createFigureDocument, type FigureDocument } from "./figureDocument";
import type { FigureDoc } from "./figuredoc";
import { defaultPlotView } from "./plotview";

export function figureDocumentFromLegacyFigureDoc(legacy: FigureDoc): FigureDocument {
  const config = legacy.config;
  if (!legacy.live && !legacy.dataSnapshot) {
    throw new Error(`frozen legacy FigureDoc "${legacy.id}" has no data snapshot`);
  }
  return createFigureDocument({
    id: legacy.id,
    name: legacy.name,
    // Frozen legacy figures render their snapshot, never a coincidentally
    // active live dataset. A promoted editable window therefore has no live
    // dataset binding to fall through to.
    datasetId: legacy.live ? legacy.datasetId : null,
    view: {
      ...defaultPlotView(),
      xKey: config.xKey,
      yKeys: config.yKeys,
      xScale: config.xScale,
      yScale: config.yScale,
      plotTitle: config.title,
      xAxisLabel: config.xLabel,
      yAxisLabel: config.yLabel,
    },
    groupKey: config.groupCol ?? null,
    data: legacy.live
      ? { mode: "live" }
      : { mode: "frozen", snapshot: legacy.dataSnapshot },
    output: { format: config.fmt, stylePreset: config.style, dpi: config.dpi },
    publication: { overrides: config.overrides, seriesStyles: config.seriesStyles },
  });
}
