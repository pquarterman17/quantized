// Merge (concatenate) several datasets row-wise into one (#19) — MATLAB
// "Data ▸ Merge Selected". Datasets are joined by column position, so they must
// share a column count; labels/units come from the first. Use the worksheet sort
// afterwards if the merged x needs ordering (concatenation preserves input order).

import type { DataStruct } from "./types";

/** Two level tables agree only if they're the SAME LENGTH and SAME ORDER —
 *  order encodes the code->string mapping (`levels[code]`), so a reordered
 *  table with identical strings is still a real mismatch (P1.4 review
 *  P2-1). */
function levelsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Per-channel remap: `remaps[datasetIndex]` maps that dataset's OLD numeric
 *  code to the merged table's NEW code for one channel (or `undefined` when
 *  the channel needs no remap at all — every dataset already agreed). */
interface ChannelPlan {
  levels: string[];
  /** `null` entry = that dataset's codes for this channel are already
   *  correct against `levels` as-is (either it's the sole/first table, or
   *  the fast "already identical" path). */
  remaps: (((code: number) => number) | null)[];
}

/** A code -> code lookup array is faster and simpler to build/verify than a
 *  closure per level; `oldTable[code]` -> the level STRING -> its index in
 *  `union` is the remap, with an out-of-range/non-integer/NaN code passed
 *  through unchanged (P1.4's "never throw, degrade" convention — a
 *  malformed code was already wrong before the merge, remapping it further
 *  wrong is no worse, and NaN/missing must stay NaN/missing either way). */
function remapFor(oldTable: readonly string[], union: readonly string[]): (code: number) => number {
  const unionIndex = new Map(union.map((s, i) => [s, i]));
  return (code: number): number => {
    if (!Number.isFinite(code) || !Number.isInteger(code) || code < 0 || code >= oldTable.length) return code;
    const idx = unionIndex.get(oldTable[code]);
    return idx ?? code;
  };
}

/** Plan channel `c`'s merged level table + per-dataset remap (P1.5: real
 *  conflict resolution, replacing the P1.4-era "carries-if-identical, drops
 *  on any mismatch" default). Returns `null` when the channel can't safely
 *  participate at all — at least one dataset has NO table for it, so its
 *  raw values were never codes into anything and can't be reinterpreted as
 *  some union table's codes (this ONE case still drops the channel, same as
 *  before; it is not a "differing tables" conflict, it's "not categorical
 *  everywhere"). When every dataset already agrees (the common case), no
 *  remap functions are built at all — a lossless, allocation-free pass. */
function planChannel(datasets: readonly DataStruct[], c: number): ChannelPlan | null {
  const tables = datasets.map((d) => d.cat_levels?.[c]);
  if (tables.some((t) => !t)) return null;
  const first = tables[0]!;
  if (tables.every((t) => levelsEqual(t!, first))) {
    return { levels: first, remaps: datasets.map(() => null) };
  }
  // Union table: first dataset's own order, then each subsequent dataset's
  // NEW levels appended in the order first encountered — deterministic and
  // dataset-order-stable (merging [A,B] then [B,A] can legitimately differ,
  // same as any other order-sensitive concatenation this function already is).
  const union: string[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    for (const level of t!) {
      if (!seen.has(level)) {
        seen.add(level);
        union.push(level);
      }
    }
  }
  const remaps = tables.map((t) => (levelsEqual(t!, union) ? null : remapFor(t!, union)));
  return { levels: union, remaps };
}

/** Concatenate ≥2 datasets row-wise. Throws on <2 inputs or a column-count
 *  mismatch. The result's labels/units are the first dataset's; metadata records
 *  the provenance. Arrays are copied (no aliasing of the source datasets).
 *  `cat_levels` merges per-channel onto a coherent union table, remapping
 *  codes losslessly when tables differ (`planChannel`); a channel missing
 *  its table on even one input still drops (can't invent a mapping for raw,
 *  never-coded values). */
export function mergeDatasets(datasets: DataStruct[], names: string[]): DataStruct {
  if (datasets.length < 2) {
    throw new Error("merge needs at least 2 datasets");
  }
  const ncol = datasets[0].labels.length;
  for (let i = 1; i < datasets.length; i++) {
    if (datasets[i].labels.length !== ncol) {
      throw new Error(
        `merge: column-count mismatch (${names[0]} has ${ncol}, ${names[i]} has ${datasets[i].labels.length})`,
      );
    }
  }
  const plans = new Map<number, ChannelPlan>();
  for (let c = 0; c < ncol; c++) {
    const plan = planChannel(datasets, c);
    if (plan) plans.set(c, plan);
  }
  const time: number[] = [];
  const values: number[][] = [];
  datasets.forEach((d, di) => {
    for (const t of d.time) time.push(t);
    for (const row of d.values) {
      const out = [...row];
      for (const [c, plan] of plans) {
        const remap = plan.remaps[di];
        if (remap) out[c] = remap(out[c]);
      }
      values.push(out);
    }
  });
  const cat_levels: Record<number, string[]> = {};
  for (const [c, plan] of plans) cat_levels[c] = plan.levels;
  return {
    time,
    values,
    labels: [...datasets[0].labels],
    units: [...datasets[0].units],
    metadata: {
      ...datasets[0].metadata,
      merged_from: names.join(" + "),
      merged_count: datasets.length,
    },
    ...(plans.size ? { cat_levels } : {}),
  };
}
