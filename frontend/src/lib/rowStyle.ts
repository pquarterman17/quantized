// Persistent ROW STATES: a colour and a marker per row of a dataset, shared by
// every graph of that dataset (JMP's Color / Mark by Column and its row legend,
// GAP_AUDIT_9 G24). Stored on the Dataset as `rowStyle`, beside `excludedRows`;
// the eager half (this file) is only the model, its row remap and its
// validators. Building a style from a column is `lib/rowStyleBuild.ts`, drawing
// it is `lib/rowStyleSpecs.ts` and `calc/figure_row_states.py`; all lazy.
//
// A cell is a STRING per row, "" = no state. A colour is a theme slot `s1`..`s8`
// (resolved through `--series-N` at draw time, so a theme or palette switch
// follows) or a literal `#rrggbb` (a gradient's fixed hex). A marker is a
// `MarkerShape`. The arrays are dense and aligned to `data.time`; one whose
// length does not match the row count is STALE (a row operation this module
// does not remap, e.g. a split or a re-import) and `usableRowStyle` ignores it:
// fail closed, never a colour on the wrong measurement. Sort, move, insert and
// delete rows remap it through `sliceRowStyle` (store/sortRows.ts,
// store/cellEditRun.ts), the same index list `sliceRowSidecars` takes.

import { MARKER_SHAPE_VALUES } from "./seriesStyleCycle";
import type { Dataset } from "./types";

/** One level of the legend: the label and what it was given. */
export interface RowStyleLegendEntry {
  label: string;
  color?: string;
  marker?: string;
}

/** The level -> colour / marker mapping kept with the dataset (the row legend).
 *  A gradient legend carries its range and colormap instead of entries. */
export interface RowStyleLegend {
  column: string;
  kind: "levels" | "gradient";
  entries: RowStyleLegendEntry[];
  lo?: number;
  hi?: number;
  colormap?: string;
}

export interface RowStyle {
  color?: string[];
  marker?: string[];
  legend?: RowStyleLegend;
}

const SLOT = /^s[1-8]$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** `rowStyle` when its arrays still stand one-for-one against the rows, else
 *  undefined. The one read path for drawing and export. */
export function usableRowStyle(ds: Pick<Dataset, "rowStyle" | "data"> | null | undefined): RowStyle | undefined {
  const rs = ds?.rowStyle;
  if (!rs || !ds) return undefined;
  const n = ds.data.time.length;
  const color = rs.color?.length === n ? rs.color : undefined;
  const marker = rs.marker?.length === n ? rs.marker : undefined;
  return color || marker ? { ...rs, color, marker } : undefined;
}

/** The row-state patch for a row operation: new row i = old row `rowIndexes[i]`
 *  (an index outside the old rows, e.g. an inserted blank, reads "no state"),
 *  for the first `n` new rows (the new `time.length`: `rowIndexes` can run past
 *  it over text-only rows, and an array longer than the rows would read stale).
 *  `{}` when the dataset carries none; `{rowStyle: undefined}` when nothing
 *  survives, so an emptied style does not linger. */
export function sliceRowStyle(
  ds: Pick<Dataset, "rowStyle">,
  rowIndexes: readonly number[],
  n: number,
): Pick<Dataset, "rowStyle"> | Record<string, never> {
  const rs = ds.rowStyle;
  if (!rs) return {};
  const cut = (a?: string[]): string[] | undefined => {
    const out = a && rowIndexes.slice(0, n).map((r) => a[r] ?? "");
    return out?.some(Boolean) ? out : undefined;
  };
  const color = cut(rs.color);
  const marker = cut(rs.marker);
  return { rowStyle: color || marker ? { ...rs, color, marker } : undefined };
}

/** Validate a stored `rowStyle` (a .dwk is hand-editable) against `n` rows:
 *  known slots / hex and marker shapes only, a wrong-length array dropped. */
export function sanitizeRowStyle(raw: unknown, n: number): RowStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const cells = (v: unknown, ok: (s: string) => boolean): string[] | undefined =>
    Array.isArray(v) && v.length === n && v.some((s) => typeof s === "string" && s !== "")
      ? v.map((s) => (typeof s === "string" && ok(s) ? s : ""))
      : undefined;
  const color = cells(r.color, (s) => SLOT.test(s) || HEX.test(s));
  const marker = cells(r.marker, (s) => MARKER_SHAPE_VALUES.has(s));
  if (!color && !marker) return undefined;
  const lg = r.legend as Partial<RowStyleLegend> | undefined;
  const legend = lg && typeof lg.column === "string" && Array.isArray(lg.entries) && (lg.kind === "levels" || lg.kind === "gradient")
    ? { ...(lg as RowStyleLegend), entries: lg.entries.filter((e) => e && typeof e.label === "string") }
    : undefined;
  return { color, marker, ...(legend ? { legend } : {}) };
}
