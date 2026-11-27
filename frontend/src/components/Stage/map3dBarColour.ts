// The request fields of a 3-D BAR view coloured from a column (lazy chunk).
//
// The option is `Map3dView.ext.barCol`, a column pick among `mapColumns(ds)`;
// it is READ here (an integer >= 0, else off). With a column the bars are the
// SOURCE rows (finite x, y, z -- positive under a log scale -- and a usable
// colour value), not the grid cells, sampled to the scatter's cap. A column with
// a level table (`cat_levels`) is categorical: palette colours and a legend,
// the levels sent as the names and the codes as the indices; any other column is
// a number: the colormap over its own extent and a colour bar. The footnote says
// how many rows were left out or sampled. Mirrors `calc/figure_map3d_colour.py`.

import type { MapFigureSpec } from "../../lib/api/mapFigure";
import { categoricalLevels } from "../../lib/categorical";
import type { Map3dView } from "../../lib/mapView3d";
import { MAP3D_MAX_POINTS, sampleEvenly, type MapSource } from "./map3dRequest";

export const readBarColumn = (e: Map3dView["ext"]): number | null => {
  const v = e?.barCol;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
};

const n = (v: number): string => v.toLocaleString("en-US");

/** The rows of a coloured bar view and the colour fields; null when no column is picked. */
export function barColourBody(v3: Map3dView, logZ: boolean, src: MapSource | undefined): Partial<MapFigureSpec> | null {
  const col = readBarColumn(v3.ext);
  if (col === null || !src) return null;
  const [kx, ky, kz] = src.keys;
  // `mapColumns` puts the file's first column in front unless the map is a parser 2-D map: the level tables stay keyed by the file's channels.
  const channel = col - (src.data.metadata["is2D"] === true ? 0 : 1);
  const levels = channel >= 0 ? categoricalLevels(src.data, channel) : null;
  const rows = src.data.values.filter((r) => [kx, ky, kz, col].every((k) => Number.isFinite(r[k])) && (!logZ || r[kz] > 0));
  const kept = rows.length <= MAP3D_MAX_POINTS ? rows : sampleEvenly(rows, MAP3D_MAX_POINTS);
  const label = src.data.labels[col] ?? "";
  const notes: string[] = [];
  if (kept.length < rows.length) notes.push(`Plotting ${n(kept.length)} of ${n(rows.length)} rows, evenly sampled.`);
  const total = src.data.values.length;
  if (rows.length < total) notes.push(`${n(total - rows.length)} rows not drawn (a gap in x, y, z or the colour column${logZ ? ", or a non-positive z" : ""}).`);
  return {
    x_axis: kept.map((r) => r[kx]), y_axis: kept.map((r) => r[ky]),
    z_values: kept.map((r) => (logZ ? Math.log10(r[kz]) : r[kz])), contour_source: "points",
    ...(levels
      ? { bar_group: kept.map((r) => (Number.isInteger(r[col]) ? r[col] : null)), bar_group_names: levels, bar_group_label: label }
      : { bar_cval: kept.map((r) => r[col]), bar_cval_label: label }),
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}
