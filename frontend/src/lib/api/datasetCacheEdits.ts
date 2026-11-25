// The lazy-only half of datasetCache.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the cell-edit invalidation and the handle test. Only lazy modules and tests call them.
// The code moved here verbatim and datasetCache.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { DataStruct } from "../types";

import { derived, handles, pending } from "./datasetCache";

/** Record that `child` is `parent` with some cells edited (store/cellEdit.ts
 *  calls this). When `child` is first sent, and the server holds `parent`, only
 *  the changed cells are uploaded -- see ./datasetPatch. A `parent` that was
 *  never sent is skipped over to ITS parent, so a burst of edits before a plot
 *  fetch still patches from the last dataset the server saw. */
export function noteCellEdit(parent: DataStruct, child: DataStruct): void {
  if (parent === child) return;
  const known = handles.has(parent) || pending.has(parent);
  derived.set(child, known ? parent : (derived.get(parent) ?? parent));
}

/** Whether a handle is remembered for `dataset` (not merely an upload in
 *  flight, which may end without one): a fit then names it by handle instead
 *  of posting its x/y (lib/fitSource.ts). */
export function hasDatasetHandle(dataset: object): boolean {
  return handles.has(dataset);
}
