// A live graph's legend defaults (gap audit 2 #1): the curve labels
// lib/linkedCurves.ts stamps into `metadata.linked_curve_legends`, by column
// -- the user's own label, else the source's CURRENT name. A rename in the
// view's `seriesLabels` still wins. Eager and tiny: the canvas, the DOM legend
// and the export all read it.

import type { DataStruct } from "./types";

const EMPTY: Readonly<Record<number, string>> = Object.freeze({});
const cache = new WeakMap<object, Record<number, string>>();

/** Column -> legend default (empty for a dataset that is not a graph). */
export function linkedLegends(data: Pick<DataStruct, "metadata"> | null | undefined): Readonly<Record<number, string>> {
  const raw = data?.metadata?.["linked_curve_legends"];
  if (!Array.isArray(raw)) return EMPTY;
  let out = cache.get(raw);
  if (!out) {
    out = {};
    raw.forEach((l, i) => {
      if (typeof l === "string" && l) out![i] = l;
    });
    cache.set(raw, out);
  }
  return out;
}

/** `labels` over the graph's legend defaults (same object when there are none). */
export function withLinkedLegends<T extends Record<number, string>>(data: Pick<DataStruct, "metadata"> | null | undefined, labels: T): T {
  const legends = linkedLegends(data);
  return legends === EMPTY ? labels : ({ ...legends, ...labels } as T);
}
