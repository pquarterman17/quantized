// The Graph Builder's encoded export request (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4:
// Color-by / Symbol-by / legend-label source). The SERIES half is built from
// the SAME `plotEncoding.encodeSpec` result the preview draws, so the exported
// series can only differ from the screen where the backend port
// (`calc/plotting_encoded.py`) differs from `buildEncodedXY` — which the shared
// wire fixture `tests/fixtures/wire/graph_encoding_export.json` pins from both
// sides (`plotEncodingExport.test.ts` + `tests/test_export_graph_encoding.py`).
//
// The PRESENTATION half (axis scales, tick formats and steps, limits, legend
// placement, annotations and the rest of `overrides`, page size) comes from
// `figureSpecStage.buildStageFigureSpec` — the plot the Graph Builder's Export
// has just applied the spec to, exactly what an unencoded Graph Builder export
// sends. Its series fields are NOT taken: this export draws the PREVIEW's
// series (the spec's mark, no per-channel restyling), which is what the Graph
// Builder shows beside the button. The applied plot's own export — the Stage's
// Export figure… — carries the encoding too (`figureSpec.ts`, from the window
// document's `bindings.encoding`) over its per-channel styles. The dialog,
// `exportActive`'s resolve/cancel chokepoint and `/api/export/figure` are
// reused as-is via `runExportFigureCommand`'s `buildSpec` hook.
// Lazy-only, like `plotEncoding.ts`.

import type { FigureSpec } from "./api/figures";
import type { StoreGet } from "./exportActive";
import { toWireSeriesStyles } from "./exportStyles";
import type { FigureRenderOpts } from "./figureSpec";
import { exportErrorSpans } from "./figureSpecSeries";
import { buildStageFigureSpec } from "./figureSpecStage";
import { encodeSpec, type EncodedSpec } from "./plotEncoding";
import { figureEncodingWire, resolvedPalette } from "./plotEncodingBinding";
import type { PlotSpec } from "./plotspec";
import { stylesForMark } from "./plotSpecFigure";
import type { Dataset } from "./types";

export { resolvedPalette };

/** The `/api/export/figure` request for an encoded Graph Builder spec. The
 *  per-channel `series_styles` carry only the mark (the preview draws no
 *  per-channel styling either); the encoding rides `encoding`, and the backend
 *  lays palette colour and glyph over each split series. The legend is forced
 *  on because the preview always lists its entries — matplotlib would draw
 *  none for a lone series, dropping a label-source legend. Error spans ride
 *  only when nothing splits (`EncodedSpec.errors`), as the preview draws them. */
export function encodedFigureSpec(e: EncodedSpec, spec: PlotSpec, stem: string, o: FigureRenderOpts): FigureSpec {
  const { group } = e.enc;
  return {
    dataset: e.data,
    ...(e.xKey === null ? {} : { x_key: e.xKey }),
    y_keys: e.yChannels,
    ...(group === null ? {} : { group_col: group }),
    encoding: figureEncodingWire(e.enc),
    series_styles: toWireSeriesStyles(stylesForMark(spec, {}, true), true),
    ...(e.errors.length > 0 ? { error_spans: exportErrorSpans(e.data, e.yChannels, e.errors) } : {}),
    overrides: { legend: { show: true } },
    fmt: o.fmt,
    style: o.style,
    dpi: o.dpi,
    title: o.title,
    ...(o.xLabel ? { x_label: o.xLabel } : {}),
    ...(o.yLabel ? { y_label: o.yLabel } : {}),
    ...(o.greyscale ? { greyscale: true } : {}),
    filename: stem,
  };
}

/** The presentation fields an encoded export takes from the Stage plot's own
 *  request (see the module doc) — every one a whole-figure setting that does
 *  not depend on which series are drawn. */
const STAGE_PRESENTATION = ["x_scale", "y_scale", "x_fmt", "y_fmt", "x_step", "y_step", "width_in", "height_in"] as const;

/** Lay the Stage plot's presentation over an encoded request. `overrides`
 *  keeps everything but `y2_lim` (an encoded figure has no secondary axis) and
 *  shows the legend unless the plot hid it explicitly. */
export function withStagePresentation(encoded: FigureSpec, stage: FigureSpec): FigureSpec {
  const out: FigureSpec = { ...encoded };
  for (const k of STAGE_PRESENTATION) {
    if (stage[k] !== undefined) Object.assign(out, { [k]: stage[k] });
  }
  const { y2_lim: _noSecondaryAxis, ...ov } = stage.overrides ?? {};
  out.overrides = { ...ov, legend: { ...ov.legend, show: ov.legend?.show ?? true } };
  return out;
}

/** `encodedFigureSpec` for `spec` against the export's RESOLVED dataset (the
 *  one `exportActive` hands over, never a stale preview copy). Throws when the
 *  spec no longer encodes anything, which `exportActive` reports as an
 *  ordinary export failure instead of silently exporting a different figure. */
export function buildEncodedFigureSpec(spec: PlotSpec, ds: Dataset, stem: string, o: FigureRenderOpts): FigureSpec {
  const e = encodeSpec(spec, [ds]);
  if (!e) throw new Error("this graph no longer has a Color, Symbol or Label encoding to export");
  return encodedFigureSpec(e, spec, stem, o);
}

/** The Graph Builder Export's `buildSpec`: the encoded series over the
 *  presentation of the plot the spec was just applied to. */
export function buildEncodedExport(s: StoreGet, spec: PlotSpec, ds: Dataset, stem: string, o: FigureRenderOpts): FigureSpec {
  return withStagePresentation(buildEncodedFigureSpec(spec, ds, stem, o), buildStageFigureSpec(s, ds, stem, o));
}
