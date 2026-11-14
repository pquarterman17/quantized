// The worksheet's small parameter dialogs — Sort Worksheet (up to three
// keys), the column display format, and Set Column Values on an existing
// formula column (Origin reopens the dialog with the CURRENT formula; this
// used to be impossible: `updateFormula` had no UI). Each one asks through
// the shared ParamDialog and applies through the store, one undo step.

import { channelLetter } from "../../../lib/formula";
import { NUMBER_FORMAT_KINDS, NUMBER_FORMAT_LABELS, type NumberFormat } from "../../../lib/columnProps";
import type { TextColumn } from "../../../lib/originTextColumns";
import type { Dataset } from "../../../lib/types";
import { sortWorksheetRowsBy, type SortSpec } from "../../../store/sortRows";
import { editColumnFormula, setColumnFormat } from "../../../store/worksheetColumns";
import { askParams } from "../../overlays/ParamDialog";

const NONE = "(none)";
const DIRS = ["Ascending", "Descending"];

/** Sort Worksheet: pick up to three keys, each ascending or descending. */
export async function sortWorksheetDialog(ds: Dataset, xName: string, textCols: readonly TextColumn[]): Promise<void> {
  const keys: { label: string; col: SortSpec["col"] }[] = [
    { label: `X — ${xName}`, col: -1 },
    ...ds.data.labels.map((l, c) => ({ label: `${channelLetter(c)} — ${l}`, col: c })),
    ...textCols.map((t) => ({ label: `text — ${t.longName ?? t.shortName}`, col: t.shortName })),
  ];
  const options = keys.map((k) => k.label);
  const p = await askParams(
    "Sort worksheet",
    [
      { key: "k1", label: "Sort by", type: "select", options, default: options[0] },
      { key: "d1", label: "Order", type: "select", options: DIRS, default: DIRS[0] },
      { key: "k2", label: "Then by", type: "select", options: [NONE, ...options], default: NONE },
      { key: "d2", label: "Then order", type: "select", options: DIRS, default: DIRS[0] },
      { key: "k3", label: "Then by (third key)", type: "select", options: [NONE, ...options], default: NONE },
      { key: "d3", label: "Third key order", type: "select", options: DIRS, default: DIRS[0] },
    ],
    { confirmLabel: "Sort", message: "Every row moves, all columns together; blanks go last. Undo restores the order." },
  );
  if (!p) return;
  const specs: SortSpec[] = [];
  for (const i of [1, 2, 3]) {
    const key = keys.find((k) => k.label === p[`k${i}`]);
    if (key && !specs.some((s) => s.col === key.col)) specs.push({ col: key.col, dir: p[`d${i}`] === DIRS[1] ? -1 : 1 });
  }
  sortWorksheetRowsBy(ds.id, specs);
}

/** The display format of `cols` (Auto clears it). */
export async function numberFormatDialog(ds: Dataset, cols: readonly number[]): Promise<void> {
  const current = ds.columnProps?.[cols[0]]?.format;
  const kinds = ["auto", ...NUMBER_FORMAT_KINDS] as const;
  const options = kinds.map((k) => NUMBER_FORMAT_LABELS[k]);
  const p = await askParams(
    cols.length > 1 ? `Number format — ${cols.length} columns` : "Number format",
    [
      { key: "kind", label: "Display", type: "select", options, default: NUMBER_FORMAT_LABELS[current?.kind ?? "auto"] },
      { key: "digits", label: "Digits", type: "number", default: current?.digits ?? 3, hint: "decimal places, or significant digits" },
    ],
    { confirmLabel: "Apply", message: "Display only — the stored numbers, copies, exports and plots keep full precision." },
  );
  if (!p) return;
  const kind = kinds[Math.max(0, options.indexOf(String(p.kind)))];
  const format: NumberFormat | null = kind === "auto" ? null : { kind, digits: Number(p.digits) };
  setColumnFormat(ds.id, cols, format);
}

/** Set Column Values on computed column `col`, reopened with its formula. */
export async function setColumnValuesDialog(ds: Dataset, col: number): Promise<void> {
  const base = ds.data.labels.length - (ds.formulas?.length ?? 0);
  const index = col - base;
  const f = ds.formulas?.[index];
  if (!f) return;
  const p = await askParams(
    `Set Column Values — ${f.name}`,
    [
      { key: "name", label: "Column name", type: "text", default: f.name },
      { key: "expr", label: "Formula", type: "text", default: f.expr },
    ],
    { confirmLabel: "Apply", message: `Column ${channelLetter(col)} = the formula, recalculated whenever its inputs change.` },
  );
  const expr = p ? String(p.expr).trim() : "";
  if (!p || !expr) return;
  editColumnFormula(ds.id, col, String(p.name), expr);
}
