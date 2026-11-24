// Fit Model: text (sidecar) columns as categorical factors. PROVISIONAL, owner
// to confirm (GAP_AUDIT_9 G1 follow-up d).
//
// A delimited file's text columns beside numeric ones import as sidecar text
// (`metadata.text_columns`, lib/originTextColumns), not as categorical channels,
// so they have no channel index. Smallest safe way to let Fit Model use them
// WITHOUT changing the import or the worksheet: expose the k-th text column as a
// virtual column key -(2 + k) (-1 is the X column, so every existing check that
// treats a negative key as "not a channel" keeps working), always nominal, read
// on demand from the sidecar at the analysis view's rows. The worksheet is never
// modified and no codes are written. Levels are the distinct texts, sorted by the
// server (JMP orders text levels alphabetically); a blank cell is a missing value.
//
// Fails closed: a sampled (lazy Origin preview) worksheet exposes none, because
// a row index does not name a real row there (lib/rowSidecars.rowsAreSampled).
// Known limit: the saved result's staleness fingerprint hashes the numeric
// analysis view only, so editing a text cell does not mark a saved Fit Model
// result stale (the live fit always re-reads the text, and the recipe carries a
// digest of the used text columns so Save never mistakes a changed fit for a
// duplicate).

import { originTextColumns } from "./originTextColumns";
import { rowsAreSampled } from "./rowSidecars";
import type { Dataset } from "./types";

export interface FitModelTextColumn {
  /** Virtual column key, <= -2. */
  key: number;
  label: string;
  rows: readonly string[];
}

export const textColumnKey = (index: number): number => -2 - index;
export const isTextKey = (key: number): boolean => key <= -2;
export const textKeyIndex = (key: number): number => -2 - key;

/** The dataset's usable text columns as virtual factor columns (none when its numbers are a sample). */
export function fitModelTextColumns(ds: Pick<Dataset, "data" | "pending">): FitModelTextColumn[] {
  if (rowsAreSampled(ds.pending)) return [];
  return originTextColumns(ds.data).map((c, i) => ({
    key: textColumnKey(i), label: `${c.longName ?? c.shortName} (text)`, rows: c.rows,
  }));
}

/** One text factor's cell per fitted request row (`rowIds` = original worksheet row); blank/absent -> null. */
export function textFactorValues(col: FitModelTextColumn, rowIds: readonly number[]): (string | null)[] {
  return rowIds.map((r) => {
    const cell = col.rows[r];
    return cell === undefined || cell.trim() === "" ? null : cell;
  });
}

/** A content digest of the text columns a model uses (FNV-1a over the texts, with shape), for the recipe. */
export function textDigest(cols: readonly FitModelTextColumn[]): string | undefined {
  if (!cols.length) return undefined;
  let h = 0x811c9dc5;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x1f, 0x01000193);
  };
  for (const c of cols) {
    mix(String(c.key));
    mix(String(c.rows.length));
    for (const cell of c.rows) mix(cell);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
