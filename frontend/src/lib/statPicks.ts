// The Stat Stage's saved column picks (`PlotView.statPicks.cols`) against the
// dataset the stage is showing. Pure; read only by the lazily loaded stage
// (`components/Stage/useStatStagePicks.ts`), so none of this is eager — the
// eager half is the shape and its sanitizer in `./plotviewSanitize`.
//
// A pick is saved as `[index, label]` and the label is what decides whether it
// still means the same column. That replaces the old "reset every pick when
// the active dataset id changes" rule, which also ran on the first render
// after a reopen and wiped what the file had restored. The old rule's reason
// still holds: a bare index from another dataset can name a different column
// and silently mis-group. A label check catches exactly that case, and the
// default columns come back only then.

import { categoricalChannels, firstValueChannel } from "./statstage";
import type { StatColRef, StatPickCols } from "./plotviewSanitize";
import type { Dataset } from "./types";

/** The five column picks as channel indices (`value` < 0 is the x/time column). */
export interface StatCols {
  group: number | null;
  group2: number | null;
  value: number;
  facet: number | null;
  color: number | null;
}

const KEYS = ["group", "group2", "value", "facet", "color"] as const;

/** The columns a dataset starts with: its first categorical column as the
 *  group, the first other non-categorical column as the value, nothing else. */
export function defaultStatCols(ds: Dataset | null): StatCols {
  const group = categoricalChannels(ds)[0] ?? null;
  return { group, group2: null, value: firstValueChannel(ds, group ?? -999), facet: null, color: null };
}

/** Where a saved column is in `ds` now: the same index under the same label;
 *  else the ONE column carrying that label (it moved); else `undefined` — it
 *  is gone, or the label is ambiguous. The x/time column (index < 0) is saved
 *  with label "" and exists in every dataset. */
export function findStatCol(ds: Dataset, [index, label]: StatColRef): number | undefined {
  if (index < 0) return label === "" ? index : undefined;
  const labels = ds.data.labels;
  if (labels[index] === label) return index;
  const at = labels.indexOf(label);
  return at >= 0 && labels.lastIndexOf(label) === at ? at : undefined;
}

/** The saved columns resolved against `ds`, or `fallback` (`ds`'s defaults)
 *  when nothing was saved, there is no dataset yet, or ANY saved column is
 *  gone — all five together, never a saved column paired with a defaulted
 *  one. */
export function resolveStatCols(
  ds: Dataset | null,
  saved: StatPickCols | undefined,
  fallback: StatCols = defaultStatCols(ds),
): StatCols {
  if (!ds || !saved) return fallback;
  const out = {} as Record<(typeof KEYS)[number], number | null>;
  for (const k of KEYS) {
    const ref = saved[k];
    const at = ref ? findStatCol(ds, ref) : null;
    if (at === undefined) return fallback;
    out[k] = at;
  }
  return out as unknown as StatCols;
}

/** One column pick as saved: its index and its label in `ds`. */
export function statColRef(ds: Dataset | null, index: number): StatColRef {
  return [index, index < 0 ? "" : (ds?.data.labels[index] ?? "")];
}

/** All five picks as saved, labelled from `ds`. */
export function statColRefs(ds: Dataset | null, cols: StatCols): StatPickCols {
  const ref = (i: number | null) => (i == null ? null : statColRef(ds, i));
  return {
    group: ref(cols.group),
    group2: ref(cols.group2),
    value: statColRef(ds, cols.value),
    facet: ref(cols.facet),
    color: ref(cols.color),
  };
}
