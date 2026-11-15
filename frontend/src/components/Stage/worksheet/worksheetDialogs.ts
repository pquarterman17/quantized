// The worksheet's small parameter dialogs — Sort Worksheet (up to three
// keys), the column display format, Fill Column With and Set Row Count (gap
// audit 4, G12). Each one asks through the shared ParamDialog and applies
// through the store, one undo step. Set Column Values has its own dialog
// (./SetColumnValuesDialog.tsx).

import { channelLetter } from "../../../lib/formula";
import { NUMBER_FORMAT_KINDS, NUMBER_FORMAT_LABELS, type NumberFormat } from "../../../lib/columnProps";
import type { TextColumn } from "../../../lib/originTextColumns";
import type { Dataset } from "../../../lib/types";
import { sortWorksheetRowsBy, type SortSpec } from "../../../store/sortRows";
import type { FillSpec } from "../../../lib/fillSeries";
import { sidecarRowCount } from "../../../lib/rowSidecars";
import { setColumnFormat } from "../../../store/worksheetColumns";
import { fillColumns, setRowCount } from "../../../store/worksheetFill";
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

/** Fill Column With (G12): a linear sequence or random numbers, asked for;
 *  row numbers need nothing and fill at once. */
export async function fillColumnsDialog(ds: Dataset, cols: readonly number[], kind: FillSpec["kind"]): Promise<void> {
  if (kind === "rownum") return fillColumns(ds.id, cols, { kind });
  const seed = { key: "seed", label: "Seed", type: "number", default: 1, hint: "the same seed gives the same numbers (numpy RandomState)" } as const;
  const fields =
    kind === "linear"
      ? [{ key: "a", label: "Start", type: "number", default: 1 }, { key: "b", label: "Step", type: "number", default: 1 }] as const
      : kind === "uniform"
        ? [{ key: "a", label: "From (low)", type: "number", default: 0 }, { key: "b", label: "To (high)", type: "number", default: 1 }, seed] as const
        : [{ key: "a", label: "Mean", type: "number", default: 0 }, { key: "b", label: "SD", type: "number", default: 1 }, seed] as const;
  const title = { linear: "Fill with a linear sequence", uniform: "Fill with uniform random numbers", normal: "Fill with normal random numbers" }[kind];
  const p = await askParams(title, [...fields], { confirmLabel: "Fill", message: "Every row of the selected column(s); one undo step." });
  if (!p) return;
  const [a, b, s] = [Number(p.a), Number(p.b), Number(p.seed)];
  const spec: FillSpec = kind === "linear" ? { kind, start: a, step: b } : kind === "uniform" ? { kind, seed: s, low: a, high: b } : { kind, seed: s, mean: a, sd: b };
  fillColumns(ds.id, cols, spec);
}

/** Set Row Count (G12). */
export async function setRowCountDialog(ds: Dataset): Promise<void> {
  const now = sidecarRowCount(ds.data.metadata, ds.data.time.length);
  const p = await askParams(
    "Set row count",
    [{ key: "rows", label: "Rows", type: "number", default: now, hint: `now ${now}` }],
    { confirmLabel: "Set", message: "More rows are added blank at the end; fewer cuts the rows past the count, in every column. Undo restores them." },
  );
  if (p) setRowCount(ds.id, Number(p.rows));
}
