// lib/recalc — the #1 dependency graph: bgRef chains + fit nodes.

import { describe, expect, it } from "vitest";

import { downstreamOf, markStale, recalcNodes, wouldCreateCycle } from "./recalc";
import type { ComputedColumn, Dataset, DataStruct } from "./types";

const data: DataStruct = { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} };

const ds = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name: id,
  data,
  ...over,
});

describe("downstreamOf", () => {
  it("finds bg-dependent datasets through chains, and every affected fit", () => {
    const datasets = [
      ds("a", { fitSpec: { model: "Linear" } }),
      // b subtracts a as its background
      ds("b", { raw: data, corrections: { yOff: 1 }, bgRef: { datasetId: "a", interp: "linear" } }),
      // c subtracts b — a change to a propagates a → b → c
      ds("c", {
        raw: data,
        corrections: { yOff: 2 },
        bgRef: { datasetId: "b", interp: "linear" },
        fitSpec: { model: "Gaussian" },
      }),
      ds("unrelated", { fitSpec: { model: "Linear" } }),
    ];
    const down = downstreamOf(datasets, "a");
    expect(down.datasets).toEqual(["b", "c"]);
    expect(down.fits).toEqual(["a", "c"]); // a's own fit + c's; b has no fitSpec
  });

  it("ignores bgRef holders without corrections+raw, and is cycle-safe", () => {
    const datasets = [
      ds("a", { bgRef: { datasetId: "b", interp: "linear" }, raw: data, corrections: {} }),
      ds("b", { bgRef: { datasetId: "a", interp: "linear" }, raw: data, corrections: {} }),
      ds("c", { bgRef: { datasetId: "a", interp: "linear" } }), // no corrections — not re-derivable
    ];
    const down = downstreamOf(datasets, "a");
    expect(down.datasets).toEqual(["b"]); // cycle stops; c skipped
    expect(down.fits).toEqual([]);
  });

  it("a lone dataset with a fit stales only its own fit", () => {
    const down = downstreamOf([ds("a", { fitSpec: { model: "Linear" } })], "a");
    expect(down.datasets).toEqual([]);
    expect(down.fits).toEqual(["a"]);
  });
});

describe("markStale", () => {
  it("appends only missing ids and keeps the same reference when unchanged", () => {
    const cur = ["a"];
    expect(markStale(cur, ["a"])).toBe(cur);
    expect(markStale(cur, ["b", "a"])).toEqual(["a", "b"]);
  });
});

// LIBRARY_WORKBOOK_UX_PLAN PR K, K3: downstreamOf generalizes over the
// widened ds/col/sheet/fit vocabulary — a derived worksheet (derivedFrom
// set) shows up in `datasets`/`fits` exactly like a bgRef-chained one, with
// NO recompute happening (this is a pure graph query — see K5c's store-level
// test in store/recalc.test.ts for the "does NOT recompute" half).
describe("downstreamOf — generalizes over derived worksheets (K3)", () => {
  it("a derived worksheet sourced from the touched dataset is downstream, and so is its fit", () => {
    const datasets = [
      ds("a"),
      ds("b", { derivedFrom: { datasetId: "a", pipeline: "flatten" }, fitSpec: { model: "Linear" } }),
    ];
    const down = downstreamOf(datasets, "a");
    expect(down.datasets).toEqual(["b"]);
    expect(down.fits).toEqual(["b"]); // a itself has no fitSpec here
  });

  it("chains through a derived worksheet to whatever bgRef-subtracts it", () => {
    const datasets = [
      ds("a"),
      ds("b", { derivedFrom: { datasetId: "a", pipeline: "flatten" } }),
      ds("c", { raw: data, corrections: {}, bgRef: { datasetId: "b", interp: "linear" } }),
    ];
    const down = downstreamOf(datasets, "a");
    expect(down.datasets).toEqual(["b", "c"]);
  });
});

