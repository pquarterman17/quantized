/** Pure compatibility boundary: legacy Publication Preview figures become
 * canonical v2 drafts only when explicitly opened, never during workspace load. */
import { createFigureDocument, type FigureDocument } from "./figureDocument";
import type { FigureOverrides } from "./figureOverrides";
import type { FigureDoc } from "./figuredoc";
import { defaultPlotView } from "./plotview";
import type { RefLine, Shape } from "./types";

export function figureDocumentFromLegacyFigureDoc(legacy: FigureDoc): FigureDocument {
  const config = legacy.config;
  if (!legacy.live && !legacy.dataSnapshot) {
    throw new Error(`frozen legacy FigureDoc "${legacy.id}" has no data snapshot`);
  }
  // F2.1i: `config.overrides.shapes`/`.ref_lines` used to copy RAW into
  // `publication.overrides` -- fine for export (publication wins the
  // buildFigureSpecFromDocument merge, so the objects still rendered), but
  // the Shapes (F2.3c) and Reference-lines (F2.3d) panels read
  // `plot.view.shapes`/`.refLines` DIRECTLY (useFigureBuilder.ts), never
  // publication.overrides -- so a promoted copy rendered them yet showed both
  // panels empty and un-editable (audited in figureCompatibility.ts). Decompose
  // them into the view here, and strip them from the override bag below, so
  // the promoted document represents each object exactly ONCE.
  //
  // Wire shapes/ref_lines carry no `id` (figureOverrides.ts's `shapes`/
  // `ref_lines` mirror `Shape`/`RefLine` minus id -- see figureSpec.ts's
  // `viewOverrides`); mint deterministic ids from the source doc id + array
  // index, the same convention lib/originFigures.ts uses for its own
  // wire->view conversions (`figann-${key}-${fi}-${mi}`) so re-promoting the
  // SAME legacy doc twice yields the SAME ids rather than a fresh set each
  // time.
  const ov: FigureOverrides = config.overrides ?? {};
  const { shapes: wireShapes, ref_lines: wireRefLines, ...restOverrides } = ov;
  const shapes: Shape[] = (wireShapes ?? []).map((wire, i) => ({
    id: `legacyshape-${legacy.id}-${i}`,
    ...wire,
  }));
  const refLines: RefLine[] = (wireRefLines ?? []).map((wire, i) => ({
    id: `legacyref-${legacy.id}-${i}`,
    ...wire,
  }));
  // `region_shades` has NO view editor anywhere yet (an owner decision on
  // whether decoded shades become editable is pending) -- unlike shapes/
  // ref_lines above, it stays raw in the override bag untouched.
  const overrides: FigureOverrides | null = Object.keys(restOverrides).length ? restOverrides : null;
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
      shapes,
      refLines,
    },
    groupKey: config.groupCol ?? null,
    // Graph Builder's error wells (#51 phase 3): threaded through so
    // Publication Preview opened from Graph Builder carries the SAME error
    // bars the wells describe, even before they've been committed to
    // `Dataset.errorRoles` (see FigureConfig.errors' doc). `undefined` (every
    // non-Graph-Builder FigureDoc) falls back to createFigureDocument's own
    // legacy-errKeys default, unchanged.
    errors: config.errors ?? undefined,
    data: legacy.live
      ? { mode: "live" }
      : { mode: "frozen", snapshot: legacy.dataSnapshot },
    output: { format: config.fmt, stylePreset: config.style, dpi: config.dpi },
    // seriesStyles investigated (F2.1i) and deliberately left RAW, unlike
    // shapes/ref_lines above -- see legacyFigure.ts's `buildLegacyFigureDoc`:
    // every producer builds this array via `buildExportStyles`/`stylesForMark`,
    // which bakes MARK-level choices into per-entry fields no `SeriesStyle`
    // (the view type) can represent losslessly. A scatter-mark entry carries
    // `line: "none"` -- there is no such `SeriesStyle.line` value; the
    // canonical view instead signals "no line, markers only" with the MODE
    // sentinel `width: 0` (canonicalSeries.ts's `seriesModeOf`/
    // `seriesModePatch`), which would require DISCARDING the entry's own
    // `width` (a real, if moot, stored value) to encode correctly -- copying
    // both fields verbatim instead renders as "Line + Symbol" in the Series
    // (F2.3b) panel, not "Scatter". Leaving `publication.seriesStyles` an
    // exact array also matches its own deliberate F2.1a contract ("an array
    // is exact", independent of the view) that every OTHER FigureDocument
    // producer already honors -- decomposing it here would be the one path
    // that silently opts a promoted legacy doc OUT of that contract.
    publication: { overrides, seriesStyles: config.seriesStyles },
  });
}
