// Worksheet ▸ Row statistics and Frequency count (worksheet audit #19) — the
// lazy command bodies (commands/dataCommands.ts imports this on run, so the
// dialogs' logic stays out of the eager bundle).
//
//   Row statistics: mean / SD / min / max / sum / N ACROSS the chosen columns,
//   per row, appended as computed columns (`rowmean(A, B, C)` …, the formula
//   language's row functions — so they recompute when the inputs change), in
//   ONE undo step.
//   Frequency count: bins one column of the ANALYSIS rows (exclusions and the
//   row filter applied, like the stats footer) into a NEW worksheet in the same
//   book — bin start/end, count, cumulative count, percent, cumulative percent
//   (lib/frequencyCount.ts states the binning rules).

import { LINKED_GRAPH_EDIT_NOTICE } from "../lib/rederived";
import { askParams } from "./paramDialog";
import { loadFormulaExtension } from "../lib/formulaExt";
import { baseColumns, channelLetter } from "../lib/formula";
import { frequencyTable, frequencyWorksheet } from "../lib/frequencyCount";
import { lit } from "../lib/macro";
import { analysisData } from "../lib/rowstate";
import type { ComputedColumn, Dataset } from "../lib/types";
import { uniqueTemplateName } from "../lib/uniqueName";
import { withRecomputedFormulas } from "./computedColumns";
import { nextDatasetId } from "./idSeq";
import { toast } from "./toasts";
import { useApp } from "./useApp";

const ROW_STATS = [
  { key: "mean", fn: "rowmean", name: "Row mean", on: true },
  { key: "sd", fn: "rowsd", name: "Row SD", on: true },
  { key: "min", fn: "rowmin", name: "Row min", on: false },
  { key: "max", fn: "rowmax", name: "Row max", on: false },
  { key: "sum", fn: "rowsum", name: "Row sum", on: false },
  { key: "n", fn: "rown", name: "Row N", on: true },
] as const;

/** The numeric value columns a statistic can read: not categorical, not a
 *  bound error column. */
function numericColumns(ds: Dataset): number[] {
  const errors = new Set((ds.errorRoles ?? []).map((b) => b.channel));
  const cat = ds.data.cat_levels ?? {};
  return ds.data.labels.flatMap((_, i) => (errors.has(i) || i in cat ? [] : [i]));
}

function fail(message: string): void {
  useApp.getState().setStatus(message);
  toast(message, "danger");
}

/** The ticked column fields' channel indices (key `col:<index>`), or why
 *  there are not enough of them. */
export function pickedColumns(picked: Record<string, unknown>, ds: Dataset): number[] | string {
  const out = numericColumns(ds).filter((c) => picked[`col:${c}`] === true);
  return out.length >= 2 ? out : "tick at least two columns for row statistics";
}

/** The column picker: one checkbox per numeric column, named by its letter,
 *  label and unit ("A: Signal (mV)") — keyboard reachable, each name unique.
 *  Typed letters (the first version) made the user look up each letter. */
function columnFields(ds: Dataset) {
  const base = ds.data.labels.length - (ds.formulas?.length ?? 0);
  return numericColumns(ds).map((c) => {
    const unit = ds.data.units[c] ? ` (${ds.data.units[c]})` : "";
    return { key: `col:${c}`, label: `${channelLetter(c)}: ${ds.data.labels[c] || `column ${c + 1}`}${unit}`, type: "boolean" as const, default: c < base };
  });
}

/** The computed columns Row statistics adds, for `cols` and `stats` keys. */
export function rowStatisticColumns(ds: Dataset, cols: number[], stats: readonly string[]): ComputedColumn[] {
  const letters = cols.map(channelLetter);
  const units = new Set(cols.map((c) => ds.data.units[c] ?? ""));
  const unit = units.size === 1 ? [...units][0] : "";
  const taken = new Set(ds.data.labels);
  return ROW_STATS.filter((s) => stats.includes(s.key)).map((s) => {
    const name = uniqueTemplateName(s.name, taken);
    taken.add(name);
    const expr = `${s.fn}(${letters.join(", ")})`;
    return { name, expr, deps: letters, ...(s.key !== "n" && unit ? { unit } : {}) };
  });
}

