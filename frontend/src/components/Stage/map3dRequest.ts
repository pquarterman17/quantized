// What the Map stage's static 3-D preview and its export share. The preview is
// the server's PNG of `mapFigureBody(payload, view, view3dOptions(v3, "png",
// …))`; the export is `mapFigureBody` over the same payload and view with
// `view3dOptions(v3, fmt, …)` -- the request differs ONLY in `fmt` and
// `filename`, so the exported figure is exactly the one on screen
// (`map3dRequest.test.ts` pins the equality). Every input the picture depends
// on (grid, colormap, log, colour limits, angles, z label, style, title) is in
// that body, so the body IS the preview's cache key.

import { DEFAULT_MAP3D, MAP3D_KINDS, type Map3dView } from "../../lib/mapView3d";
import type { MapPayload } from "../../lib/mapdataFetch";
import type { DataStruct } from "../../lib/types";
import type { MapExportOptions, MapExportView } from "./mapFigureExport";

/** A 3-D waterfall of a grid draws at most this many evenly stepped rows, so a
 *  200-row map reads as lines, not a dense surface (the route's `max_lines`). */
export const WATERFALL_MAX_LINES = 40;

/** A 3-D scatter draws at most this many points (the route's own cap): 250k took
 *  6 s as PNG and 20 s as SVG while holding the global render lock. */
export const MAP3D_MAX_POINTS = 50_000;

/** At most `limit` of `items`, evenly spread, first and last kept, order kept --
 *  the server's `decimate` rule (round(linspace), de-duplicated). */
export function sampleEvenly<T>(items: readonly T[], limit: number): T[] {
  const n = items.length;
  if (n <= limit) return [...items];
  const idx = new Set<number>();
  for (let k = 0; k < limit; k++) idx.add(Math.round((k * (n - 1)) / (limit - 1)));
  return [...idx].map((i) => items[i]);
}

export interface MapSource {
  data: DataStruct;
  keys: readonly [number, number, number];
}

/** The ORIGINAL x/y/z columns, when a 3-D scatter should plot them: the data was
 *  scattered (the backend interpolated it, or the offline fallback regridded it)
 *  rather than measured on a grid. Genuinely gridded data keeps the grid path. */
export function rawSource(p: MapPayload, view: MapExportView): { x: number[]; y: number[]; z: number[] } | undefined {
  const src = view.source;
  if (view.view3d?.kind !== "scatter3d" || !src || !(p.interpolated || p.fallback)) return undefined;
  const col = (k: number) => src.data.values.map((row) => row[k]);
  return { x: col(src.keys[0]), y: col(src.keys[1]), z: col(src.keys[2]) };
}

export const FLAT_CHOICE = "2-D map";
/** The dialog's / panel's view choices, by the kind each one means. */
export const MAP3D_LABELS: Record<(typeof MAP3D_KINDS)[number], string> = {
  surface: "Surface",
  scatter3d: "3-D scatter",
  waterfall: "3-D waterfall",
};

/** The request options for this 3-D view in `fmt`; style and title come from
 *  the view itself so preview and export cannot differ in them. */
export function view3dOptions(v3: Map3dView, fmt: string, filename: string): MapExportOptions {
  return { fmt, style: v3.style, title: v3.title, filename };
}

export type Choice3d = { ok: true; view3d: Map3dView | undefined } | { ok: false; error: string };

/** The export dialog's answers as the figure's 3-D state. Out-of-range angles
 *  are refused (a stated reason), never clamped into a different picture than
 *  the one asked for. `FLAT_CHOICE` = the 2-D map (no 3-D view). */
export function choose3d(
  current: Map3dView | undefined,
  v: { view: string; elev: number; azim: number; style: string; title: string },
): Choice3d {
  const kind = MAP3D_KINDS.find((k) => MAP3D_LABELS[k] === v.view);
  if (!kind) return { ok: true, view3d: undefined };
  if (!Number.isFinite(v.elev) || v.elev < -90 || v.elev > 90) return { ok: false, error: "elevation must be from -90 to 90 degrees" };
  if (!Number.isFinite(v.azim) || v.azim < -360 || v.azim > 360) return { ok: false, error: "azimuth must be from -360 to 360 degrees" };
  return { ok: true, view3d: { ...(current ?? DEFAULT_MAP3D), kind, elev: v.elev, azim: v.azim, style: v.style, title: v.title } };
}
