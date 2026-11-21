// Facet well guard: one panel per distinct value is a small-multiples grid
// only while the column has a handful of levels. A continuous column (every
// value distinct) would draw one tiny panel per row, so the well refuses it
// with the remedy instead of silently creating dozens of panels.

import { categoryLevels } from "../../../lib/categorical";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";

/** The most panels a Facet well accepts. */
export const MAX_FACET_LEVELS = 24;

/** Why `channel` cannot be the Facet, or null. */
export function facetRefusal(ds: Dataset, channel: number): string | null {
  const n = categoryLevels(analysisData(ds) ?? ds.data, channel).length;
  if (n <= MAX_FACET_LEVELS) return null;
  const name = ds.data.labels[channel] ?? `col ${channel}`;
  return `"${name}" has ${n} distinct values; Facet draws one panel per value (at most ${MAX_FACET_LEVELS}). Use a categorical column, or bin "${name}" into groups first.`;
}
