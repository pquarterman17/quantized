// Bounded Graph Builder -> Figure Builder bridge (GUI_INTERACTION #11, #12
// Slice 3). Only the ordinary single-dataset XY family is representable by
// today's FigureDoc; faceted, statistical, and cross-dataset specs fail
// closed instead of being flattened into a misleading publication figure.
//
// A v1 spec's per-series styling still comes from the LIVE `seriesStyles`
// side-channel arg (today's exact behavior, kept for back-compat and used
// as the v2 FALLBACK too). Once a spec carries v2 `display`/`axes` blocks
// (GUI_INTERACTION #12 Slice 2 grammar, captured at save time by
// useGraphBuilder's `captureLiveBlocks` — see lib/plotspec2.ts), THOSE win:
// the spec is self-describing and the live arg is ignored for whichever
// piece (styling / axes) the spec's own blocks cover.
//
// Grouped specs stay fail-closed — NOT a placeholder, a structural finding
// (#12 Slice 3 investigation): a group split turns ONE channel into N
// synthetic per-level series (`plotspec.ts`'s `buildXY`), but `FigureConfig`
// (figuredoc.ts) and the export wire shape (`FigureSpec.y_keys` /
// `exportFigureCommand`'s `y_keys`) are both a flat list of REAL dataset
// channel indices — there is no group-by/split field anywhere in that
// contract to carry the extra synthetic series through. Forcing it would
// mean inventing fake channel indices or silently dropping levels, either
// of which is exactly the "misleading publication figure" this bridge
// exists to prevent. Representing a group split needs a wire contract
// change (a Slice 5 concern, alongside the Stage adapter) — noted, not
// solved here.

import { buildExportStyles, type ExportSeriesStyle } from "./exportStyles";
import { compactOverrides, type FigureOverrides } from "./figureOverrides";
import type { FigureDoc } from "./figuredoc";
import { specDatasetId, type AxesBlock, type DisplayBlock, type PlotSpec } from "./plotspec";
import type { AxisScale, SeriesStyle } from "./types";

/** Does the spec put any of its own series on the secondary (Y2) axis, via
 *  either the per-series `display.series[ch].axis === 1` flag or an explicit
 *  `axes.y2` config? `FigureConfig` (figuredoc.ts) has NO y2 field at all
 *  (documented limitation) — publishing one would silently lose the
 *  secondary axis, so a spec that uses one fails closed instead of quietly
 *  flattening it onto the primary axis. */
function specUsesY2(spec: PlotSpec): boolean {
  const series = spec.display?.series;
  if (series && Object.values(series).some((sd) => sd.axis === 1)) return true;
  return spec.axes?.y2 !== undefined;
}

export function plotSpecFigureReason(spec: PlotSpec): string | null {
  if (spec.mark !== "line" && spec.mark !== "scatter") return "Only line and scatter plots can open in Figure Builder.";
  if (spec.zones.y.length === 0) return "Assign at least one Y channel first.";
  if (spec.zones.group) {
    return "Grouped plots split one channel into a series per group level — Figure Builder's y-keys are real dataset channel indices with no group-split slot yet (needs a Slice 5 wire contract change).";
  }
  if (spec.zones.facet) return "Faceted plots need a multi-panel Figure Builder contract first.";
  const datasetIds = new Set(
    [spec.zones.x, ...spec.zones.y].filter((ref) => ref !== null).map((ref) => ref.datasetId),
  );
  if (datasetIds.size !== 1) return "Every plotted channel must belong to one dataset.";
  if (specDatasetId(spec) === null) return "Every plotted channel must belong to one dataset.";
  if (specUsesY2(spec)) {
    return "Figure Builder has no secondary (Y2) axis yet — move this series to the primary axis first.";
  }
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

/** The v2 display block's per-series overrides, reshaped into the
 *  `Record<number, SeriesStyle>` `stylesForMark`/`buildExportStyles` already
 *  know how to read — same field names (`color`/`width`/`marker`/
 *  `markerShape`/`line`), just dropping `hidden`/`axis`, which have no
 *  FigureConfig equivalent (yKeys IS the plotted set; there's no secondary
 *  axis — see `specUsesY2`). */
function displayToSeriesStyles(display: DisplayBlock | undefined): Record<number, SeriesStyle> {
  const out: Record<number, SeriesStyle> = {};
  for (const [key, sd] of Object.entries(display?.series ?? {})) {
    const style: SeriesStyle = {};
    if (sd.color !== undefined) style.color = sd.color;
    if (sd.width !== undefined) style.width = sd.width;
    if (sd.marker !== undefined) style.marker = sd.marker;
    if (sd.markerShape !== undefined) style.markerShape = sd.markerShape;
    if (sd.line !== undefined) style.line = sd.line;
    out[Number(key)] = style;
  }
  return out;
}

/** The v2 axes block's x/y label+lim, mapped onto the ONLY overrides
 *  FigureOverrides can express for them (`x_lim`/`y_lim`); `step`/`fmt` have
 *  no FigureOverrides equivalent (mapped nowhere — "map ONLY what exists").
 *  y2 is never read here — a spec with y2 content already fails closed via
 *  `specUsesY2` before this runs. */
function buildAxesOverrides(axes: AxesBlock | undefined): FigureOverrides | null {
  if (!axes) return null;
  const ov: FigureOverrides = {};
  if (axes.x?.lim) ov.x_lim = axes.x.lim;
  if (axes.y?.lim) ov.y_lim = axes.y.lim;
  return compactOverrides(ov);
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

  const axes = spec.axes;
  // v1 (or a v2 spec whose axes block is absent/doesn't cover a field):
  // "linear"/""/null exactly as before this slice (regression-pinned) —
  // the axes block wins PER FIELD when it says something, never wholesale.
  const xScale: AxisScale = axes?.x?.scale ?? "linear";
  const yScale: AxisScale = axes?.y?.scale ?? "linear";
  const title = axes?.title ?? "";
  const xLabel = axes?.x?.label ?? "";
  const yLabel = axes?.y?.label ?? "";
  const overrides = buildAxesOverrides(axes);

  // Same per-block precedence for styling: the display block wins outright
  // when present (it's the spec's own captured styling), otherwise fall
  // back to the live arg exactly as today.
  const liveSeriesStyles = spec.display ? displayToSeriesStyles(spec.display) : seriesStyles;

  return {
    id: `plotspec-${Date.now().toString(36)}`,
    name: name.trim() || "Graph Builder plot",
    datasetId,
    live: true,
    config: {
      xKey: spec.zones.x?.channel ?? null,
      yKeys: spec.zones.y.map((r) => r.channel),
      xScale,
      yScale,
      title,
      xLabel,
      yLabel,
      style: "default",
      fmt: "pdf",
      dpi: 300,
      overrides,
      seriesStyles: stylesForMark(spec, liveSeriesStyles),
    },
  };
}
