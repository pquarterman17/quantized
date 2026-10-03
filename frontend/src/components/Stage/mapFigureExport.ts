// The 2-D map's ⤓ export (MapStage). Vector by default (CLAUDE.md: carry
// over the MATLAB vector-output preference): PDF/SVG are rendered server-side
// by /api/export/map-figure (calc.figure_map) from the SAME regridded payload
// the canvas painted; PNG stays the on-screen canvas grab it always was.
//
// What the body carries from the view, so the figure reads like the canvas:
//   * the colormap, translated to matplotlib's name and orientation (the
//     canvas' `rdbu` runs blue -> red, which matplotlib calls `RdBu_r`);
//   * explicit colour limits, as a clamp of z (the canvas saturates there)
//     PLUS `z_limits`, the exact pair the canvas paints over
//     (`mapRender.effectiveColorLimits`) -- a clamp alone left matplotlib
//     normalising over the clamped data, so limits wider than the data
//     exported the full colormap (`tests/fixtures/wire/map_color_limits.json`);
//   * the log colour scale, as log10(z) with the colorbar label saying so —
//     the heatmap kind has no log norm; non-positive cells become gaps,
//     exactly as the canvas leaves them unpainted;
//   * the contour overlay, as filled contours with the overlay's level count
//     and spacing (the route has no heatmap+contour kind);
//   * the frame: the canvas' letterboxed equal aspect for axes sharing a unit
//     (Qx/Qz), and the heatmap's axis span (calc frames it like the canvas).
//   * the committed slices and text labels the map shows (`mapSliceGeometry`).
// ROIs, the ruler and the sector wedge are tools, not part of the figure.

import type { ColormapName } from "../../lib/colormap";
import { exportMapFigure, type MapFigureSpec } from "../../lib/api/mapFigure";
import { shouldLockAspect } from "../../lib/mapAspect";
import type { CutSpace } from "../../lib/mapcuts";
import type { MapAnnotation, MapSliceDef } from "../../lib/mapView";
import type { MapPayload } from "../../lib/mapdataFetch";
import { exportCanvasPng } from "../../lib/plotExport";
import { runCancellable } from "../../store/pendingOps";
import { askParams } from "../overlays/ParamDialog";
import { effectiveColorLimits, minPositive } from "./mapRender";
import { mapMarks } from "./mapSliceGeometry";
import { FIGURE_STYLES } from "../workshops/figurebuilder/figureOutputConstants";
import { withUnit } from "../../lib/unitDisplay";

const MPL_CMAP: Record<ColormapName, string> = {
  viridis: "viridis",
  magma: "magma",
  gray: "gray",
  rdbu: "RdBu_r",
};

export interface MapExportView {
  cmap: ColormapName;
  logZ: boolean;
  /** A null side is auto for that side (half-open, `lib/axisLim.ts`). */
  colorLimits: readonly [number | null, number | null] | null;
  contour: { on: boolean; levelCount: number; scale: "linear" | "log" };
  /** The map's committed slices and text labels, and the axis space shown. */
  marks?: { slices: readonly MapSliceDef[]; annotations: readonly MapAnnotation[]; space: CutSpace | null };
}

export interface MapExportOptions {
  fmt: string;
  style: string;
  title: string;
  filename: string;
}

function zCell(v: number | null, view: MapExportView): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  // The canvas drops a non-positive cell under log BEFORE any limit applies.
  if (view.logZ && v <= 0) return null;
  let z = v;
  if (view.colorLimits) {
    // Only a typed side saturates; an auto side is the data's own extent.
    const [lo, hi] = view.colorLimits;
    if (hi !== null) z = Math.min(hi, z);
    if (lo !== null && !(view.logZ && lo <= 0)) z = Math.max(lo, z);
  }
  return view.logZ ? Math.log10(z) : z;
}

/** The colour range the canvas paints for explicit limits, in the body's z
 *  units (log10 under a log colour scale); null for auto. `mapRender.draw`'s
 *  own `effectiveColorLimits` call, so the two cannot disagree. */
