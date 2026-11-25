// The lazy-only half of types.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the lazy-book entry guards. Only lazy modules and tests call it.
// The code moved here verbatim and types.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { BookEntry, LazyBookEntry, PrimaryBookMarker } from "./types";

export function isPrimaryBookMarker(b: BookEntry): b is PrimaryBookMarker {
  return (b as PrimaryBookMarker).primary === true;
}

export function isLazyBookEntry(b: BookEntry): b is LazyBookEntry {
  return (b as LazyBookEntry).lazy === true;
}
