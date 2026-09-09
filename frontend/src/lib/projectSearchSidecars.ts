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
// REVIEW ROUND, and worth stating plainly: the first version of this module
// undercut its own argument. It read the text-column NAMES through
// `lib/columnmeta.ts`'s `originTextColumns`, which materializes every cell
// (`rows.map(String)`) to build the `TextColumn.rows` the worksheet needs — so
// this module re-materialized every text cell on every keystroke while claiming
// in this very comment to avoid exactly that cost. Measured 55.6 ms at the
// 20x2x50k scale below, versus 0.0 ms reading the keys. It now reads the keys
// (`textColumnNames`). A performance rationale is not worth much if the code
// under it was never measured.
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

import { excerpt } from "./projectSearch";
import { labelRows } from "./labelRows";
import { plural } from "./plural";
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
  /** Text columns and the x column render in the WORKSHEET, so that is where
   *  those hits reveal. `channel` is carried only when the hit really names a
   *  value channel; today `SearchPanel` uses it for the status phrasing, and a
   *  future scroll-to-column would need it to be right, so it is not guessed. */
  revealInWorksheet: boolean;
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];
}

/** `io/delimited.py` derives a channel's `label` by STRIPPING a trailing
 *  parenthesised/bracketed unit from the raw header (`_extract_units`:
 *  "Temp (C)" -> "Temp"), while `all_column_names` keeps the raw header. So a
 *  raw-vs-label comparison has to strip the same way or it silently never
 *  matches for the common case of a header that carries its unit. */
function withoutUnit(header: string): string {
  return header.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "").trim();
}

/** The keys of the `text_columns` sidecar, WITHOUT materializing its cells.
 *
 *  `lib/columnmeta.ts`'s `originTextColumns` is the sanctioned reader, but it
 *  does `rows.map(String)` over every cell to build its `TextColumn.rows` —
 *  fine for the worksheet, which needs the cells, and completely wrong here,
 *  where only the NAMES are wanted. Going through it made this function
 *  re-materialize every text cell on every keystroke: measured 54 ms at 20
 *  datasets x 2 columns x 50 000 rows, which is precisely the per-keystroke
 *  cost this module's doc says it refuses to pay. Read the keys directly. */
function textColumnNames(metadata: Record<string, unknown>): string[] {
  const raw = metadata["text_columns"] ?? metadata["origin_text_columns"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.keys(raw as Record<string, unknown>);
}

/** Every sidecar hit for one dataset. At most one per NAME and one per label
 *  row, so a wide sheet cannot flood the results and one column cannot appear
 *  several times over. */
export function sidecarHits(ds: Dataset, needle: string): SidecarHit[] {
  const out: SidecarHit[] = [];
  const meta = ds.data.metadata ?? {};

  // 1. COLUMN NAMES, from both sources at once.
  //
  //    A text column appears in `text_columns` AND in `all_column_names`, so
  //    reading them independently emitted the same name twice with
  //    contradictory reveal targets. One deduped pass instead: a name is a
  //    worksheet-revealing hit when it is a text column (the worksheet renders
  //    those), and a plain Library hit otherwise.
  //
  //    A name that is already a searchable CHANNEL label is skipped —
  //    `searchProject` emits a `column` hit for it at a far better rank.
  const channelLabels = new Set(ds.data.labels.map((l) => l.toLowerCase()));
  const textNames = new Set(textColumnNames(meta));
  const seen = new Set<string>();
  for (const name of [...textNames, ...asStrings(meta["all_column_names"])]) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (!lower.includes(needle)) continue;
    if (channelLabels.has(lower) || channelLabels.has(withoutUnit(name).toLowerCase())) continue;
    const isText = textNames.has(name);
    out.push({
      // Indexed by the deduped position, since duplicate non-blank headers
      // survive `io/delimited.py` and a name alone is not a unique id.
      id: `colname:${ds.id}:${seen.size}:${name}`,
      label: name,
      context: `${ds.name} · ${isText ? "text column" : "column in file"}`,
      revealInWorksheet: isText,
    });
  }

  // 2. DESCRIPTIVE label rows only.
  //
  //    `labelRows()` also returns the rows layout detection consumed as the
  //    header and the units — whose cells ARE the column names and units, both
  //    already covered above (and by `searchProject`'s own column hits). Those
  //    produced a third near-identical row for the same query. What is unique
  //    here is the `label` row: the descriptive header the parser had to
  //    discard, which is where sample ids live (`lib/labelRows.ts`).
  for (const row of labelRows(ds.data)) {
    if (row.role !== "label") continue;
    const cells = [row.x, ...row.cells];
    const hitIdx = cells.findIndex((c) => c.toLowerCase().includes(needle));
    if (hitIdx < 0) continue;
    out.push({
      id: `labelrow:${ds.id}:${row.index}`,
      label: cells[hitIdx],
      context: `${ds.name} · header row ${row.index + 1}`,
      // `io/delimited.py` builds `cells` as `[at(c) for c in (*data_idx,
      // *categorical_idx)]` — exactly the `labels` order, with the x cell split
      // out ahead of it. So index 0 is the x column (which has no channel) and
      // index n is channel n-1. The x column renders in the worksheet too, so
      // the reveal target is the same either way.
      ...(hitIdx > 0 ? { channel: hitIdx - 1 } : {}),
      revealInWorksheet: true,
    });
  }

  // 3. The file preamble. One hit per dataset, not per line — the comment block
  //    is prose about the whole file. Excerpted AROUND the match, like a note
  //    hit, so a long instrument line does not truncate the match away.
  const matching = asStrings(meta["comments"]).filter((l) => l.toLowerCase().includes(needle));
  if (matching.length > 0) {
    const more = matching.length - 1;
    out.push({
      id: `comment:${ds.id}`,
      label: excerpt(matching[0], needle) + (more > 0 ? ` (+${more} more line${plural(more)})` : ""),
      context: `${ds.name} · file comments`,
      revealInWorksheet: false,
    });
  }

  return out;
}