function zLimits(p: MapPayload, view: MapExportView): [number, number] | null {
  if (!view.colorLimits) return null;
  const lim = effectiveColorLimits(
    [view.colorLimits[0], view.colorLimits[1]],
    view.logZ ? minPositive(p.zGrid) : p.zMin,
    p.zMax,
    view.logZ,
  );
  return lim && view.logZ ? [Math.log10(lim[0]), Math.log10(lim[1])] : lim;
}

/** The /api/export/map-figure body for what this map is showing. Pure. */
export function mapFigureBody(p: MapPayload, view: MapExportView, o: MapExportOptions): MapFigureSpec {
  const zLabel = withUnit(p.zLabel, p.zUnit);
  const limits = zLimits(p, view);
  const marks = view.marks ? mapMarks(p, view.marks.slices, view.marks.annotations, view.marks.space) : null;
  const contour = view.contour.on
    ? {
        kind: "contourf",
        levels: view.contour.levelCount,
        // A log colour scale already sends log10(z): linear levels over it ARE
        // log-spaced, and a second log would be applied to exponents.
        level_scale: view.logZ ? "linear" : view.contour.scale,
      }
    : { kind: "heatmap" };
  return {
    x_axis: p.xAxis,
    y_axis: p.yAxis,
    z_grid: p.zGrid.map((row) => row.map((v) => zCell(v, view))),
    ...(limits ? { z_limits: limits } : {}),
    // The canvas letterboxes a map whose axes share a unit (`mapRender.plotRect`).
    ...(shouldLockAspect(p.xUnit, p.yUnit) ? { equal_aspect: true } : {}),
    ...(marks?.lines.length ? { lines: marks.lines } : {}),
    ...(marks?.labels.length ? { labels: marks.labels } : {}),
    ...contour,
    fmt: o.fmt,
    style: o.style,
    cmap: MPL_CMAP[view.cmap] ?? "viridis",
    title: o.title,
    x_label: withUnit(p.xLabel, p.xUnit),
    y_label: withUnit(p.yLabel, p.yUnit),
    z_label: view.logZ ? `log₁₀ ${zLabel}` : zLabel,
    filename: o.filename,
  };
}

export interface RunMapExportArgs {
  canvas: HTMLCanvasElement | null;
  payload: MapPayload | null;
  /** The map is regridding: `payload` (and the canvas) still show the
   *  PREVIOUS dataset/channels, so neither may go out under `stem`/`view`. */
  loading?: boolean;
  view: MapExportView;
  /** Filename stem (the dataset name without its extension). */
  stem: string;
  setStatus: (msg: string) => void;
}

/** Ask for format/style/title, then export: vector through the backend, PNG
 *  from the canvas. A cancelled dialog does nothing. */
export async function runMapExport({ canvas, payload, loading, view, stem, setStatus }: RunMapExportArgs): Promise<void> {
  if (loading) {
    setStatus("map export waits — the map is still loading");
    return;
  }
  const params = await askParams("Export map", [
    {
      key: "fmt",
      label: "Format",
      type: "select",
      default: "pdf",
      options: ["pdf", "svg", "png"],
      hint: "PDF / SVG are vector; PNG saves the on-screen canvas",
    },
    { key: "style", label: "Style", type: "select", default: "default", options: FIGURE_STYLES },
    { key: "title", label: "Title", type: "text", default: "" },
  ]);
  if (!params) return;
  const filename = `${stem}_map`;
  const fmt = typeof params.fmt === "string" ? params.fmt : "pdf";
  if (fmt === "png") {
    if (canvas) exportCanvasPng(canvas, `${filename}.png`);
    return;
  }
  if (!payload) {
    setStatus("map export failed — nothing is mapped yet");
    return;
  }
  const body = mapFigureBody(payload, view, {
    fmt,
    style: typeof params.style === "string" ? params.style : "default",
    title: typeof params.title === "string" ? params.title.trim() : "",
    filename,
  });
  try {
    const done = await runCancellable("Exporting map…", (signal) => exportMapFigure(body, signal));
    setStatus(done ? `exported ${filename}.${fmt}` : "export cancelled");
  } catch (e) {
    setStatus(`map export failed — ${e instanceof Error ? e.message : "unknown error"}`);
  }
}
