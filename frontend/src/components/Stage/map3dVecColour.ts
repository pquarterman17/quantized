// The request fields of a 3-D VECTOR view coloured from a column (lazy chunk).
//
// The option is `Map3dView.ext.vecCCol` (a column pick among `mapColumns(ds)`, an
// integer >= 0) or `ext.vecCText` (a sheet text column, by name); a number pick
// wins when both are stored. Unlike the bars the arrows keep their rows: a row
// whose colour value is a gap is sent as null and counted as not drawn by the scene
// and the route alike (`Map3D/vectorColour3d.ts`, `calc/figure_map3d_colour.py`).
// A column with a level table (`cat_levels`, keyed by the FILE's channel) or a text
// column is categorical (palette and legend, at most 10 levels); any other column
// is a number (the colormap over its own extent and a colour bar). A text column
// that is gone (renamed, or a sampled preview's) colours nothing: fail closed.

import type { MapFigureSpec } from "../../lib/api/mapFigure";
import { categoricalLevels } from "../../lib/categorical";
import type { Map3dView } from "../../lib/mapView3d";
import { textColumnCells } from "../../lib/originTextColumnCells";
import type { MapSource } from "./map3dRequest";

export const readVecColumn = (e: Map3dView["ext"]): number | null => {
  const v = e?.vecCCol;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
};

export const readVecText = (e: Map3dView["ext"]): string | null => {
  const v = e?.vecCText;
  return readVecColumn(e) === null && typeof v === "string" && v !== "" ? v : null;
};

/** The colour fields for the arrows drawn from source rows `idx` (empty when no column is picked). */
export function vecColourFields(ext: Map3dView["ext"], src: MapSource, idx: number[]): Partial<MapFigureSpec> {
  const picked = readVecColumn(ext);
  const textName = readVecText(ext);
  const cells = textName !== null ? textColumnCells(src.data, textName) : null;
  if (picked === null && cells === null) return {};
  const rows = src.data.values;
  const label = textName ?? src.data.labels[picked as number] ?? "";
  if (cells) {
    const g = idx.map((i) => String(cells[i] ?? "").trim());
    const names = [...new Set(g.filter((v) => v !== ""))].sort().slice(0, 1001);
    return { vec_group: g.map((v) => { const k = names.indexOf(v); return k < 0 ? null : k; }), vec_group_names: names, vec_group_label: label };
  }
  // `mapColumns` puts the file's first column in front unless the map is a parser 2-D map: level tables stay keyed by the file's channels.
  const levels = categoricalLevels(src.data, (picked as number) - (src.data.metadata["is2D"] === true ? 0 : 1));
  const val = (i: number): number | null => (Number.isFinite(rows[i][picked as number]) ? rows[i][picked as number] : null);
  if (levels) return { vec_group: idx.map((i) => { const v = val(i); return v !== null && Number.isInteger(v) ? v : null; }), vec_group_names: levels, vec_group_label: label };
  return { vec_cval: idx.map(val), vec_cval_label: label };
}
