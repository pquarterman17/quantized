// Searching the INSTRUMENTAL-METADATA SIDECARS (PRIMARY_SOFTWARE_AUDIT_PLAN
// P1.4, "keep ignored instrumental metadata searchable").
//
// That plan box read "unchanged — pre-existing `text_columns`/`comments`
// sidecars; still stand". The sidecars do stand, and the data in them is
// preserved. It was never SEARCHABLE, which is what the box actually claimed:
// `projectSearch.ts`'s `metadataEntries` emits only scalar (string / number /
// boolean) metadata values and skips `origin_books`, `text_columns` and
// `label_rows` by name. Every sidecar that carries the metadata a parser
// declined to make a channel is therefore a collection, and every one of them
// fell through:
//
//   metadata.comments          list[str]              not scalar   -> dropped
//   metadata.text_columns      {header: [cell, ...]}  skipped by name
//   metadata.label_rows        [{index, role, cells}] skipped by name
//   metadata.all_column_names  list[str]              not scalar   -> dropped
//
// The `origin_books` skip stays: it is a multi-kB decoded book inventory, and
// matching inside it produces hits nobody can act on while drowning the ones
// they can. That was the right instinct applied to too wide a list.
//
// A COLLECTION needs a different hit shape from a scalar: one hit per
// (dataset, column) or (dataset, row), never one per matching cell — a sample-id
// column with 40 000 rows must not return 40 000 hits.
//
// WHAT IS DELIBERATELY NOT SEARCHED: the CELL CONTENTS of `text_columns`.
// `searchProject` runs in a `useMemo` on every keystroke, and a full substring
// scan of text-column cells was measured (node, this repo, 2026-09-09) at
//
//   20 datasets x 2 cols x  50 000 rows =  2.0M cells ->  322 ms
//   50 datasets x 3 cols x 100 000 rows = 15.0M cells -> 2560 ms
//
// per keystroke in the common no-match case. A capped scan would be silent
// incompleteness — the exact failure class the rest of this work exists to
// remove — so the honest answer is that row-level full-text search over data
// columns is a DIFFERENT feature needing an index, and is booked rather than
// faked. What IS searched here is metadata ABOUT the file: the column roster,
// the preamble, and the label rows (which is where sample ids live —
// `lib/labelRows.ts`'s header: "a four-row header left the user ... no way back
// to the sample ids"), all bounded by the header block's size, not the data's.

import { originTextColumns } from "./columnmeta";
import { labelRows } from "./labelRows";
import type { Dataset } from "./types";

/** A sidecar hit is the weakest signal in the ranking — below a scalar
 *  metadata match, which is itself below a note. Someone typing "Rxy" means the
 *  column, not a mention of it in a discarded header row. */
export const RANK_SIDECAR = 7;

export interface SidecarHit {
  id: string;
  label: string;
  context: string;
  channel?: number;
  /** Text columns render in the WORKSHEET, so that is where a hit reveals. */
  revealInWorksheet: boolean;
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];
}

/** Every sidecar hit for one dataset. At most one per column and one per label
 *  row, so a wide sheet cannot flood the results. */
export function sidecarHits(ds: Dataset, needle: string): SidecarHit[] {
  const out: SidecarHit[] = [];
  const meta = ds.data.metadata ?? {};

  // 1. Text-column NAMES — the roster of columns the parser kept but did not
  //    make channels. A text column has no channel index (columnmeta.ts), so no
  //    `channel` is claimed here even though the worksheet can show it.
  for (const col of originTextColumns(ds.data)) {
    if (!col.shortName.toLowerCase().includes(needle)) continue;
    out.push({
      id: `text:${ds.id}:${col.shortName}`,
      label: col.shortName,
      context: `${ds.name} · text column`,
      revealInWorksheet: true,
    });
  }

  // 2. The roster of columns the file declared, INCLUDING ones that never
  //    became channels or text columns (a sparse numeric column, say). Skipped
  //    when it duplicates a channel label the caller already matched.
  const channelLabels = new Set(ds.data.labels.map((l) => l.toLowerCase()));
  for (const name of asStrings(meta["all_column_names"])) {
    const lower = name.toLowerCase();
    if (!lower.includes(needle) || channelLabels.has(lower)) continue;
    out.push({
      id: `colname:${ds.id}:${name}`,
      label: name,
      context: `${ds.name} · column in file`,
      revealInWorksheet: false,
    });
  }

  // 3. Label rows — the descriptive header rows the parser did not use for
  //    column names. One hit per ROW, naming the matching cell.
  for (const row of labelRows(ds.data)) {
    const cells = [row.x, ...row.cells];
    const hitIdx = cells.findIndex((c) => c.toLowerCase().includes(needle));
    if (hitIdx < 0) continue;
    out.push({
      id: `labelrow:${ds.id}:${row.index}`,
      label: cells[hitIdx],
      context: `${ds.name} · header row ${row.index + 1}${row.role === "label" ? "" : ` (${row.role})`}`,
      // A label row's cells are index-aligned with `labels` AFTER the x cell,
      // so a non-x hit names a real channel the worksheet can scroll to.
      channel: hitIdx > 0 ? hitIdx - 1 : undefined,
      revealInWorksheet: hitIdx > 0,
    });
  }

  // 4. The file preamble. One hit per dataset, not per line — the comment block
  //    is prose about the whole file.
  const comments = asStrings(meta["comments"]);
  const matching = comments.filter((line) => line.toLowerCase().includes(needle));
  if (matching.length > 0) {
    const more = matching.length - 1;
    out.push({
      id: `comment:${ds.id}`,
      label: matching[0].trim() + (more > 0 ? ` (+${more} more line${more === 1 ? "" : "s"})` : ""),
      context: `${ds.name} · file comments`,
      revealInWorksheet: false,
    });
  }

  return out;
}
