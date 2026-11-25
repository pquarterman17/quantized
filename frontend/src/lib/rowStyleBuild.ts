// "Color or mark by column": build a `RowStyle` (lib/rowStyle.ts) from one
// column of a dataset (G24). LAZY (loaded by the dialog and the store action).
//
// LEVELS: the column's distinct finite values in `categoryLevels` order (a
// user's level order holds); level k takes theme slot `s{k % 8 + 1}` and marker
// `AUTO_MARKER_CYCLE[k % 8]`, the SAME rule a Graph Builder Color / Symbol zone
// applies, so a level has one colour across every graph. A non-finite cell gets
// no state. More than MAX_LEVELS levels is REFUSED (fail closed: eight
// repeating colours over hundreds of levels read as a bug; use the gradient).
// GRADIENT: a numeric column over its full finite range through a named
// colormap as literal `#rrggbb` (a gradient is one fixed scale, not a theme
// slot); markers do not apply. Deterministic: a pure function of the column.
//
// Colour and marker are independent: `{color: false}` leaves existing colours
// alone (`mergeRowStyle`), so "colour by sample, mark by phase" is two
// runs.

import { categoryLevels, columnOf, groupLevelLabel } from "./categorical";
import { colormap, normalize, type ColormapName } from "./colormap";
import { encodingData } from "./plotEncodingScales";
import type { RowStyle, RowStyleLegend } from "./rowStyle";
import { AUTO_MARKER_CYCLE } from "./seriesStyleCycle";
import type { DataStruct } from "./types";

export const MAX_ROW_STYLE_LEVELS = 64;

export type RowStyleMode = "levels" | "gradient";
export interface RowStyleRequest {
  /** A value column's index, or a row-indexed TEXT column's name (Origin text
   *  columns / worksheet text cells: levels by first appearance, levels only). */
  column: number | string;
  mode: RowStyleMode;
  color: boolean;
  marker: boolean;
  colormap?: ColormapName;
}

export type RowStyleResult = { ok: true; style: RowStyle } | { ok: false; reason: string };

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

/** The slot token of level index `k` (`s1`..`s8`). */
export const levelSlot = (k: number): string => `s${(k % 8) + 1}`;

export function buildRowStyle(source: DataStruct, req: RowStyleRequest): RowStyleResult {
  if (!req.color && !req.marker) return { ok: false, reason: "Choose colour, marker or both." };
  // A text column is appended as a categorical channel, exactly as a Graph Builder factor is.
  const data = typeof req.column === "string" ? encodingData(source, { group: null, color: null, symbol: null, label: null, text: [req.column] }) : source;
  const column = typeof req.column === "string" ? source.labels.length : req.column;
  if (typeof req.column === "string" && req.mode === "gradient") return { ok: false, reason: "A text column has levels, not a gradient." };
  if (!Number.isInteger(column) || column < 0 || column >= data.labels.length) return { ok: false, reason: "No such column." };
  const name = data.labels[column];
  const cells = columnOf(data, column);
  if (req.mode === "gradient") {
    if (!req.color) return { ok: false, reason: "A gradient sets colours only." };
    const finite = cells.filter((v) => Number.isFinite(v));
    if (!finite.length) return { ok: false, reason: `"${name}" has no finite values.` };
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of finite) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const map = req.colormap ?? "viridis";
    const color = cells.map((v) => {
      const t = normalize(v, lo, hi, false);
      if (t == null) return "";
      const [r, g, b] = colormap(map, t);
      return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    });
    const legend: RowStyleLegend = { column: name, kind: "gradient", entries: [], lo, hi, colormap: map };
    return { ok: true, style: { color, legend } };
  }
  const levels = categoryLevels(data, column);
  if (!levels.length) return { ok: false, reason: `"${name}" has no finite values.` };
  if (levels.length > MAX_ROW_STYLE_LEVELS) {
    return { ok: false, reason: `"${name}" has ${levels.length} distinct levels (more than ${MAX_ROW_STYLE_LEVELS}); use the gradient for a numeric column.` };
  }
  const index = new Map(levels.map((v, k) => [v, k]));
  const at = (v: number): number | undefined => (Number.isFinite(v) ? index.get(v) : undefined);
  const color = req.color ? cells.map((v) => (at(v) === undefined ? "" : levelSlot(at(v) as number))) : undefined;
  const marker = req.marker ? cells.map((v) => (at(v) === undefined ? "" : AUTO_MARKER_CYCLE[(at(v) as number) % AUTO_MARKER_CYCLE.length])) : undefined;
  const entries = levels.map((v, k) => ({
    label: groupLevelLabel(data, column, v),
    ...(req.color ? { color: levelSlot(k) } : {}),
    ...(req.marker ? { marker: AUTO_MARKER_CYCLE[k % AUTO_MARKER_CYCLE.length] } : {}),
  }));
  return { ok: true, style: { color, marker, legend: { column: name, kind: "levels", entries } } };
}

/** `fresh` laid over `current` for the parts `fresh` carries: colour and marker
 *  are replaced independently ("colour by sample, mark by phase" is two runs).
 *  The legend describes the LATEST build only (provisional, owner to confirm). */
export function mergeRowStyle(current: RowStyle | undefined, fresh: RowStyle): RowStyle {
  return { color: fresh.color ?? current?.color, marker: fresh.marker ?? current?.marker, ...(fresh.legend ? { legend: fresh.legend } : {}) };
}
