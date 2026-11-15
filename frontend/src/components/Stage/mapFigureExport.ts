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
//   * the log colour scale, as log10(z) with `colorbar_log10` so the bar
//     labels its decades by value like the canvas — the heatmap kind has no
//     log norm; non-positive cells become gaps, as the canvas leaves them;
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
import type { Map3dView } from "../../lib/mapView3d";
import type { MapAnnotation, MapSliceDef } from "../../lib/mapView";
import { interpolatedNote, type MapPayload } from "../../lib/mapdataFetch";
import { exportCanvasPng } from "../../lib/plotExport";
import { runCancellable } from "../../store/pendingOpActions";
import { askParams } from "../overlays/ParamDialog";
import { choose3d, FLAT_CHOICE, MAP3D_LABELS, rawSource, view3dOptions, WATERFALL_MAX_LINES, type MapSource } from "./map3dRequest";
import { sameMap3d } from "../../lib/mapView3d";
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
  /** Static 3-D view: the figure is the surface / scatter / waterfall the stage
   *  previews (`map3dRequest.ts`), not the 2-D map. */
  view3d?: Map3dView;
  /** The map's raw columns and picks: a 3-D scatter of data that is NOT
   *  gridded plots these original points, not the regridded surface. */
  source?: MapSource;
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

/** The raw measured points as the route's scattered source: rows with a
 *  non-finite value (or, under a log scale, a non-positive z) are dropped whole,
 *  and every kept point goes out unchanged -- no grid, no resampling. */
function pointsBody(raw: { x: number[]; y: number[]; z: number[] }, view: MapExportView) {
  const out = { x_axis: [] as number[], y_axis: [] as number[], z_values: [] as number[], contour_source: "points" };
  raw.z.forEach((v, i) => {
    const z = zCell(v, view);
    if (z === null || !Number.isFinite(raw.x[i]) || !Number.isFinite(raw.y[i])) return;
    out.x_axis.push(raw.x[i]);
    out.y_axis.push(raw.y[i]);
    out.z_values.push(z);
  });
  return out;
}

/** The /api/export/map-figure body for what this map is showing. Pure. */
export function mapFigureBody(p: MapPayload, view: MapExportView, o: MapExportOptions): MapFigureSpec {
  const v3 = view.view3d;
  const zLabel = v3 ? withUnit(v3.zLabel || p.zLabel, v3.zUnit || p.zUnit) : withUnit(p.zLabel, p.zUnit);
  const limits = zLimits(p, view);
  // Slices, labels and the contour overlay are 2-D marks; a 3-D figure has none.
  const marks = view.marks && !v3 ? mapMarks(p, view.marks.slices, view.marks.annotations, view.marks.space) : null;
  const raw = rawSource(p, view);
  const contour = v3
    ? { kind: v3.kind, view_elev: v3.elev, view_azim: v3.azim, ...(v3.kind === "waterfall" ? { max_lines: WATERFALL_MAX_LINES } : {}) }
    : view.contour.on
    ? {
        kind: "contourf",
        levels: view.contour.levelCount,
        // A log colour scale already sends log10(z): linear levels over it ARE
        // log-spaced, and a second log would be applied to exponents.
        level_scale: view.logZ ? "linear" : view.contour.scale,
      }
    : { kind: "heatmap" };
  return {
    ...(raw ? pointsBody(raw, view) : {
      x_axis: p.xAxis,
      y_axis: p.yAxis,
      z_grid: p.zGrid.map((row) => row.map((v) => zCell(v, view))),
    }),
    ...(limits ? { z_limits: limits } : {}),
    // The canvas letterboxes a map whose axes share a unit (`mapRender.plotRect`).
    ...(!v3 && shouldLockAspect(p.xUnit, p.yUnit) ? { equal_aspect: true } : {}),
    ...(marks?.lines.length ? { lines: marks.lines } : {}),
    ...(marks?.labels.length ? { labels: marks.labels } : {}),
    ...contour,
    ...(p.interpolated && !raw ? { note: interpolatedNote(p.interpolated.nPoints) } : {}),
    fmt: o.fmt,
    style: o.style,
    cmap: MPL_CMAP[view.cmap] ?? "viridis",
    title: o.title,
    x_label: withUnit(p.xLabel, p.xUnit),
    y_label: withUnit(p.yLabel, p.yUnit),
    // The canvas bar's title, and its decade labels by value (not exponent).
    z_label: view.logZ ? `${zLabel} — log` : zLabel,
    ...(view.logZ ? { colorbar_log10: true } : {}),
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
  /** Commit the 3-D choice made in the dialog to the figure state (undoable),
   *  so the on-screen preview becomes exactly the figure that is exported. */
  setView3d?: (v: Map3dView | undefined) => void;
}

/** Ask for format/style/title, then export: vector through the backend, PNG
 *  from the canvas. A cancelled dialog does nothing. */
export async function runMapExport({ canvas, payload, loading, view, stem, setStatus, setView3d }: RunMapExportArgs): Promise<void> {
  if (loading) {
    setStatus("map export waits — the map is still loading");
    return;
  }
  const v3 = view.view3d;
  const params = await askParams("Export map", [
    {
      key: "fmt",
      label: "Format",
      type: "select",
      default: "pdf",
      options: ["pdf", "svg", "png"],
      hint: "PDF / SVG are vector; PNG saves the on-screen canvas (a 3-D view: the server render)",
    },
    {
      key: "view", label: "View", type: "select", default: v3 ? MAP3D_LABELS[v3.kind] : FLAT_CHOICE,
      options: [FLAT_CHOICE, ...Object.values(MAP3D_LABELS)],
      hint: "Surface / 3-D scatter / 3-D waterfall are static server renders; the choice is kept with the map",
    },
    { key: "elev", label: "Elevation (°)", type: "number", default: v3?.elev ?? 30, hint: "3-D views: -90 to 90" },
    { key: "azim", label: "Azimuth (°)", type: "number", default: v3?.azim ?? -60, hint: "3-D views: -360 to 360" },
    { key: "style", label: "Style", type: "select", default: v3?.style ?? "default", options: FIGURE_STYLES },
    { key: "title", label: "Title", type: "text", default: v3?.title ?? "" },
  ], { confirmLabel: "Export" });
  if (!params) return;
  const filename = `${stem}_map`;
  const fmt = typeof params.fmt === "string" ? params.fmt : "pdf";
  const style = typeof params.style === "string" ? params.style : "default";
  const title = typeof params.title === "string" ? params.title.trim() : "";
  const choice = choose3d(v3, {
    view: String(params.view), elev: Number(params.elev), azim: Number(params.azim), style, title,
  });
  if (!choice.ok) {
    setStatus(`map export refused — ${choice.error}`);
    return;
  }
  const next3d = choice.view3d;
  if (!sameMap3d(v3, next3d)) setView3d?.(next3d);
  if (fmt === "png" && !next3d) {
    if (canvas) exportCanvasPng(canvas, `${filename}.png`);
    return;
  }
  if (!payload) {
    setStatus("map export failed — nothing is mapped yet");
    return;
  }
  const body = mapFigureBody(
    payload,
    { ...view, view3d: next3d },
    next3d ? view3dOptions(next3d, fmt, filename) : { fmt, style, title, filename },
  );
  try {
    const done = await runCancellable("Exporting map…", (signal) => exportMapFigure(body, signal));
    setStatus(done ? `exported ${filename}.${fmt}` : "export cancelled");
  } catch (e) {
    setStatus(`map export failed — ${e instanceof Error ? e.message : "unknown error"}`);
  }
}