export async function runRowStatistics(): Promise<void> {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds) return fail("Row statistics: select a worksheet first");
  if (ds.linkedCurves) return fail(LINKED_GRAPH_EDIT_NOTICE);
  if (ds.pending) return fail("Row statistics: wait for the full worksheet to load");
  if (numericColumns(ds).length < 2) return fail("Row statistics: the worksheet needs at least two numeric value columns");
  const picked = await askParams("Row statistics", [
    ...columnFields(ds),
    ...ROW_STATS.map((r) => ({ key: r.key, label: r.name, type: "boolean" as const, default: r.on })),
  ], {
    message:
      "Tick the columns to combine (categorical and error columns are not offered), then the statistics. Adds one computed column per statistic, row by row. Blank cells are skipped.",
    confirmLabel: "Add columns",
  });
  if (!picked) return;
  const cols = pickedColumns(picked, ds);
  if (typeof cols === "string") return fail(`Row statistics: ${cols}`);
  const stats = ROW_STATS.filter((r) => picked[r.key] === true).map((r) => r.key);
  if (!stats.length) return fail("Row statistics: tick at least one statistic");
  const added = rowStatisticColumns(ds, cols, stats);
  await loadFormulaExtension(); // rowmean() & co. live in the lazy formula module
  const get = useApp.getState;
  get().recordHistory("add row statistics");
  useApp.setState((st) => ({
    datasets: st.datasets.map((d) => {
      if (d.id !== ds.id) return d;
      const formulas = [...(d.formulas ?? []), ...added];
      return { ...d, formulas, ...withRecomputedFormulas(baseColumns(d.data, d.formulas?.length ?? 0), formulas) };
    }),
  }));
  for (const c of added) {
    get().recordMacro(`Add column ${c.name}`, `qz.addColumn(${lit(c.name)}, ${lit(c.expr)})`, { kind: "expression", params: { name: c.name, expr: c.expr } });
  }
  get().touchDataset(ds.id);
  // Columns in different units are combined as plain numbers — allowed, as
  // in Origin, but never silently (re-audit #18): the statistics carry no
  // unit, and the message says which units were mixed.
  const units = [...new Set(cols.map((c) => ds.data.units[c] ?? ""))];
  const mixed =
    units.length > 1
      ? ` — warning: these columns have different units (${cols.map((c) => `${channelLetter(c)} ${ds.data.units[c] || "no unit"}`).join(", ")}), so the statistics mix them and carry no unit`
      : "";
  const message = `added ${added.map((c) => `"${c.name}"`).join(", ")} across ${cols.map(channelLetter).join(", ")}${mixed}`;
  get().setStatus(message);
  toast(message, mixed ? "info" : "ok");
}

const optionalNumber = (raw: unknown, what: string): number | undefined | string => {
  const text = String(raw ?? "").trim();
  if (!text) return undefined;
  const v = Number(text);
  return Number.isFinite(v) ? v : `${what} must be a number (got "${text}")`;
};

export async function runFrequencyCount(): Promise<void> {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds) return fail("Frequency count: select a worksheet first");
  if (ds.pending) return fail("Frequency count: wait for the full worksheet to load");
  const xName = typeof ds.data.metadata.x_column_name === "string" && ds.data.metadata.x_column_name ? ds.data.metadata.x_column_name : "X";
  const options = [`x: ${xName}`, ...numericColumns(ds).map((c) => `${channelLetter(c)}: ${ds.data.labels[c]}`)];
  const picked = await askParams("Frequency count", [
    { key: "column", label: "Column", type: "select", default: options[1] ?? options[0], options },
    { key: "bins", label: "Number of bins (blank = automatic)", type: "text", default: "" },
    { key: "width", label: "Bin width (blank = from the number of bins)", type: "text", default: "" },
    { key: "min", label: "Range start (blank = data minimum)", type: "text", default: "" },
    { key: "max", label: "Range end (blank = data maximum)", type: "text", default: "" },
  ], {
    message: "Creates a new worksheet: bin start and end, count, cumulative count, percent and cumulative percent. Excluded and filtered rows are not counted.",
    confirmLabel: "Create worksheet",
  });
  if (!picked) return;
  const choice = options.indexOf(String(picked.column));
  const channel = choice <= 0 ? -1 : numericColumns(ds)[choice - 1];
  const parsed = { bins: optionalNumber(picked.bins, "the number of bins"), width: optionalNumber(picked.width, "the bin width"), min: optionalNumber(picked.min, "the range start"), max: optionalNumber(picked.max, "the range end") };
  const bad = Object.values(parsed).find((v) => typeof v === "string");
  if (typeof bad === "string") return fail(`Frequency count: ${bad}`);
  const rows = analysisData(ds) ?? ds.data;
  const values = channel < 0 ? rows.time : rows.values.map((r) => r[channel]);
  const label = channel < 0 ? xName : ds.data.labels[channel];
  const unit = channel < 0 ? String(ds.data.metadata.x_column_unit ?? ds.data.metadata.xUnit ?? "") : (ds.data.units[channel] ?? "");
  let data;
  try {
    data = frequencyWorksheet(frequencyTable(values, parsed as { bins?: number; width?: number; min?: number; max?: number }), label, unit, ds.name);
  } catch (e) {
    return fail(`Frequency count: ${e instanceof Error ? e.message : "failed"}`);
  }
  const id = nextDatasetId();
  const name = `${ds.name} — frequency of ${label}`;
  s.addDataset({ id, name, data, ...(ds.workbookId ? { workbookId: ds.workbookId } : {}), ...(ds.folderId ? { folderId: ds.folderId } : {}) });
  s.setActive(id);
  const message = `created "${name}" — ${data.time.length} bins`;
  s.setStatus(message);
  toast(message, "ok");
}
