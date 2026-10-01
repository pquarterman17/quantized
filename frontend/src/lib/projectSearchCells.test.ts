// Full-text search over text-column CELLS (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4's
// booked follow-up): the index is built lazily, once per `text_columns`
// object, and a query over it is COMPLETE — every matching cell is counted,
// never capped.

import { describe, expect, it } from "vitest";

import {
  cellIndexBuildCount,
  cellIndexFor,
  queryCellIndex,
  startCellIndexBuild,
  startCellQuery,
  textColumnsSidecar,
} from "./projectSearchCells";

const sidecar = (cols: Record<string, unknown[]>) => cols as Readonly<Record<string, unknown>>;

describe("textColumnsSidecar — the cache key", () => {
  it("returns the SAME object the metadata holds, so it can key a WeakMap", () => {
    const tc = { SampleID: ["a"] };
    expect(textColumnsSidecar({ text_columns: tc })).toBe(tc);
    expect(textColumnsSidecar({ origin_text_columns: tc })).toBe(tc);
  });

  it("is null for absent or malformed sidecars", () => {
    expect(textColumnsSidecar({})).toBeNull();
    expect(textColumnsSidecar({ text_columns: ["a", "b"] })).toBeNull();
    expect(textColumnsSidecar({ text_columns: "abc" })).toBeNull();
    expect(textColumnsSidecar(undefined)).toBeNull();
  });
});

describe("cellIndexFor — built lazily, once per text_columns object", () => {
  it("builds on first use and reuses the index for the same object", () => {
    const tc = sidecar({ A: ["x1", "x2"] });
    const before = cellIndexBuildCount();
    const first = cellIndexFor(tc);
    expect(cellIndexBuildCount()).toBe(before + 1);
    expect(cellIndexFor(tc)).toBe(first);
    expect(cellIndexBuildCount()).toBe(before + 1);
  });

  it("rebuilds only when the object itself changes", () => {
    const tc1 = sidecar({ A: ["x1"] });
    const tc2 = sidecar({ A: ["x1"] });
    const before = cellIndexBuildCount();
    cellIndexFor(tc1);
    cellIndexFor(tc2);
    cellIndexFor(tc1);
    expect(cellIndexBuildCount()).toBe(before + 2);
  });

  it("an incremental build caches the same way, and resumes rather than restarting", () => {
    const rows = Array.from({ length: 40_000 }, (_, i) => `S-${i}`);
    const tc = sidecar({ A: rows });
    const build = startCellIndexBuild(tc);
    // A zero budget still makes progress (one block per step), so a slow
    // machine cannot stall the build forever.
    expect(build.step(0)).toBeNull();
    expect(startCellIndexBuild(tc)).toBe(build);
    let index = null;
    while (!index) index = build.step(0);
    expect(cellIndexFor(tc)).toBe(index);
  });
});

describe("queryCellIndex — complete, one match per (column)", () => {
  it("counts EVERY matching cell and reports the first matching row", () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => (i % 7 === 3 ? `NbAu-${i}` : `Pt-${i}`));
    const tc = sidecar({ SampleID: rows, Note: ["none", "nbau film", "none"] });
    const matches = queryCellIndex(cellIndexFor(tc), "nbau");
    // Columns come back in the worksheet's order (Origin short-name sort:
    // length, then lexical), the order `lib/columnmeta.ts` renders them in.
    expect(matches).toEqual([
      { col: 0, column: "Note", count: 1, firstRow: 1 },
      { col: 1, column: "SampleID", count: rows.filter((r) => r.includes("NbAu")).length, firstRow: 3 },
    ]);
  });

  it("counts a cell once however many times it matches, and never across cells", () => {
    const tc = sidecar({ A: ["aa aa", "a", "b", "ab"] });
    expect(queryCellIndex(cellIndexFor(tc), "a")[0]).toMatchObject({ count: 3, firstRow: 0 });
    // "ab" must not be found spanning the end of "a" and the start of "b".
    expect(queryCellIndex(cellIndexFor(tc), "ab")[0]).toMatchObject({ count: 1, firstRow: 3 });
  });

  it("matches what the worksheet DISPLAYS: String(cell), case-insensitively", () => {
    const tc = sidecar({ A: [12, null, true, "Mixed CASE"] });
    const idx = cellIndexFor(tc);
    expect(queryCellIndex(idx, "12")[0]).toMatchObject({ firstRow: 0 });
    expect(queryCellIndex(idx, "null")[0]).toMatchObject({ firstRow: 1 });
    expect(queryCellIndex(idx, "mixed case")[0]).toMatchObject({ firstRow: 3 });
  });

  it("keeps row numbers right when lower-casing changes a string's length", () => {
    // "İ".toLowerCase() is two code units; a joined-string fast path that
    // trusted the original offsets would misplace every later row.
    // Eight of them shift every later offset by eight, enough to land the
    // match two cells late without the per-cell fallback.
    const tc = sidecar({ A: ["İİİİİİİİ", "a", "b", "target", "c", "d", "e", "f"] });
    expect(queryCellIndex(cellIndexFor(tc), "target")[0]).toMatchObject({ count: 1, firstRow: 3 });
  });

  it("finds rows past a block boundary with the right absolute row index", () => {
    const rows = Array.from({ length: 70_000 }, () => "filler");
    rows[65_000] = "needle-here";
    rows[69_999] = "needle-too";
    const m = queryCellIndex(cellIndexFor(sidecar({ A: rows })), "needle");
    expect(m).toEqual([{ col: 0, column: "A", count: 2, firstRow: 65_000 }]);
  });

  it("returns nothing for a blank needle or a column with no match", () => {
    const idx = cellIndexFor(sidecar({ A: ["x"] }));
    expect(queryCellIndex(idx, "")).toEqual([]);
    expect(queryCellIndex(idx, "zzz")).toEqual([]);
  });

  it("a sliced query reaches the same complete answer as the synchronous one", () => {
    const rows = Array.from({ length: 60_000 }, (_, i) => `row ${i}`);
    const idx = cellIndexFor(sidecar({ A: rows, B: rows }));
    const q = startCellQuery(idx, "row 5");
    let out = null;
    let steps = 0;
    while (!out) {
      out = q.step(0);
      steps++;
    }
    expect(steps).toBeGreaterThan(1);
    expect(out).toEqual(queryCellIndex(idx, "row 5"));
  });
});

describe("per-keystroke cost (load-invariant property first)", () => {
  it("typing ten keystrokes over 300k cells builds the index ONCE", () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => `S12-${i % 97}-${i} ok`);
    const tc = sidecar({ A: rows, B: rows, C: rows });
    const before = cellIndexBuildCount();
    const t0 = performance.now();
    for (const needle of ["s", "s1", "s12", "s12-", "s12-4", "s12-40", "s12-40-", "zz", "z", "ok"]) {
      queryCellIndex(cellIndexFor(tc), needle);
    }
    expect(cellIndexBuildCount() - before).toBe(1);
    // Loose backstop only — the assertion above is the real one.
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});
