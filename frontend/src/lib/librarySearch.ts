// Project-wide Library search (LIBRARY_WORKBOOK_UX_PLAN PR D2, L0.26): one
// pure matcher over the canonical hierarchy so search "spans the project" —
// every node kind, not just worksheets. Worksheets keep the FULL smart-folder
// grammar (name/tag/format — lib/smartfolders is still the single grammar
// authority, shared with saved smart folders); every other kind offers only
// its name, so `tag:`/`format:` terms honestly exclude it rather than
// matching vacuously.

import type { LibraryNode } from "./libraryHierarchy";
import { matchesQuery, type QueryTerm } from "./smartfolders";

/** True when the node satisfies EVERY term (the same AND semantics as the
 *  dataset matcher; an empty term list matches all — callers gate on a
 *  non-blank query before entering search mode). */
export function libraryNodeMatches(node: LibraryNode, terms: readonly QueryTerm[]): boolean {
  if (node.kind === "worksheet") return matchesQuery(node.entity, terms);
  const name = node.name.toLowerCase();
  return terms.every(
    (t) => (t.field === "any" || t.field === "name") && name.includes(t.needle),
  );
}
