// Columns are stored in a preset by LABEL (contract P5), because indices mean
// something only on one sheet. This is the one place a list of labels is turned
// back into this sheet's column indices, so every workshop that stores a list
// of columns (Multivariate, Tabulate) skips and names a missing one the same way.
// Lazy: imported only from workshop preset adapters.

export interface LabeledColumn {
  index: number;
  label: string;
}

/** The labels of `indices`, in order (an index not on the sheet is dropped). */
export function labelsOf(indices: readonly number[], columns: readonly LabeledColumn[]): string[] {
  const out: string[] = [];
  for (const i of indices) {
    const col = columns.find((c) => c.index === i);
    if (col) out.push(col.label);
  }
  return out;
}

/** This sheet's indices for `wanted` labels (first match, no repeats), and
 *  the labels it does not have, each named as the user knows it. */
export function resolveLabels(wanted: readonly string[], columns: readonly LabeledColumn[]): { indices: number[]; missing: string[] } {
  const indices: number[] = [];
  const missing: string[] = [];
  for (const label of wanted) {
    const col = columns.find((c) => c.label === label);
    if (!col) {
      if (!missing.includes(label)) missing.push(label);
    } else if (!indices.includes(col.index)) indices.push(col.index);
  }
  return { indices, missing };
}

/** One skipped entry per missing label, under the user-facing name of the field. */
export const skippedColumns = (field: string, missing: readonly string[]): { field: string; reason: string }[] =>
  missing.map((label) => ({ field, reason: `column '${label}' is not on this sheet` }));

/** A check for a settings field holding a list of distinct, non-empty labels. */
export const checkLabelList = (min: number, max: number) => (v: unknown): string | null => {
  if (!Array.isArray(v)) return "must be a list of column labels";
  if (v.length < min || v.length > max) return `must hold ${min === max ? min : `${min} to ${max}`} column${max === 1 ? "" : "s"}`;
  if (!v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200)) return "must be a list of column labels";
  if (new Set(v).size !== v.length) return "must not repeat a column";
  return null;
};
