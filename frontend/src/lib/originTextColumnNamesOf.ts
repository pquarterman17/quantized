// The lazy-only half of originTextColumnCells.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the text-column name lister. Only lazy modules and tests call it.
// The code moved here verbatim and originTextColumnCells.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { textColumnEntries } from "./originTextColumnCells";
import type { DataStruct } from "./types";

export function originTextColumnNames(ds: Pick<DataStruct, "metadata">): string[] {
  return textColumnEntries(ds).map(([shortName]) => shortName);
}
