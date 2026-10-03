// Full-text search over text-column CELLS (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4,
// the follow-up `projectSearchSidecars.ts` booked rather than faked).
//
// That module searches the NAMES of text columns and refuses their cells: a
// per-keystroke substring scan measured 322 ms at 2M cells and 2560 ms at 15M,
// and a capped scan would be silent incompleteness. This module is the index
// that refusal asked for. It is imported only by the lazy search workshop.
//
// THE INDEX. Per column, cells are lower-cased and joined with a NUL separator
// into blocks of `BLOCK_CELLS` cells, each with an `Int32Array` of cell start
// offsets. A query is then a native `indexOf` walk over a few large strings
// (instead of a `toLowerCase()` allocation per cell per keystroke); every hit
// maps back to its cell by binary search and jumps to the next cell, so a cell
// counts once and a match can never span two cells (the needle has no NUL).
//
// CACHING. A `WeakMap` keyed on the `text_columns` object itself. Text columns
// are read-only sidecars and every dataset edit replaces `data`/`metadata`
// rather than mutating the object, so object identity is exactly "these cells":
// the index is built once per object and dropped with it.
//
// OFF THE MAIN THREAD — CHUNKED IDLE WORK, NOT A WORKER. A Worker cannot see
// the store's arrays; the cells would have to be posted to it, and posting is a
// structured clone that SERIALIZES ON THE SENDING (MAIN) THREAD. Measured (node,
// this repo, 2026-10-01): structured-cloning the 15M-cell corpus below took
// 3620 ms round trip, while building the whole index in place took 1548 ms. The
// hand-off alone would block longer than the work it offloads. So the build is
// a resumable stepper (`startCellIndexBuild`) that the search workshop advances
// in time-boxed slices between frames, and the query is the same
// (`startCellQuery`). Both have synchronous forms for small projects and tests.
//
// MEASURED PER-KEYSTROKE COST (node 22, this module bundled, 2026-10-01; cells
// like "S12-1-40213 ok", the same 20x2x50k and 50x3x100k shapes as the sidecar
// module's measurement; median of 5 synchronous `queryCellIndex` passes over
// built indexes):
//
//                no match   1 char ("s")   typical ("s12-1-4")   rare ("-99999 ")
//   2.0M cells     3.2 ms        63 ms            26 ms                34 ms
//   15.0M cells   23 ms         354 ms           209 ms               257 ms
//
// versus 322 / 2560 ms for the old per-cell scan. The cost is a native string
// scan, so it is dominated by how common the needle's first character is.
// Index build: 299 ms at 2M, 1548 ms at 15M — paid ONCE per object. Above
// `SYNC_CELL_LIMIT` the workshop runs build and query in `SLICE_MS` (8 ms)
// slices, so what a keystroke costs the main thread is one slice: the longest
// measured was 12.7 ms querying and 28 ms building (a GC pause inside one
// block), and the complete answer arrives over the following slices behind a
// visible "Searching cell text…" state, never as a partial count.

import { originTextColumnNames } from "./originTextColumnCells";

/** Cells per block: small enough that building one block (the unit of work
 *  between yields) stays around 10 ms even for long cells. */
export const BLOCK_CELLS = 16_384;

const SEP = "\u0000";

export type TextColumnsSidecar = Readonly<Record<string, unknown>>;

interface CellBlock {
  col: number;
  firstRow: number;
  /** Lower-cased cells joined by NUL, with a trailing NUL. */
  text: string;
  /** `starts[i]` is cell i's offset in `text`; `starts[n]` is `text.length`. */
  starts: Int32Array;
}

export interface CellIndex {
  readonly columns: readonly string[];
  readonly blocks: readonly CellBlock[];
  readonly cells: number;
}

/** One result per (column): how many cells match and where the first one is. */
export interface CellMatch {
  col: number;
  column: string;
  count: number;
  firstRow: number;
}

/** The `text_columns` sidecar object itself (the cache key), read with the
 *  same precedence as `lib/columnmeta.ts`; null when absent or malformed. */
