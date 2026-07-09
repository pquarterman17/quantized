// Origin column metadata, aligned to value-channel index (WORKSHEET_PLAN item
// 1 / key decision 3: "one shared column-metadata reader"). `io/origin_project/
// opj.py` decodes each worksheet column's Origin short name
// (`metadata.origin_column_names`, in `.values` channel order), its
// designation (X/Y/Y-error/X-error/Label/Disregard, keyed by short name in
// `metadata.column_designations`), and any user comment
// (`metadata.column_comments`). This module aligns those three maps ONCE per
// dataset so every consumer reads the SAME alignment and can never drift
// apart:
//  - the worksheet header display (designation badge + comment line, item 4)
//  - error-bar pairing + hidden-channel defaults (lib/errorbars, refactored to
//    read through this instead of re-deriving the alignment privately)
//  - the future selection→plot mapping (item 7)
//
// Null-safe: a non-Origin dataset (no `origin_column_names`) yields an empty
// list, and every reader falls back to its pre-Origin behaviour.

import type { DataStruct } from "./types";

/** Origin's own designation for a worksheet column. */
export type OriginDesignation = "X" | "Y" | "Y-error" | "X-error" | "Label" | "Disregard";

const DESIGNATIONS: ReadonlySet<string> = new Set<OriginDesignation>([
  "X",
  "Y",
  "Y-error",
  "X-error",
  "Label",
  "Disregard",
]);

export interface ColumnMeta {
  /** The Origin short column name ("A", "B", "R++", …) — NOT the worksheet's
   *  formula-engine channel letter (lib/formula.channelLetter), which numbers
   *  value channels independently and can disagree with Origin's own naming
   *  once an early column has been consumed as the X axis. */
  shortName: string;
  /** Undefined when the book carries no designation for this column, or the
   *  value isn't one of Origin's known designations (defensive). */
  designation?: OriginDesignation;
  /** User-entered Origin column comment, when non-empty. */
  comment?: string;
}

/** Per-value-column metadata, aligned 1:1 to `ds.values` channel index (the
 *  same order as `ds.labels`/`ds.units`). Empty for non-Origin data. A
 *  worksheet computed (formula) column has no entry — those columns are
 *  appended past what `origin_column_names` covers, so callers indexing this
 *  array by channel simply get `undefined` for them, same as plain data. */
export function columnMetaList(ds: DataStruct): (ColumnMeta | undefined)[] {
  const meta = ds.metadata ?? {};
  const names = meta["origin_column_names"];
  if (!Array.isArray(names)) return [];

  const desigRaw = meta["column_designations"];
  const desig: Record<string, unknown> =
    typeof desigRaw === "object" && desigRaw !== null ? (desigRaw as Record<string, unknown>) : {};
  const commentRaw = meta["column_comments"];
  const comments: Record<string, unknown> =
    typeof commentRaw === "object" && commentRaw !== null ? (commentRaw as Record<string, unknown>) : {};

  return names.map((raw) => {
    const shortName = String(raw);
    const d = desig[shortName];
    const c = comments[shortName];
    return {
      shortName,
      designation: typeof d === "string" && DESIGNATIONS.has(d) ? (d as OriginDesignation) : undefined,
      comment: typeof c === "string" && c !== "" ? c : undefined,
    };
  });
}

/** Metadata for one value-channel index, or undefined when there's none
 *  (non-Origin dataset, a negative index, or `col` past the decoded Origin
 *  columns — e.g. a worksheet computed column). */
export function columnMetaAt(ds: DataStruct, col: number): ColumnMeta | undefined {
  if (col < 0) return undefined;
  return columnMetaList(ds)[col];
}

/** Short, uppercase badge text for a header role line (WORKSHEET_PLAN item 4):
 *  X · Y · yEr · xEr · Label · Disregard. */
export const DESIGNATION_BADGE: Record<OriginDesignation, string> = {
  X: "X",
  Y: "Y",
  "Y-error": "yEr",
  "X-error": "xEr",
  Label: "Label",
  Disregard: "Disregard",
};
