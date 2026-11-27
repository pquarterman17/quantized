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
import { textColumnCells } from "../../lib/originTextColumnCells";
import { MAP3D_MAX_POINTS, sampleEvenly, type MapSource } from "./map3dRequest";

export const readBarColumn = (e: Map3dView["ext"]): number | null => {
  const v = e?.barCol;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
};

/** A sheet's text column picked for the bar colour, by name (`ext.barColText`); a number pick wins when both are stored. */
export const readBarText = (e: Map3dView["ext"]): string | null => {
  const v = e?.barColText;
  return readBarColumn(e) === null && typeof v === "string" && v !== "" ? v : null;
};

const n = (v: number): string => v.toLocaleString("en-US");

/** The rows of a coloured bar view and the colour fields; null when no column is picked
 *  (or the picked text column is gone: a renamed one, or a sampled preview's). */
export function barColourBody(v3: Map3dView, logZ: boolean, src: MapSource | undefined): Partial<MapFigureSpec> | null {
  const picked = readBarColumn(v3.ext);
  const textName = readBarText(v3.ext);
  const cells = textName !== null && src ? textColumnCells(src.data, textName) : null;
  if ((picked === null && cells === null) || !src) return null;
  const [kx, ky, kz] = src.keys;
  // `mapColumns` puts the file's first column in front unless the map is a parser 2-D map: the level tables stay keyed by the file's channels.
  const channel = picked === null ? -1 : picked - (src.data.metadata["is2D"] === true ? 0 : 1);
  const levels = channel >= 0 ? categoricalLevels(src.data, channel) : null;
  const text = (i: number): string => (cells ? String(cells[i] ?? "").trim() : "");
  // Source-row indexes: a text column's cell is read by the row it sits on.
  const idx = src.data.values.flatMap((r, i) =>
    [kx, ky, kz].every((k) => Number.isFinite(r[k])) && (!logZ || r[kz] > 0) && (cells ? text(i) !== "" : Number.isFinite(r[picked as number])) ? [i] : [],
  );
  const keptIdx = idx.length <= MAP3D_MAX_POINTS ? idx : sampleEvenly(idx, MAP3D_MAX_POINTS);
  const kept = keptIdx.map((i) => src.data.values[i]);
  const label = textName ?? src.data.labels[picked as number] ?? "";
  const notes: string[] = [];
  if (kept.length < idx.length) notes.push(`Plotting ${n(kept.length)} of ${n(idx.length)} rows, evenly sampled.`);
  const total = src.data.values.length;
  if (idx.length < total) notes.push(`${n(total - idx.length)} rows not drawn (a gap in x, y, z or the colour column${logZ ? ", or a non-positive z" : ""}).`);
  let colour: Partial<MapFigureSpec>;
  if (cells) {
    const g = keptIdx.map(text);
    const names = [...new Set(g)].sort().slice(0, 1001);
    colour = { bar_group: g.map((v) => { const i = names.indexOf(v); return i < 0 ? null : i; }), bar_group_names: names, bar_group_label: label };
  } else if (levels) {
    colour = { bar_group: kept.map((r) => (Number.isInteger(r[picked as number]) ? r[picked as number] : null)), bar_group_names: levels, bar_group_label: label };
  } else colour = { bar_cval: kept.map((r) => r[picked as number]), bar_cval_label: label };
  return {
    x_axis: kept.map((r) => r[kx]), y_axis: kept.map((r) => r[ky]),
    z_values: kept.map((r) => (logZ ? Math.log10(r[kz]) : r[kz])), contour_source: "points",
    ...colour,
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}