// LIBRARY_WORKBOOK_UX_PLAN PR K, K4: write-time cycle rejection.
describe("wouldCreateCycle", () => {
  it("returns null for an edge that creates no cycle", () => {
    const datasets = [ds("a"), ds("b")];
    expect(wouldCreateCycle(datasets, { from: recalcNodes.dataset("a"), to: recalcNodes.dataset("b") })).toBeNull();
  });

  it("rejects a direct self-loop with a clear explanation naming the node", () => {
    const reason = wouldCreateCycle([ds("a")], {
      from: recalcNodes.dataset("a"),
      to: recalcNodes.dataset("a"),
    });
    expect(reason).toMatch(/cannot depend on itself/);
    expect(reason).toContain("a");
  });

  // The exact scenario recalc.test.ts's "ignores bgRef holders without
  // corrections+raw, and is cycle-safe" pins as CONSTRUCTIBLE AT THE
  // TRAVERSAL layer today (downstreamOf just stops at the cycle) — K4
  // requires this be REFUSED before it's ever written. B already subtracts
  // A (an already-applied bgRef); proposing A subtracts B closes the loop.
  it("rejects the A<->B bgRef cycle recalc.test.ts documents as constructible via traversal", () => {
    const datasets = [
      ds("a", { raw: data, corrections: {} }), // about to gain bgRef -> b
      ds("b", { raw: data, corrections: {}, bgRef: { datasetId: "a", interp: "linear" } }),
    ];
    const reason = wouldCreateCycle(datasets, {
      from: recalcNodes.dataset("b"),
      to: recalcNodes.dataset("a"),
    });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/circular dependency/);
    expect(reason).toContain("a");
    expect(reason).toContain("b");
  });

  it("rejects a 3-hop bgRef cycle (A already <- B <- C; proposing C <- A closes it)", () => {
    // a's bgRef is b (a subtracts b), b's bgRef is c (b subtracts c) — the
    // existing chain is c -> b -> a. Proposing c's OWN background be a
    // would close a -> c -> b -> a.
    const datasets = [
      ds("a", { raw: data, corrections: {}, bgRef: { datasetId: "b", interp: "linear" } }),
      ds("b", { raw: data, corrections: {}, bgRef: { datasetId: "c", interp: "linear" } }),
      ds("c", { raw: data, corrections: {} }), // about to gain bgRef -> a
    ];
    // A genuinely unrelated proposal on the same fixture is accepted (sanity
    // check the rejection below isn't a false positive from an overly broad
    // walk): an UNCONNECTED 4th dataset has no path to/from anything here.
    const withSpare = [...datasets, ds("spare")];
    expect(
      wouldCreateCycle(withSpare, { from: recalcNodes.dataset("spare"), to: recalcNodes.dataset("c") }),
    ).toBeNull();

    const reason = wouldCreateCycle(datasets, {
      from: recalcNodes.dataset("a"),
      to: recalcNodes.dataset("c"),
    });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/circular dependency/);
  });

  it("rejects a self-referencing computed column (col -> itself)", () => {
    // A dataset with one base column (A) and one existing formula column
    // (letter B, position 1) whose expr is being edited to reference "B" —
    // itself.
    const formulas: ComputedColumn[] = [{ name: "doubled", expr: "A * 2" }];
    const d: Dataset = {
      id: "d1",
      name: "d1",
      data: { time: [0, 1], values: [[1, 2], [2, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
      formulas,
    };
    const reason = wouldCreateCycle([d], {
      from: recalcNodes.column("d1", "B"),
      to: recalcNodes.column("d1", "B"),
    });
    expect(reason).toMatch(/cannot depend on itself/);
  });

  it("rejects a real 2-column formula cycle (a later column already depends on this one)", () => {
    // Base column A only. Formula 0 -> letter B ("B" = A*2). Formula 1 ->
    // letter C ("C" = B + 1, i.e. C already depends on B). Now widening
    // formula 0 (B) to depend on C would close B -> C -> B.
    const formulas: ComputedColumn[] = [
      { name: "b", expr: "A * 2", deps: ["A"] },
      { name: "c", expr: "B + 1", deps: ["B"] },
    ];
    const d: Dataset = {
      id: "d1",
      name: "d1",
      data: {
        time: [0, 1],
        values: [[1, 2, 3], [2, 4, 5]],
        labels: ["A", "B", "C"],
        units: ["", "", ""],
        metadata: {},
      },
      formulas,
    };
    const reason = wouldCreateCycle([d], {
      from: recalcNodes.column("d1", "C"),
      to: recalcNodes.column("d1", "B"),
    });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/circular dependency/);
  });

  it("legacy columns without `deps` degrade — the cycle graph re-derives deps from expr", () => {
    // Same shape as the previous test but WITHOUT the `deps` field (a
    // pre-K2 column) — wouldCreateCycle must still catch the cycle by
    // re-deriving deps via referencedColumns, never throwing.
    const formulas: ComputedColumn[] = [
      { name: "b", expr: "A * 2" }, // no deps
      { name: "c", expr: "B + 1" }, // no deps
    ];
    const d: Dataset = {
      id: "d1",
      name: "d1",
      data: {
        time: [0, 1],
        values: [[1, 2, 3], [2, 4, 5]],
        labels: ["A", "B", "C"],
        units: ["", "", ""],
        metadata: {},
      },
      formulas,
    };
    const reason = wouldCreateCycle([d], {
      from: recalcNodes.column("d1", "C"),
      to: recalcNodes.column("d1", "B"),
    });
    expect(reason).not.toBeNull();
  });

  it("rejects a derivedFrom cycle (sheet B sourced from A, A proposed to be sourced from B)", () => {
    // b is already derived from a (ds:a -> sheet:b -> ds:b, so ds:a already
    // reaches ds:b). A future derivedFrom setter (LIBRARY_WORKBOOK_UX_PLAN
    // PR K slice 2) checks the SAME ds->ds shape a bgRef edge would use —
    // the sheet:/ds: chaining inside buildEdges makes the two equivalent
    // cycle risks. Proposing a's OWN source be b closes ds:b -> ds:a -> ds:b.
    const datasets = [ds("a"), ds("b", { derivedFrom: { datasetId: "a", pipeline: "flatten" } })];
    const reason = wouldCreateCycle(datasets, {
      from: recalcNodes.dataset("b"),
      to: recalcNodes.dataset("a"),
    });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/circular dependency/);
  });
});