export function textColumnsSidecar(metadata: Record<string, unknown> | undefined): TextColumnsSidecar | null {
  const raw = metadata?.["text_columns"] ?? metadata?.["origin_text_columns"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as TextColumnsSidecar;
}

/** The ordered text columns with their cell arrays — the worksheet's order. */
function columnsOf(sidecar: TextColumnsSidecar): [string, unknown[]][] {
  return originTextColumnNames({ metadata: { text_columns: sidecar } }).map((name) => [
    name,
    sidecar[name] as unknown[],
  ]);
}

/** Total cells, without touching any of them. */
export function sidecarCellCount(sidecar: TextColumnsSidecar): number {
  return columnsOf(sidecar).reduce((n, [, rows]) => n + rows.length, 0);
}

function buildBlock(col: number, rows: readonly unknown[], from: number, to: number): CellBlock {
  const cells = rows.slice(from, to).map((c) => (typeof c === "string" ? c : String(c)));
  const starts = new Int32Array(cells.length + 1);
  // Fast path: lower-case the joined block once. Lower-casing can change a
  // string's LENGTH ("İ" -> "i̇"), which would shift every later offset, so
  // the per-cell path is used whenever the lengths disagree.
  const joined = cells.join(SEP) + SEP;
  let text = joined.toLowerCase();
  let lowered: string[] | null = null;
  if (text.length !== joined.length) {
    lowered = cells.map((c) => c.toLowerCase());
    text = lowered.join(SEP) + SEP;
  }
  let off = 0;
  for (let i = 0; i < cells.length; i++) {
    starts[i] = off;
    off += (lowered ? lowered[i] : cells[i]).length + 1;
  }
  starts[cells.length] = off;
  return { col, firstRow: from, text, starts };
}

let builds = 0;
/** How many indexes have been built — the load-invariant a perf test asserts. */
export function cellIndexBuildCount(): number {
  return builds;
}

export interface CellIndexBuild {
  readonly cells: number;
  /** Advance for about `budgetMs` (at least one block); the index once done. */
  step(budgetMs: number): CellIndex | null;
}

const indexes = new WeakMap<TextColumnsSidecar, CellIndex>();
const inFlight = new WeakMap<TextColumnsSidecar, CellIndexBuild>();

/** The cached index for this exact object, or null if not built yet. */
export function cachedCellIndex(sidecar: TextColumnsSidecar): CellIndex | null {
  return indexes.get(sidecar) ?? null;
}

/** A resumable build. Calling it again for the same object returns the SAME
 *  build, so a keystroke during a build continues it rather than restarting. */
export function startCellIndexBuild(sidecar: TextColumnsSidecar): CellIndexBuild {
  const existing = inFlight.get(sidecar);
  if (existing) return existing;
  const cols = columnsOf(sidecar);
  const blocks: CellBlock[] = [];
  let col = 0;
  let row = 0;
  let done: CellIndex | null = indexes.get(sidecar) ?? null;
  const build: CellIndexBuild = {
    cells: cols.reduce((n, [, rows]) => n + rows.length, 0),
    step(budgetMs) {
      if (done) return done;
      const t0 = performance.now();
      do {
        while (col < cols.length && row >= cols[col][1].length) {
          col++;
          row = 0;
        }
        if (col >= cols.length) {
          done = { columns: cols.map(([name]) => name), blocks, cells: build.cells };
          builds++;
          indexes.set(sidecar, done);
          inFlight.delete(sidecar);
          return done;
        }
        const rows = cols[col][1];
        const to = Math.min(rows.length, row + BLOCK_CELLS);
        blocks.push(buildBlock(col, rows, row, to));
        row = to;
      } while (performance.now() - t0 < budgetMs);
      return null;
    },
  };
  if (!done) inFlight.set(sidecar, build);
  return build;
}

/** The index for this object, building it synchronously if needed. */
export function cellIndexFor(sidecar: TextColumnsSidecar): CellIndex {
  const build = startCellIndexBuild(sidecar);
  let index = build.step(Infinity);
  while (!index) index = build.step(Infinity);
  return index;
}

/** Fold one block's matches into `acc` (keyed by column). */
function scanBlock(block: CellBlock, needle: string, acc: Map<number, { count: number; firstRow: number }>): void {
  const { text, starts } = block;
  let at = text.indexOf(needle);
  if (at < 0) return;
  const last = starts.length - 2;
  let cell = 0;
  let count = 0;
  let first = -1;
  while (at >= 0) {
    let lo = cell;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    cell = lo;
    if (first < 0) first = cell;
    count++;
    at = text.indexOf(needle, starts[cell + 1]);
  }
  const prev = acc.get(block.col);
  if (prev) prev.count += count;
  else acc.set(block.col, { count, firstRow: block.firstRow + first });
}

export interface CellQuery {
  /** Advance for about `budgetMs` (at least one block); the matches once done. */
  step(budgetMs: number): CellMatch[] | null;
}

/** A resumable query over a built index. Results are COMPLETE when returned:
 *  every block is scanned and every matching cell counted. */
export function startCellQuery(index: CellIndex, query: string): CellQuery {
  const needle = query.trim().toLowerCase();
  const acc = new Map<number, { count: number; firstRow: number }>();
  let next = 0;
  // A NUL can never be inside a cell's displayed text in a way the separator
  // would not also break, and no input field produces one: nothing to scan.
  const total = needle && !needle.includes(SEP) ? index.blocks.length : 0;
  return {
    step(budgetMs) {
      const t0 = performance.now();
      while (next < total) {
        scanBlock(index.blocks[next++], needle, acc);
        if (performance.now() - t0 >= budgetMs) break;
      }
      if (next < total) return null;
      return [...acc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([col, m]) => ({ col, column: index.columns[col], count: m.count, firstRow: m.firstRow }));
    },
  };
}

/** The complete matches, synchronously. */
export function queryCellIndex(index: CellIndex, query: string): CellMatch[] {
  const q = startCellQuery(index, query);
  let out = q.step(Infinity);
  while (!out) out = q.step(Infinity);
  return out;
}
