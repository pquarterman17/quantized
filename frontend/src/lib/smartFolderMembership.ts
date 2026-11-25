// The lazy-only half of smartfolders.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the smart-folder membership query. Only lazy modules and tests call it.
// The code moved here verbatim and smartfolders.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { matchesQuery, parseQuery, type SmartFolder } from "./smartfolders";
import type { Dataset } from "./types";

/** A smart folder's members, in library order (derived — never stored). */
export function smartFolderMembers(datasets: readonly Dataset[], sf: SmartFolder): Dataset[] {
  const terms = parseQuery(sf.query);
  return datasets.filter((d) => matchesQuery(d, terms));
}
