// The 3-D SCATTER extras' options and the request fields they make (lazy chunk).
//
// Stored on the 3-D view as plain values (`Map3dView.ext`: `scColor`, `scSize`,
// `scGroup`, `scErrX/Y/Z` are column picks among `mapColumns(ds)`; `wallXY`,
// `wallXZ`, `wallYZ` are flags) and READ here, so a hand-edited `.dwk` cannot send
// what the route refuses. With a column picked the points are the source
// rows (finite x, y, z -- and a positive z under a log scale -- and every picked
// colour / size / group value), sampled to the cap; each extra column rides
// along, one value per sent row. The footnote says what was sampled, left out,
// or sized by, and the screen's caption is the same text.

import type { MapFigureSpec } from "../../lib/api/mapFigure";
import type { Map3dView } from "../../lib/mapView3d";
import { textColumnCells } from "../../lib/originTextColumnCells";
import { fmt } from "./mapColorbar";
import { MAP3D_MAX_POINTS, sampleEvenly, type MapSource } from "./map3dRequest";

const col = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export interface ScatterOptions {
  color: number | null;
  size: number | null;
  group: number | null;
  /** A text (categorical) column, by name, to group by; `group` wins when both are stored. */
  groupText: string | null;
  err: [number | null, number | null, number | null];
  walls: [boolean, boolean, boolean];
}

export function readScatter(e: Map3dView["ext"]): ScatterOptions {
  const x = e ?? {};
  return {
    color: col(x.scColor), size: col(x.scSize), group: col(x.scGroup),
    groupText: col(x.scGroup) === null && typeof x.scGroupText === "string" && x.scGroupText !== "" ? x.scGroupText : null,
    err: [col(x.scErrX), col(x.scErrY), col(x.scErrZ)],
    walls: [x.wallXY === true, x.wallXZ === true, x.wallYZ === true],
  };
}

const n = (v: number): string => v.toLocaleString("en-US");
const name = (v: number): string => String(Number(v.toPrecision(6)));

/** The request fields of a scatter view's extras (empty when none is on). */
export function scatterBody(v3: Map3dView, logZ: boolean, src: MapSource | undefined, base: { note?: string }): Partial<MapFigureSpec> {
  const o = readScatter(v3.ext);
  const walls = { ...(o.walls[0] ? { wall_xy: true } : {}), ...(o.walls[1] ? { wall_xz: true } : {}), ...(o.walls[2] ? { wall_yz: true } : {}) };
  // A text column that is gone (renamed, or a sampled preview) is no group: fail closed.
  const cells = o.groupText !== null && src ? textColumnCells(src.data, o.groupText) : null;
  const picked = [o.color, o.size, o.group, ...o.err].some((c) => c !== null) || cells !== null;
  if (!picked || !src) return walls;
  const [kx, ky, kz] = src.keys;
  const need = [o.color, o.size, o.group].filter((c): c is number => c !== null);
  const val = (r: number[], k: number | null): number | null => (k === null ? null : Number.isFinite(r[k]) ? r[k] : null);
  const text = (i: number): string => (cells ? String(cells[i] ?? "").trim() : "");
  // Source-row indexes: a text column's cell is read by the row it sits on.
  const rowIdx = src.data.values.flatMap((r, i) =>
    [kx, ky].every((k) => Number.isFinite(r[k])) && Number.isFinite(r[kz]) && (!logZ || r[kz] > 0) && need.every((k) => Number.isFinite(r[k])) && (!cells || text(i) !== "") ? [i] : [],
  );
  const keptIdx = rowIdx.length <= MAP3D_MAX_POINTS ? rowIdx : sampleEvenly(rowIdx, MAP3D_MAX_POINTS);
  const rows = rowIdx;
  const kept = keptIdx.map((i) => src.data.values[i]);
  const labels = src.data.labels;
  const out: Partial<MapFigureSpec> = {
    x_axis: kept.map((r) => r[kx]), y_axis: kept.map((r) => r[ky]),
    z_values: kept.map((r) => (logZ ? Math.log10(r[kz]) : r[kz])), contour_source: "points", ...walls,
  };
  const notes: string[] = [];
  if (kept.length < rows.length) notes.push(`Plotting ${n(kept.length)} of ${n(rows.length)} points, evenly sampled.`);
  const total = src.data.values.length;
  if (rows.length < total) notes.push(`${n(total - rows.length)} rows not drawn (a gap in x, y, z or a picked column${logZ ? ", or a non-positive z" : ""}).`);
  if (o.color !== null) {
    out.sc_color = kept.map((r) => r[o.color as number]);
    out.sc_color_label = labels[o.color] ?? "";
  }
  if (o.size !== null) {
    const s = kept.map((r) => r[o.size as number]);
    out.sc_size = s;
    notes.push(`Marker size: ${labels[o.size] ?? "size"}, ${fmt(Math.min(...s))} to ${fmt(Math.max(...s))}.`);
  }
  if (cells && o.groupText !== null) {
    const g = keptIdx.map(text);
    const names = [...new Set(g)].sort().slice(0, 1001);
    out.sc_group_names = names;
    out.sc_group = g.map((v) => { const i = names.indexOf(v); return i < 0 ? null : i; });
    out.sc_group_label = o.groupText;
  } else if (o.group !== null) {
    const g = kept.map((r) => r[o.group as number]);
    const names = [...new Set(g)].sort((a, b) => a - b).slice(0, 1001);
    out.sc_group_names = names.map(name);
    out.sc_group = g.map((v) => { const i = names.indexOf(v); return i < 0 ? null : i; });
    out.sc_group_label = labels[o.group] ?? "";
  }
  const errKeys = ["sc_err_x", "sc_err_y", "sc_err_z"] as const;
  let skipped = 0;
  o.err.forEach((k, i) => {
    if (k === null) return;
    if (i === 2 && logZ) {
      notes.push("Z error bars are not drawn on a log scale.");
      return;
    }
    const e = kept.map((r) => val(r, k));
    skipped += e.filter((v) => v === null || v < 0).length;
    out[errKeys[i]] = e;
  });
  if (skipped) notes.push(`${n(skipped)} error bars not drawn (a gap or a negative error).`);
  const note = [base.note ?? "", ...notes].filter(Boolean).join(" ");
  return { ...out, ...(note ? { note } : {}) };
}
