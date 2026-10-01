// The lazy-only half of lib/datafilter.ts (bundle diet slice 16): the `.dwk`
// filter sanitizer. Only the lazy workspace codec calls it, while the eager
// plot path needs just the row predicates, so the code moved here verbatim
// and lib/datafilter.ts re-exports it with `export *` - importers are
// unchanged, and Rollup bundles this file with the lazy chunks that use it.
// architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import { isActive } from "./datafilter";
import type { ColumnFilter, DataFilter } from "./types";

/** Validate a candidate filter (from a .dwk) into well-formed predicates for a
 *  dataset with `nChannels` channels. Drops entries with an out-of-range column,
 *  a bad kind, or no usable bound/values. */
export function sanitizeFilter(candidate: unknown, nChannels: number): DataFilter {
  if (!Array.isArray(candidate)) return [];
  const out: DataFilter = [];
  for (const c of candidate) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const col = o.col;
    if (typeof col !== "number" || !Number.isInteger(col) || col < -1 || col >= nChannels) continue;
    if (o.kind === "range") {
      const f: ColumnFilter = { col, kind: "range" };
      if (typeof o.min === "number" && Number.isFinite(o.min)) f.min = o.min;
      if (typeof o.max === "number" && Number.isFinite(o.max)) f.max = o.max;
      if (isActive(f)) out.push(f);
    } else if (o.kind === "set") {
      const values = Array.isArray(o.values)
        ? o.values.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        : [];
      if (values.length) out.push({ col, kind: "set", values });
    }
  }
  return out;
}
