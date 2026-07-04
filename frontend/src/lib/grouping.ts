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
