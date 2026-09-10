// Merge (concatenate) several datasets row-wise into one (#19) — MATLAB
// "Data ▸ Merge Selected". Datasets are joined by column position, so they must
// share a column count; labels/units come from the first. Use the worksheet sort
// afterwards if the merged x needs ordering (concatenation preserves input order).

import { concatRowSidecars, sidecarRowCount, withoutRowSidecars } from "./rowSidecars";
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
  // ONE row span per input, taken from `sidecarRowCount` rather than
  // `d.time.length` (BUG-006 site 8, review round 2). An input's sidecar can
  // legitimately run LONGER than its numeric grid — `store/cellEdit.ts` says so
  // in as many words and refuses to size anything from `time.length` for exactly
  // this reason — so sizing each part by `time.length` here silently TRUNCATED
  // the excess, the very thing that rule forbids. It also let a part's numeric
  // rows and its sidecar cells start at different offsets in the output, which
  // is misalignment rather than mere loss.
  //
  // The numeric rows are padded to the same span, so every part contributes
  // exactly `span` rows to BOTH halves and part k's numbers and text land on the
  // same output rows. `d.time.length` and `d.values.length` can themselves
  // differ on a ragged input; one span settles that too.
  const spans = datasets.map((d) => sidecarRowCount(d.metadata, Math.max(d.time.length, d.values.length)));
  const time: number[] = [];
  const values: number[][] = [];
  datasets.forEach((d, di) => {
    const span = spans[di];
    for (let r = 0; r < span; r += 1) {
      time.push(r < d.time.length ? d.time[r] : Number.NaN);
      // A fresh row per pad row — never one shared array (the aliasing trap
      // `store/cellEdit.ts` documents).
      const src = d.values[r];
      const out = src ? [...src] : Array.from({ length: ncol }, () => Number.NaN);
      for (const [c, plan] of plans) {
        const remap = plan.remaps[di];
        if (remap) out[c] = remap(out[c]);
      }
      values.push(out);
    }
  });
  const cat_levels: Record<number, string[]> = {};
  for (const [c, plan] of plans) cat_levels[c] = plan.levels;
  // Group O-2: a `level_order` names CODES, and the union table can renumber
  // them, so dataset 0's order goes through the SAME remap its values do.
  //
  // THIS LINE WAS ONCE DELETED AS DEAD CODE AND THAT WAS WRONG — it is worth
  // recording why, because the reasoning was persuasive. The argument was that
  // `planChannel` builds the union starting from `tables[0]` in its own order,
  // so dataset 0's levels keep their indices and `remapFor(tables[0], union)`
  // is an identity; sabotage agreed, since deleting the remap left every test
  // green. Both were true and the conclusion was still false: the identity
  // holds only when `tables[0]` has no REPEATED level string. With
  // `tables[0] = ["A","A","B"]`, the union de-duplicates to `["A","B",…]` and
  // dataset 0's own code 2 becomes 1 — its codes DO move. So the line was not
  // dead, it was untested, and a green sabotage meant the test set had a hole,
  // not that the code was useless. `merge.test.ts` now covers the duplicate
  // case; the earlier "codes are never renumbered" test was true only of the
  // unique-string fixture it used.
  //
  // Only dataset 0's preference survives, matching how this merge treats every
  // other non-row-indexed field (labels, units, metadata): there is no
  // defensible way to reconcile two users' orderings, and inventing one would
  // be worse than deterministically picking the first.
  const level_order: Record<number, number[]> = {};
  for (const [c, plan] of plans) {
    const own = datasets[0].level_order?.[c];
    if (!Array.isArray(own)) continue;
    const remap = plan.remaps[0];
    const seen = new Set<number>();
    const codes: number[] = [];
    for (const v of own) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const mapped = remap ? remap(v) : v;
      // A de-duplicating union can map two of dataset 0's codes onto one, so
      // the remapped order must not repeat a code.
      if (Number.isFinite(mapped) && !seen.has(mapped)) {
        seen.add(mapped);
        codes.push(mapped);
      }
    }
    if (codes.length) level_order[c] = codes;
  }
  return {
    time,
    values,
    labels: [...datasets[0].labels],
    units: [...datasets[0].units],
    metadata: {
      // BUG-006 site 8. Dataset 0's row-indexed sidecars are STRIPPED before the
      // rebuild rather than merely overwritten by it, so an omitted key means
      // ABSENT and never "inherited from dataset 0".
      //
      // Honest about what does the work, because the first version of this
      // comment was not: the per-part SPANS above are what fix the two
      // reproductions the review found (two text-only books whose spans were
      // both 0, and an overflow cell landing on dataset 1's row) — with spans,
      // every ordinary case emits the key and the overwrite alone would suffice.
      // The strip earns its place on one narrower case, established by sabotage
      // rather than assumed: a CORRUPTED (non-`{name: array}`) sidecar is skipped
      // for name collection, so no key is emitted, and a plain spread carried
      // dataset 0's bare array onto a grid with twice its rows.
      //
      // Everything NOT row-indexed still comes from dataset 0 — source,
      // comments, instrument fields — which a merge reasonably inherits.
      ...withoutRowSidecars(datasets[0].metadata),
      ...concatRowSidecars(datasets.map((d, i) => ({ metadata: d.metadata, rowCount: spans[i] }))),
      merged_from: names.join(" + "),
      merged_count: datasets.length,
    },
    ...(plans.size ? { cat_levels } : {}),
    ...(Object.keys(level_order).length ? { level_order } : {}),
  };
}
