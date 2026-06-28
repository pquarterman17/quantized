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
