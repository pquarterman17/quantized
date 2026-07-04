// Partition the Library's datasets into collapsible sections by their `.group`.
// Pure (no store/DOM) so the grouping logic is unit-testable.

import type { Dataset } from "./types";

export interface DatasetGroup {
  /** The raw group key ("" for ungrouped). */
  key: string;
  /** Display label ("Ungrouped" for the empty key). */
  label: string;
  items: Dataset[];
}

/** Group datasets by `.group`, preserving first-appearance order of the groups;
 *  the ungrouped bucket ("") always sorts last. Datasets keep their incoming
 *  order within each group. An empty input yields an empty list. */
export function groupDatasets(items: Dataset[]): DatasetGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, Dataset[]>();
  for (const d of items) {
    const key = d.group?.trim() ? d.group.trim() : "";
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(d);
  }
  // Stable sort (ES2019+): named groups keep first-appearance order, "" goes last.
  order.sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0));
  return order.map((key) => ({ key, label: key || "Ungrouped", items: buckets.get(key)! }));
}

/** Whether any dataset carries a group (drives grouped vs flat rendering). */
export function hasAnyGroup(items: Dataset[]): boolean {
  return items.some((d) => d.group?.trim());
}

/** Distinct non-empty group names in first-appearance order — populates the
 *  Library group-filter dropdown (#20). */
export function groupNames(items: Dataset[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of items) {
    const key = d.group?.trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

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
