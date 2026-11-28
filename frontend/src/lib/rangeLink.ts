// A LIVE link to a named range (ROW_RANGE_CONTRACT 3.1 and 5.2: `rowRange = { named: id }`). A plot window or an analysis
// input that follows a named range holds a `RowRange` whose `named` is the range's id; its `from` and `to` are what the
// name covers NOW, re-read by `store/rangeLinkSync` whenever the named ranges or the sheets change, so the window follows
// a retarget and every row insert or delete. Pure: no store, no React. Lazy (only the sync and the link setters import it).
//
// A link that cannot be read is REFUSED, never widened: it carries `refused` (the reason) with an empty window, so every
// consumer shows no rows and says why. The reasons are the model's own words (`namedRangeIssue`), plus the two a link
// adds: the range was deleted (its id never comes back, so the link never re-binds to a later range of the same name;
// undo restores the range and the link together), and the range names a block on another worksheet than the one the
// window reads (positions on one sheet mean nothing on another).

import { namedRangeIssue, type NamedRange } from "./namedRanges";
import type { RowRange } from "./rowRange";
import type { Dataset } from "./types";

/** The named link `id` for a window on worksheet `datasetId`, resolved against the live ranges and sheets. */
export function resolveRangeLink(
  id: string,
  datasetId: string,
  ranges: readonly NamedRange[],
  datasets: readonly Pick<Dataset, "id" | "name" | "data" | "pending">[],
  /** The name the link showed before, kept when the range is gone so the refusal still says whose it was. */
  was?: string,
): RowRange {
  const range = ranges.find((r) => r.id === id);
  const refuse = (reason: string): RowRange => ({ from: 0, to: -1, named: id, ...(range ? { namedAs: range.name } : was ? { namedAs: was } : {}), refused: reason });
  if (!range) return refuse("the named range was removed");
  const issue = namedRangeIssue(range, datasets);
  if (issue) return refuse(issue);
  const sheet = datasets.find((d) => d.id === range.target.datasetId)!;
  if (sheet.id !== datasetId) return refuse(`named range ${range.name} is on ${sheet.name}, not on this worksheet`);
  if (sheet.pending != null) return refuse(`${sheet.name} is still loading`);
  const rows = range.target.rows ?? { from: 0, to: sheet.data.time.length - 1 };
  return { from: rows.from, to: rows.to, named: id, namedAs: range.name };
}

/** Same window (rows, name and refusal)? A sync that finds no change writes nothing. */
export const sameLink = (a: RowRange, b: RowRange): boolean =>
  a.from === b.from && a.to === b.to && a.named === b.named && a.namedAs === b.namedAs && a.refused === b.refused && a.was === b.was;
