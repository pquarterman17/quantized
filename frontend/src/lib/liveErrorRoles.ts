// The error roles an Origin-designating export sends (`.ogs`, `.opj`,
// consolidated CSV). Shared by the lazy export command bodies only, so it
// stays out of the eager bundle.

import type { Dataset, DataStruct } from "./types";

/** The DataStruct an Origin-designating export sends: the user's LIVE error
 *  bindings (`Dataset.errorRoles`) as `metadata.error_roles`, which the writers
 *  read to mark yErr/xErr columns.
 *
 *  ALWAYS carries the key — `[]` included — so the backend's last-resort
 *  label-keyword guess (io/_column_roles.is_error_label) never runs for an
 *  app export: with no live bindings, a parser-declared `error_roles` list is
 *  kept as is, and a dataset with neither sends `[]` (no error columns). */
export function withLiveErrorRoles(ds: Dataset): DataStruct {
  const declared = ds.data.metadata?.error_roles;
  if (!ds.errorRoles && Array.isArray(declared)) return ds.data;
  return { ...ds.data, metadata: { ...ds.data.metadata, error_roles: ds.errorRoles ?? [] } };
}
