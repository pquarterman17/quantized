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
// Grouped specs (#12 Slice 5, finishing the #12 Slice 3 investigation's
// named residual): a group split turns ONE channel into N synthetic
// per-level series (`plotspec.ts`'s `buildXY`) — `FigureConfig.groupCol`
// (figuredoc.ts) and the export wire's `FigureSpec.group_col` now carry
// that split through, so `calc.plotting.build_grouped_series` (the
// backend's faithful port of `buildXY`) can reproduce it server-side.
// Per-level styling is intentionally NOT carried (see `displayToSeriesStyles`
// call site below) — `FigureConfig.seriesStyles` is 1:1-with-`yKeys`, which
// doesn't align with the synthetic per-level series, and the screen doesn't
// assign per-level colors either (`buildXY` never touches `seriesStyles`).
// A grouped spec still fails closed if it ALSO uses the secondary (Y2)
// axis — `buildXY` never assigns a grouped series to axis 1, so there's no
// sound semantic for the combination (see `specUsesY2` below).

import { buildExportStyles, type ExportSeriesStyle } from "./exportStyles";
import { plotSpecPublicationCompatibility } from "./figureCompatibility";
import { compactOverrides, type FigureOverrides } from "./figureOverrides";
import type { FigureDoc } from "./figuredoc";
import { specDatasetId, type AxesBlock, type DisplayBlock, type PlotSpec } from "./plotspec";
import type { AxisScale, SeriesStyle } from "./types";

export function plotSpecFigureReason(spec: PlotSpec): string | null {
  return plotSpecPublicationCompatibility(spec).blocker;
}

function stylesForMark(
  spec: PlotSpec,
  seriesStyles: Record<number, SeriesStyle>,
): (ExportSeriesStyle | null)[] {
  const base = buildExportStyles(spec.zones.y.map((r) => r.channel), seriesStyles);
  if (spec.mark === "line") {
    return spec.showMarkers ? base.map((style) => ({ ...(style ?? {}), marker: true })) : base;
  }
  if (spec.mark === "step") {
    const step = spec.stepMode ?? "post";
    return base.map((style) => ({
      ...(style ?? {}),
      step,
      ...(spec.showMarkers ? { marker: true } : {}),
    }));
  }
  // "scatter" — SeriesStyle's own "no line" mechanism translated to the
  // export vocabulary (ExportSeriesStyle DOES have a real `line: "none"`).
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
    if (sd.step !== undefined) style.step = sd.step;
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

  const groupCol = spec.zones.group?.channel ?? null;

  return {
    id: `plotspec-${Date.now().toString(36)}`,
    name: name.trim() || "Graph Builder plot",
    datasetId,
    live: true,
    config: {
      xKey: spec.zones.x?.channel ?? null,
      yKeys: spec.zones.y.map((r) => r.channel),
      groupCol,
      xScale,
      yScale,
      title,
      xLabel,
      yLabel,
      style: "default",
      fmt: "pdf",
      dpi: 300,
      overrides,
      // A grouped spec's yKeys don't align 1:1 with the rendered synthetic
      // per-level series (see the module doc comment) -- there's no sound
      // per-channel style to carry, so styling is omitted entirely and
      // matplotlib's default color cycle takes over, matching the screen.
      seriesStyles: groupCol !== null ? null : stylesForMark(spec, liveSeriesStyles),
    },
  };
}
