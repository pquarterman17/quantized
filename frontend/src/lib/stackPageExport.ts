// The per-channel STACK's vector export (plot audit round 4). "Export figure…"
// used to post the flat `FigureSpec` for a stacked view, which renders ONE
// overlaid plot, and only warned about it (`lib/screenOnlyExport.ts`). This
// turns that flat spec into a figure-page request drawing what the canvas
// draws (`Stage/stackPanelRender.ts`): one panel per plotted channel, top to
// bottom in display order, sharing x, x tick labels and title on the bottom
// panel only (the page route's `stack` layout), no legend, each panel's y
// title its series' name.
//
// Each panel is the flat spec cut to its one channel, so everything the flat
// export already gets right rides along unchanged: the pruned rows, axis
// scales and formats, x limits, ticks/grid/box, reference lines, error spans,
// greyscale. What the canvas stack does NOT draw is dropped: the legend, a
// fixed y range (each panel autoscales its own y), the y2 split, grouping and
// encodings, waterfall/decade offsets, annotations, shapes, shades, the
// axis-title drag, and the analysis overlays and grey companions appended
// past the plotted channels.
//
// The series STYLE is rebuilt rather than cut: a stack panel is a one-series
// canvas, so an unstyled channel draws in the palette's first colour with no
// cycled dash (`buildOpts` position 0), not in its flat-plot slot. The same
// builders the spatial page uses (`lib/spatialPageExport.ts`) produce it.
// Imported only by the lazily loaded export command.

import type { FigureSpec } from "./api/figures";
import type { FigurePageSpec } from "./api/figurePage";
import type { StoreGet } from "./exportActive";
import { traceSeriesStyles } from "./exportDefaultTrace";
import { lineWidthSeriesStyles } from "./exportLineWidth";
import { buildExportStyles, toWireSeriesStyles } from "./exportStyles";
import type { FigureOverrides } from "./figureOverrides";
import { withSeriesLegends } from "./figureSpecSeries";
import { effectiveChannels } from "./plotdata";
import { canvasLineWidth } from "./plotTemplates";
import type { Dataset, DefaultTrace, SeriesStyle } from "./types";

/** The view a stack panel is styled from — what `MultiPanelStage` hands the
 *  stack leg. `channels` is the canvas' plotted list (hidden ones removed). */
export interface StackExportView {
  channels: readonly number[];
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  defaultTrace?: DefaultTrace;
  lineWidth?: number;
}

/** The override keys a stack panel's canvas honours (`useMultiPanelStage`'s
 *  stack `cell`). `margins` is a page-level decision and is refused there. */
const PANEL_KEYS = ["font_size", "font_name", "title_size", "ticks", "spines", "x_lim", "x_reversed", "grid", "ref_lines"] as const;

function panelOverrides(ov: FigureOverrides | null | undefined): FigureOverrides {
  const out: FigureOverrides = { legend: { show: false } };
  for (const k of PANEL_KEYS) if (ov?.[k] !== undefined) (out as Record<string, unknown>)[k] = ov[k];
  return out;
}

/** One channel's panel figure, cut from the flat spec. */
function panelFigure(flat: FigureSpec, i: number, ch: number, top: boolean, view: StackExportView): FigureSpec {
  /* eslint-disable @typescript-eslint/no-unused-vars -- dropped: the stack canvas draws none of these */
  const {
    y2_keys, y2_label, y2_scale, y2_fmt, y2_step, group_col, encoding, waterfall_offsets,
    waterfall_x_offsets, log_offsets, axis_label_styles, axis_label_offsets, series_styles, error_spans,
    y_label, overrides, ...kept
  } = flat;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  const keys = [ch];
  const styles = withSeriesLegends(
    lineWidthSeriesStyles(
      traceSeriesStyles(toWireSeriesStyles(buildExportStyles(keys, view.seriesStyles), false), keys, view.defaultTrace, view.seriesStyles),
      keys,
      view.lineWidth,
    ) ?? null,
    [view.seriesLabels[ch]],
  );
  const span = error_spans?.[i];
  return {
    ...kept,
    y_keys: keys,
    title: top ? flat.title : "",
    ...(styles ? { series_styles: styles } : {}),
    ...(span ? { error_spans: [span] } : {}),
    overrides: panelOverrides(overrides),
  };
}

/** The figure-page request for a stacked view, or null when `flat` is not a
 *  plain per-channel stack this can draw (fewer than two channels, a channel
 *  missing from the request, or a facet / break / polar request). */
export function stackPageRequest(flat: FigureSpec, view: StackExportView): FigurePageSpec | null {
  if (view.channels.length < 2 || flat.facets || flat.polar || flat.overrides?.x_breaks?.length) return null;
  const at = view.channels.map((ch) => flat.y_keys?.indexOf(ch) ?? -1);
  if (at.some((i) => i < 0)) return null;
  const n = view.channels.length;
  return {
    rows: n,
    cols: 1,
    panels: view.channels.map((ch, r) => ({ figure: panelFigure(flat, at[r], ch, r === 0, view), row: r, col: 0, label: "" })),
    fmt: flat.fmt,
    style: flat.style,
    dpi: flat.dpi,
    ...(flat.width_in != null ? { width_in: flat.width_in } : {}),
    ...(flat.height_in != null ? { height_in: flat.height_in } : {}),
    label_format: "none",
    link_x: true,
    stack: true,
    ...(flat.svg_text_as_paths ? { svg_text_as_paths: true } : {}),
    filename: flat.filename,
  };
}

/** The stack the Stage shows for `ds`, or null when it shows something else
 *  (no stack, or a spatial page, facet grid, polar or stat view in its place).
 *  The channel list is the canvas' own (`useMultiPanelStage`'s `plotted`). */
export function stackExportView(st: ReturnType<StoreGet>, ds: Dataset): StackExportView | null {
  if (!st.stackMode || st.polarMode || st.statMode || st.composition !== null || st.facetKey !== null) return null;
  return {
    channels: effectiveChannels(ds.data, st.yKeys, st.xKey, ds.channelRoles, st.seriesOrder).filter((c) => !st.hiddenChannels.includes(c)),
    seriesStyles: st.seriesStyles,
    seriesLabels: st.seriesLabels,
    defaultTrace: st.defaultTrace,
    lineWidth: canvasLineWidth(st.plotTemplate, st.defaultLineWidth),
  };
}
