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

/** The import "family" a dataset belongs to, for SCOPING a grouping key only
 *  (never displayed): the `"<stem>:"` prefix `useApp.importFiles` gives each
 *  book of a multi-book Origin import (see `originBookFamilies`), or the
 *  dataset's own name when there's no such prefix — which is unique per
 *  dataset, so an ungrouped dataset never collides with anything. This is
 *  what stops two DIFFERENT Origin imports that both happen to contain a
 *  "Book1" (Origin's own default naming) from merging into one sheet group
 *  (WORKSHEET_PLAN item 5 hardening / "originSheetGroups keying collision"). */
function importStem(d: Dataset): string {
  const i = d.name.indexOf(":");
  return i < 0 ? d.name : d.name.slice(0, i);
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
  const parentOf = new Map<string, string>(); // bucket key -> displayed parent name
  for (const d of items) {
    const raw = (d.data.metadata as Record<string, unknown> | undefined)?.origin_book;
    if (typeof raw !== "string" || !raw) continue;
    const parent = raw.split("@")[0] || raw;
    // Scope the bucket by import stem too — "Book1" from one .opj and
    // "Book1" from an unrelated .opj must stay two separate groups.
    const key = `${importStem(d)}::${parent}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      parentOf.set(key, parent);
      order.push(key);
    }
    bucket.push(d);
  }
  return order
    .map((key) => ({
      parent: parentOf.get(key)!,
      members: [...buckets.get(key)!].sort((a, b) => originSheetNumber(a) - originSheetNumber(b)),
    }))
    .filter((g) => g.members.length > 1);
}

/** A book family's `"<stem>:<label>"` name with the stem prefix stripped, for
 *  display once the family context is already established (WORKSHEET_PLAN
 *  item 9's book switcher). Falls back to the whole name when there's no
 *  colon (shouldn't happen for a family member, but defensive). */
export function bookLabel(d: Dataset): string {
  const i = d.name.indexOf(":");
  return i < 0 ? d.name : d.name.slice(i + 1);
}

/** One DISTINCT book within an Origin project family (WORKSHEET_PLAN item 9's
 *  book switcher): collapses a multi-sheet book's several pseudo-book
 *  datasets (`Book4`, `Book4@2`, `Book4@3`, …) down to ONE representative
 *  (its earliest sheet) — `originBookFamilies` buckets by import stem alone,
 *  so a family of sheet-siblings from ONE book (already handled by
 *  `originSheetGroups`/`SheetTabs`) must not ALSO look like multiple distinct
 *  books here. Order = first appearance of each base `origin_book`. */
export interface FamilyBookEntry {
  /** The base `origin_book` value (no `"@N"` suffix) identifying this book. */
  book: string;
  /** The earliest-sheet (or first-seen) dataset representing this book. */
  representative: Dataset;
}

export function familyBooks(members: Dataset[]): FamilyBookEntry[] {
  const order: string[] = [];
  const bestForBook = new Map<string, Dataset>();
  for (const d of members) {
    const raw = (d.data.metadata as Record<string, unknown> | undefined)?.origin_book;
    if (typeof raw !== "string" || !raw) continue;
    const base = raw.split("@")[0] || raw;
    const best = bestForBook.get(base);
    if (!best) {
      order.push(base);
      bestForBook.set(base, d);
    } else if (originSheetNumber(d) < originSheetNumber(best)) {
      bestForBook.set(base, d); // an earlier sheet is the better representative
    }
  }
  return order.map((book) => ({ book, representative: bestForBook.get(book)! }));
}
