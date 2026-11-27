// "How this was imported": the decisions an import made that a reader of the
// first plot cannot see, gathered from what the dataset already holds. Until
// now they were a transient toast (store/importNotes.ts) plus a row buried in
// the collapsed Metadata card; this is the durable, readable form.
//
// Derived, never stored: the parser's own notes (`metadata.notes`, written once
// at import), the axis name the reader gave the X column, the text columns held
// as categorical channels, and the error-column bindings. Roles that the user
// has edited since (Error columns card, column designations) show as they stand
// now, which is what the plot is built from; the parser notes stay as written.
// No persisted field, so nothing for workspaceForwardCompat to classify.

import type { Dataset } from "./types";

export interface ImportExplanation {
  /** One short sentence per decision, in reading order. */
  lines: string[];
  /** The reader's own notes, verbatim (dropped rows, header guesses, skipped sheets). */
  notes: string[];
}

/** The axis name the parsers give a synthesized 1..N row index. */
export const ROW_INDEX_AXIS = "Sample Index";

export function importExplanation(dataset: Dataset): ImportExplanation | null {
  const { data } = dataset;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  if (meta.x_column_name === ROW_INDEX_AXIS) {
    lines.push("The X axis is a 1..N row index: the file has no usable X column, so rows are plotted in file order.");
  }
  const categorical = Object.keys(data.cat_levels ?? {}).map(Number).filter((c) => Number.isInteger(c) && c >= 0 && c < data.labels.length);
  if (categorical.length) {
    const named = categorical.map((c) => {
      const n = data.cat_levels?.[c]?.length ?? 0;
      return `${data.labels[c]} (${n} level${n === 1 ? "" : "s"})`;
    });
    lines.push(`Read as categories: ${named.join(", ")}. They group and label rows; they are not plotted as numbers.`);
  }
  for (const b of dataset.errorRoles ?? []) {
    const err = data.labels[b.channel];
    const target = b.target < 0 ? "X" : data.labels[b.target];
    if (err === undefined || target === undefined) continue;
    const side = b.side === "both" ? "±" : b.side === "+" ? "+" : "−";
    lines.push(`${err} is the ${side} error of ${target}${b.origin ? " (set by an Origin figure)" : ""}.`);
  }
  const rawNotes = meta.notes;
  const notes = Array.isArray(rawNotes) ? rawNotes.filter((n): n is string => typeof n === "string" && n.length > 0) : [];
  return lines.length || notes.length ? { lines, notes } : null;
}
