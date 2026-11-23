// The Origin book-family grouping, split out of lib/grouping.ts (bundle diet
// slice 32) and re-exported from it with `export *`: only the lazy Library
// section and the book-family menu read it.

import type { OriginBookFamily } from "./grouping";
import type { Dataset } from "./types";

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
