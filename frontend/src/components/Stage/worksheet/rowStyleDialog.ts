// "Color or mark by column…", "Row legend" and "Clear row colors/markers" (G24):
// the worksheet's entry points for per-row colours and markers shared by every
// graph of the dataset. The dialog asks; `store/rowStyleActions.ts` applies (one
// undo step); `lib/rowStyleBuild.ts` owns the mapping. Display only.

import { COLORMAPS, type ColormapName } from "../../../lib/colormap";
import { isCategoricalChannel } from "../../../lib/categorical";
import type { RowStyle } from "../../../lib/rowStyle";
import { MAX_ROW_STYLE_LEVELS } from "../../../lib/rowStyleBuild";
import type { Dataset } from "../../../lib/types";
import { applyRowStyleByColumn, clearRowStyle } from "../../../store/rowStyleActions";
import { askParams } from "../../overlays/ParamDialog";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

const APPLY = ["Color", "Marker", "Color and marker"] as const;
const MODES = ["Levels (one per distinct value)", "Gradient (numeric range)"] as const;

/** The row legend as plain lines: level -> colour slot / marker, or the gradient. */
export function rowLegendLines(rs: RowStyle | undefined): string[] {
  const lg = rs?.legend;
  if (!lg) return [];
  if (lg.kind === "gradient") return [`${lg.column}: ${lg.lo} to ${lg.hi} (${lg.colormap ?? "viridis"})`];
  return [
    `${lg.column}:`,
    ...lg.entries.map((e) => `  ${e.label}  ${[e.color && `color ${e.color.slice(1)}`, e.marker].filter(Boolean).join(", ")}`),
  ];
}

/** Ask how to color / mark the rows by column `col` and apply it. */
export async function colorMarkByColumnDialog(ds: Dataset, col: number | string): Promise<void> {
  const name = typeof col === "string" ? col : ds.data.labels[col];
  const p = await askParams(
    `Color or mark rows by "${name}"`,
    [
      { key: "apply", label: "Set", type: "select", options: [...APPLY], default: APPLY[0] },
      { key: "mode", label: "Map", type: "select", options: [...MODES], default: typeof col === "number" && !isCategoricalChannel(ds.data, col) ? MODES[1] : MODES[0] },
      { key: "map", label: "Gradient colormap", type: "select", options: Object.keys(COLORMAPS), default: "viridis" },
    ],
    {
      confirmLabel: "Apply",
      message: `Every graph of this dataset can draw these colors and markers ("Use row states" in its series style). Levels take the theme's series colors in order (more than ${MAX_ROW_STYLE_LEVELS} levels is refused); a gradient colors numeric values. Undo restores the previous states.`,
    },
  );
  if (!p) return;
  const gradient = p.mode === MODES[1];
  applyRowStyleByColumn(ds.id, {
    column: col,
    mode: gradient ? "gradient" : "levels",
    color: gradient || p.apply !== "Marker",
    marker: !gradient && p.apply !== "Color",
    colormap: String(p.map) as ColormapName,
  });
}

/** The worksheet column menu entries for row states (a real value column only). */
export function rowStyleItems(ds: Dataset, col: number | string): ContextMenuItem[] {
  if (typeof col === "number" && (col < 0 || col >= ds.data.labels.length)) return [];
  const has = !!ds.rowStyle;
  return [
    { separator: true },
    { label: "Color or mark by column…", title: "Give every row a color and/or marker from this column, shared by every graph (display only)", run: () => void colorMarkByColumnDialog(ds, col) },
    { label: "Row legend…", disabled: !ds.rowStyle?.legend, title: ds.rowStyle?.legend ? undefined : "no row colors or markers", run: () => void askParams("Row legend", [], { confirmLabel: "Close", message: rowLegendLines(ds.rowStyle).join("\n") }) },
    { label: "Clear row colors/markers", disabled: !has, title: has ? undefined : "no row colors or markers", run: () => clearRowStyle(ds.id) },
  ];
}
