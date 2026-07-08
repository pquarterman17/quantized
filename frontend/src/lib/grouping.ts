// Derived (render-time) groupings over the Library's datasets. Pure (no
// store/DOM) so the logic is unit-testable. The `.group`-string-based
// collapsible-sections grouping this file used to provide (`groupDatasets`/
// `hasAnyGroup`/`groupNames`) was retired with the folder tree (project-
// organization plan item 6) — folders are the one organizational model now;
// `.group` survives only as a legacy read migrated into a folder on load
// (see lib/foldertree.migrateGroupsToFolders). What remains here are the
// Origin-import-derived families that are NOT persisted state — they're
// recomputed from `metadata.origin_book` every render, so they can't be
// replaced by folders the same way (item 4/6's fallback for un-foldered
// legacy datasets).

import type { Dataset } from "./types";

/** A family of datasets fanned out from the same multi-book Origin project
 *  (plan item 17): `useApp.importFiles` names each book `"<stem>:<label>"` and
 *  stamps its metadata with `origin_book`. Detecting the family off that
 *  metadata (not just the `:` in the name) keeps this from misfiring on a
 *  dataset the user happened to rename with a colon in it. */
export interface OriginBookFamily {
  /** The source file's stem (e.g. "XRD" from "XRD.opj"). */
  stem: string;
  members: Dataset[];
}

/** Multi-book Origin families among `items`, in first-appearance order. A
 *  family needs ≥2 members — a project with a single book needs no bulk-manage
 *  affordance. */
export function originBookFamilies(items: Dataset[]): OriginBookFamily[] {
  const order: string[] = [];
  const buckets = new Map<string, Dataset[]>();
  for (const d of items) {
    const meta = d.data.metadata as Record<string, unknown> | undefined;
    if (meta?.origin_book == null) continue;
    const i = d.name.indexOf(":");
    if (i < 0) continue;
    const stem = d.name.slice(0, i);
    let bucket = buckets.get(stem);
    if (!bucket) {
      bucket = [];
      buckets.set(stem, bucket);
      order.push(stem);
    }
    bucket.push(d);
  }
  return order.map((stem) => ({ stem, members: buckets.get(stem)! })).filter((f) => f.members.length > 1);
}

/** A group of datasets that are sheets of the same multi-sheet Origin
 *  workbook. `io/origin_project/opj.py::_build_book` fans a multi-sheet
 *  workbook out into one pseudo-book per sheet: sheet 1 keeps the book's
 *  plain name (e.g. `"Book4"`), sheets 2+ get a `"<Book>@N"` suffix (e.g.
 *  `"Book4@2"`, `"Book4@3"`) stamped onto `metadata.origin_book`, with a
 *  human `"... (sheet N)"` note in `metadata.origin_book_long`. Flat in the
 *  Library, these read as unrelated siblings — this groups them back under
 *  their shared parent so the relationship is visible. */
export interface OriginSheetGroup {
  /** The parent book's `origin_book` value with no `"@N"` suffix (sheet 1). */
  parent: string;
  /** All sheets of the book, sorted by sheet number ascending (sheet 1 first). */
  members: Dataset[];
}

/** The sheet number encoded in a dataset's `origin_book` metadata:
 *  `"Book4"` → 1 (the base book, i.e. sheet 1), `"Book4@3"` → 3. Datasets
 *  with no `origin_book` metadata (not part of any Origin import) → 1. */
export function originSheetNumber(d: Dataset): number {
  const raw = (d.data.metadata as Record<string, unknown> | undefined)?.origin_book;
  if (typeof raw !== "string") return 1;
  const i = raw.indexOf("@");
  if (i < 0) return 1;
  const n = Number(raw.slice(i + 1));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Multi-sheet Origin groups among `items`, in first-appearance order of the
 *  parent. A group needs ≥2 members — a workbook with a single sheet has
 *  nothing to relate. Members are sorted by sheet number, so the parent
 *  (sheet 1) always leads even if the list order doesn't. */
export function originSheetGroups(items: Dataset[]): OriginSheetGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, Dataset[]>();
  for (const d of items) {
    const raw = (d.data.metadata as Record<string, unknown> | undefined)?.origin_book;
    if (typeof raw !== "string" || !raw) continue;
    const parent = raw.split("@")[0] || raw;
    let bucket = buckets.get(parent);
    if (!bucket) {
      bucket = [];
      buckets.set(parent, bucket);
      order.push(parent);
    }
    bucket.push(d);
  }
  return order
    .map((parent) => ({
      parent,
      members: [...buckets.get(parent)!].sort((a, b) => originSheetNumber(a) - originSheetNumber(b)),
    }))
    .filter((g) => g.members.length > 1);
}
