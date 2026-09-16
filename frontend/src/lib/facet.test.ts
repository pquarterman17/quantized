import { describe, expect, it } from "vitest";

import { breakPanelsOf, facetPanelsOf } from "./composition";
import {
  breakCompositionFromBreaks,
  breakPayloads,
  durableComposition,
  facetCompositionFromBinding,
  facetPayloads,
  facetSlices,
  sharedXDomain,
  sharedYDomain,
  suggestBreaks,
  type BreakPanel,
  type FacetPanel,
} from "./facet";
import type { PlotPayload } from "./plotdata";
import type { DataStruct, Dataset } from "./types";

describe("facetPayloads", () => {
  const ds: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [
      [1, 10],
      [1, 20],
      [2, 30],
      [2, 40],
      [1, 50],
      [2, 60],
    ],
    labels: ["grp", "y"],
    units: ["", ""],
    metadata: {},
  };

  it("splits into one panel per distinct facet level, ascending", () => {
    const panels = facetPayloads(ds, 0, null, [1]);
    expect(panels).toHaveLength(2);
    expect(panels[0].label).toBe("1");
    expect(panels[1].label).toBe("2");
  });

  it("each panel's payload contains ONLY rows at that level", () => {
    const panels = facetPayloads(ds, 0, null, [1]);
    // level 1: rows 0,1,4 -> time [0,1,4], y [10,20,50]
    expect(panels[0].payload.data[0]).toEqual([0, 1, 4]);
    expect(panels[0].payload.data[1]).toEqual([10, 20, 50]);
    // level 2: rows 2,3,5 -> time [2,3,5], y [30,40,60]
    expect(panels[1].payload.data[0]).toEqual([2, 3, 5]);
    expect(panels[1].payload.data[1]).toEqual([30, 40, 60]);
  });

  it("uses the resolved category label (text column) when present", () => {
    const withLabels: DataStruct = {
      ...ds,
      metadata: { origin_text_columns: { C: ["North", "North", "South", "South", "North", "South"] } },
    };
    const panels = facetPayloads(withLabels, 0, null, [1]);
    expect(panels.map((p) => p.label)).toEqual(["North", "South"]);
  });

  it("returns [] when the facet column has no finite levels", () => {
    const allNaN: DataStruct = { ...ds, values: ds.values.map((r) => [NaN, r[1]]) };
    expect(facetPayloads(allNaN, 0, null, [1])).toEqual([]);
  });

  it("supports channel<0 (facet by the x/time column itself)", () => {
    const small: DataStruct = {
      time: [1, 1, 2],
      values: [[10], [20], [30]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const panels = facetPayloads(small, -1, null, [0]);
    expect(panels).toHaveLength(2);
    expect(panels[0].payload.data[1]).toEqual([10, 20]);
    expect(panels[1].payload.data[1]).toEqual([30]);
  });
});

// facetSlices (GUI_INTERACTION #11): the row-slicing primitive facetPayloads
// now builds on. facetPayloads' OWN describe block above is left completely
// unmodified — it must keep passing byte-for-byte as a behavior-unchanged
// regression check on the refactor.
describe("facetSlices", () => {
  const ds: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [
      [1, 10],
      [1, 20],
      [2, 30],
      [2, 40],
      [1, 50],
      [2, 60],
    ],
    labels: ["grp", "y"],
    units: ["", ""],
    metadata: {},
  };

  it("splits into one row-sliced DataStruct per distinct level, ascending", () => {
    const slices = facetSlices(ds, 0);
    expect(slices).toHaveLength(2);
    expect(slices[0].label).toBe("1");
    expect(slices[1].label).toBe("2");
  });

  it("each slice's data contains ONLY rows at that level", () => {
    const slices = facetSlices(ds, 0);
    expect(slices[0].data.time).toEqual([0, 1, 4]);
    expect(slices[0].data.values).toEqual([[1, 10], [1, 20], [1, 50]]);
    expect(slices[1].data.time).toEqual([2, 3, 5]);
    expect(slices[1].data.values).toEqual([[2, 30], [2, 40], [2, 60]]);
  });

  it("uses the resolved category label (text column) when present", () => {
    const withLabels: DataStruct = {
      ...ds,
      metadata: { origin_text_columns: { C: ["North", "North", "South", "South", "North", "South"] } },
    };
    const slices = facetSlices(withLabels, 0);
    expect(slices.map((s) => s.label)).toEqual(["North", "South"]);
  });

  it("returns [] when the facet column has no finite levels", () => {
    const allNaN: DataStruct = { ...ds, values: ds.values.map((r) => [NaN, r[1]]) };
    expect(facetSlices(allNaN, 0)).toEqual([]);
  });

  it("rows with a non-finite facet value belong to no slice", () => {
    const mixed: DataStruct = { ...ds, values: [[1, 10], [NaN, 20], [2, 30]], time: [0, 1, 2] };
    const slices = facetSlices(mixed, 0);
    expect(slices).toHaveLength(2);
    expect(slices.flatMap((s) => s.data.time)).toEqual([0, 2]); // row 1 (NaN) dropped everywhere
  });

  it("supports channel<0 (facet by the x/time column itself)", () => {
    const small: DataStruct = {
      time: [1, 1, 2],
      values: [[10], [20], [30]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const slices = facetSlices(small, -1);
    expect(slices).toHaveLength(2);
    expect(slices[0].data.time).toEqual([1, 1]);
    expect(slices[1].data.time).toEqual([2]);
  });

  it("preserves every other DataStruct field verbatim (labels/units/metadata)", () => {
    const slices = facetSlices(ds, 0);
    expect(slices[0].data.labels).toBe(ds.labels);
    expect(slices[0].data.units).toBe(ds.units);
    // BUG-006 changed this from reference identity to VALUE equality, and the
    // distinction is the fix: `metadata` is no longer carried by reference,
    // because its row-indexed sidecars (`text_columns` &c.) have to be sliced to
    // the same rows. Content is unchanged for a dataset that carries none —
    // which is what this asserts. Nothing may rely on the old aliasing; the
    // codebase is copy-on-write throughout.
    expect(slices[0].data.metadata).toEqual(ds.metadata);
  });
});

describe("suggestBreaks", () => {
  it("detects a single large gap relative to the typical spacing", () => {
    // Typical spacing 1 throughout; one gap of 51 between 9 and 60.
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 60, 61, 62, 63];
    const breaks = suggestBreaks(xs);
    expect(breaks).toEqual([[9, 60]]);
  });

  it("returns [] for evenly-spaced data (no gap stands out)", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    expect(suggestBreaks(xs)).toEqual([]);
  });

  it("returns [] with fewer than 3 finite points", () => {
    expect(suggestBreaks([1, 2])).toEqual([]);
    expect(suggestBreaks([])).toEqual([]);
  });

  it("ignores non-finite values and works on unsorted input", () => {
    const xs = [63, NaN, 0, 62, 9, 8, 7, 6, 5, 4, 3, 2, 1, 61, 60, Infinity];
    const breaks = suggestBreaks(xs);
    expect(breaks).toEqual([[9, 60]]);
  });

  it("detects multiple qualifying gaps", () => {
    const xs = [0, 1, 2, 20, 21, 22, 100, 101, 102];
    const breaks = suggestBreaks(xs, 3);
    expect(breaks).toEqual([
      [2, 20],
      [22, 100],
    ]);
  });
});

describe("sharedXDomain", () => {
  const panel = (xs: (number | null)[]): FacetPanel => ({
    label: "l",
    payload: {
      data: [xs, xs.map(() => 1)] as PlotPayload["data"],
      series: [{ label: "y", unit: "", axis: 0 }],
      xLabel: "x",
      xUnit: "",
    },
  });

  it("unions the finite x-range across every panel", () => {
    expect(sharedXDomain([panel([0, 1, 2]), panel([5, 10])])).toEqual([0, 10]);
  });

  it("ignores non-finite values within a panel", () => {
    expect(sharedXDomain([panel([NaN, 1, Infinity, 2]), panel([-1, 3])])).toEqual([-1, 3]);
  });

  it("returns null when no panel has any finite x value", () => {
    expect(sharedXDomain([panel([NaN, null]), panel([])])).toBeNull();
  });

  it("returns null for an empty panel set", () => {
    expect(sharedXDomain([])).toBeNull();
  });

  it("handles a single panel (domain = that panel's own range)", () => {
    expect(sharedXDomain([panel([3, 1, 2])])).toEqual([1, 3]);
  });
});

describe("breakPayloads", () => {
  const ds: DataStruct = {
    time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 60, 61, 62, 63],
    values: Array.from({ length: 14 }, (_, i) => [i * 10]),
    labels: ["y"],
    units: [""],
    metadata: {},
  };
  const oneBreak: [number, number][] = [[9, 60]];

  it("splits a single gap into two contiguous panels", () => {
    const panels = breakPayloads(ds, null, [0], oneBreak);
    expect(panels).toHaveLength(2);
    expect(panels[0].payload.data[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(panels[1].payload.data[0]).toEqual([60, 61, 62, 63]);
  });

  it("each panel's xRange is its own break bound, not the full data span", () => {
    const panels = breakPayloads(ds, null, [0], oneBreak);
    expect(panels[0].xRange).toEqual([0, 9]);
    expect(panels[1].xRange).toEqual([60, 63]);
  });

  // BUG-012 review F2: the panel's x-domain is the BREAK BOUND, clamped to
  // the data extent -- exactly `calc/figure_break.render_breaks_impl`'s
  // `bounds` list, which the export then applies with `ax.set_xlim` and sizes
  // its panels by (`width_ratios=[hi - lo]`). It used to be the segment's own
  // min/max data x, which coincides ONLY when the break endpoints are
  // themselves data points.
  it("derives xRange from break endpoints that are NOT data points (screen ≡ export)", () => {
    const grid: DataStruct = {
      time: [0, 1, 2, 3, 4, 5],
      values: Array.from({ length: 6 }, (_unused, i) => [i * 10]),
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const panels = breakPayloads(grid, null, [0], [[2.2, 2.8]]);
    // Row membership is unchanged (x <= 2.2 | x >= 2.8) -- only the domains move.
    expect(panels[0].payload.data[0]).toEqual([0, 1, 2]);
    expect(panels[1].payload.data[0]).toEqual([3, 4, 5]);
    expect(panels[0].xRange).toEqual([0, 2.2]);
    expect(panels[1].xRange).toEqual([2.8, 5]);
  });

  it("clamps a break endpoint that sits outside the data range to the data extent", () => {
    // `render_breaks_impl` starts at the data min and ends at the data max
    // whatever the breaks say, so the outermost bounds can never exceed them.
    const grid: DataStruct = {
      time: [10, 11, 12, 13],
      values: Array.from({ length: 4 }, (_unused, i) => [i]),
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const panels = breakPayloads(grid, null, [0], [[11.5, 12.5]]);
    expect(panels.map((p) => p.xRange)).toEqual([
      [10, 11.5],
      [12.5, 13],
    ]);
  });

  it("is a NO-OP for suggestBreaks' own output (the live breakAtGaps gesture)", () => {
    // Every `suggestBreaks` break is `[finite[i], finite[i + 1]]` -- both
    // endpoints ARE data points, so the bounds and the segment extents
    // coincide and the live gesture's panels are untouched by review F2.
    const suggested = suggestBreaks(ds.time);
    expect(suggested).toEqual([[9, 60]]);
    const panels = breakPayloads(ds, null, [0], suggested);
    const segmentExtents = panels.map((p): [number, number] => {
      const xs = (p.payload.data[0] as (number | null)[]).filter((v): v is number => v != null);
      return [Math.min(...xs), Math.max(...xs)];
    });
    expect(panels.map((p) => p.xRange)).toEqual(segmentExtents);
  });

  it("handles multiple breaks (N breaks -> N+1 panels)", () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 20, 21, 22, 100, 101, 102],
      values: Array.from({ length: 9 }, (_, i) => [i]),
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const breaks: [number, number][] = [
      [2, 20],
      [22, 100],
    ];
    const panels = breakPayloads(multi, null, [0], breaks);
    expect(panels).toHaveLength(3);
    expect(panels[0].payload.data[0]).toEqual([0, 1, 2]);
    expect(panels[1].payload.data[0]).toEqual([20, 21, 22]);
    expect(panels[2].payload.data[0]).toEqual([100, 101, 102]);
  });

  it("sorts unsorted breaks before segmenting", () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 20, 21, 22, 100, 101, 102],
      values: Array.from({ length: 9 }, (_, i) => [i]),
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const reversedBreaks: [number, number][] = [
      [22, 100],
      [2, 20],
    ];
    const panels = breakPayloads(multi, null, [0], reversedBreaks);
    expect(panels).toHaveLength(3);
    expect(panels[0].payload.data[0]).toEqual([0, 1, 2]);
  });

  it("drops a segment with no finite rows rather than rendering an empty panel", () => {
    // Break carves out a segment [9, 60] with no data on either side of a third gap.
    const sparse: DataStruct = {
      time: [0, 1, 100, 101],
      values: [[0], [1], [100], [101]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const breaks: [number, number][] = [
      [1, 50],
      [50, 100],
    ];
    const panels = breakPayloads(sparse, null, [0], breaks);
    // middle segment [50,50] has no rows -> dropped, leaving 2 panels.
    expect(panels).toHaveLength(2);
  });

  it("returns [] when breaks is empty", () => {
    expect(breakPayloads(ds, null, [0], [])).toEqual([]);
  });
});

describe("sharedYDomain", () => {
  const panel = (ys: (number | null)[]): BreakPanel => ({
    xRange: [0, ys.length - 1],
    payload: {
      data: [ys.map((_, i) => i), ys] as PlotPayload["data"],
      series: [{ label: "y", unit: "", axis: 0 }],
      xLabel: "x",
      xUnit: "",
    },
  });

  it("unions the finite y-range across every panel's series", () => {
    expect(sharedYDomain([panel([0, 5]), panel([10, -3])])).toEqual([-3, 10]);
  });

  it("ignores non-finite values", () => {
    expect(sharedYDomain([panel([NaN, 1, Infinity]), panel([-2, 3])])).toEqual([-2, 3]);
  });

  it("returns null when no panel has any finite y value", () => {
    expect(sharedYDomain([panel([NaN, null]), panel([])])).toBeNull();
  });

  it("returns null for an empty panel set", () => {
    expect(sharedYDomain([])).toBeNull();
  });

  it("covers multiple series within one panel", () => {
    const twoSeries: BreakPanel = {
      xRange: [0, 1],
      payload: {
        data: [
          [0, 1],
          [5, 6],
          [-10, 2],
        ] as PlotPayload["data"],
        series: [
          { label: "a", unit: "", axis: 0 },
          { label: "b", unit: "", axis: 0 },
        ],
        xLabel: "x",
        xUnit: "",
      },
    };
    expect(sharedYDomain([twoSeries])).toEqual([-10, 6]);
  });
});

// FIGURE_AUTHORING_WORKFLOW_PLAN F4.4: the ONE derivation that rebuilds a
// live facet Composition from the durable `facetKey` binding wherever a
// window's view gets rehydrated (focus switch, workspace reopen, a
// resolved recipe's freshly-focused window).
describe("facetCompositionFromBinding", () => {
  const data: DataStruct = {
    time: [0, 1, 2, 3],
    values: [
      [1, 10],
      [1, 20],
      [2, 30],
      [2, 40],
    ],
    labels: ["grp", "y"],
    units: ["", ""],
    metadata: {},
  };
  const ds: Dataset = { id: "d1", name: "ds1", data };

  it("rebuilds the SAME facet composition facetByColumn would build", () => {
    const composition = facetCompositionFromBinding(ds, 0, null, [1]);
    const panels = facetPanelsOf(composition);
    expect(panels).not.toBeNull();
    expect(panels).toHaveLength(2);
    expect(panels![0].label).toBe("1");
    expect(panels![1].label).toBe("2");
  });

  it("returns null when facetKey is null (an ordinary plot)", () => {
    expect(facetCompositionFromBinding(ds, null, null, [1])).toBeNull();
  });

  it("returns null when there is no dataset to facet", () => {
    expect(facetCompositionFromBinding(undefined, 0, null, [1])).toBeNull();
    expect(facetCompositionFromBinding(null, 0, null, [1])).toBeNull();
  });

  it("returns null (never throws) for an out-of-range facetKey", () => {
    expect(facetCompositionFromBinding(ds, 99, null, [1])).toBeNull();
  });

  it("honors row exclusion (analysisData), same as a fresh facetByColumn gesture", () => {
    const excluded: Dataset = { ...ds, excludedRows: [0, 1] }; // drop every "grp"=1 row
    const composition = facetCompositionFromBinding(excluded, 0, null, [1]);
    const panels = facetPanelsOf(composition);
    expect(panels).toHaveLength(1);
    expect(panels![0].label).toBe("2");
  });
});

// BUG-012 (+ its review round). The two durable builders had NO direct unit
// coverage: both were reached only through the Stage hook, the DOM case and
// the P4.2 matrix testkit (review NIT 15). They are the single derivation the
// canvas, a background window and the matrix's screen leg all share, so they
// are pinned here directly, at the layer they are written in.
describe("breakCompositionFromBreaks", () => {
  const data: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [
      [0, 10],
      [1, 20],
      [2, 30],
      [3, 40],
      [4, 50],
      [5, 60],
    ],
    labels: ["x", "y"],
    units: ["", ""],
    metadata: {},
  };
  const ds: Dataset = { id: "d1", name: "ds1", data };

  it("rebuilds the SAME two-panel arrangement breakAtGaps would build", () => {
    const panels = breakPanelsOf(breakCompositionFromBreaks(ds, [[2, 3]], null, [1]));
    expect(panels).toHaveLength(2);
    expect(panels![0].payload.data[0]).toEqual([0, 1, 2]);
    expect(panels![1].payload.data[0]).toEqual([3, 4, 5]);
  });

  it("threads xKey and yKeys into the panels (both bindings, not just the ranges)", () => {
    // xKey 0 makes channel 0 the axis the break is expressed in; yKeys is a
    // non-default, non-ascending list. Drop either and this fails.
    const panels = breakPanelsOf(breakCompositionFromBreaks(ds, [[2, 3]], 0, [1, 0]));
    expect(panels).toHaveLength(2);
    expect(panels![0].payload.data[0]).toEqual([0, 1, 2]);
    expect(panels![0].payload.series.map((s) => s.label)).toEqual(["y", "x"]);
  });

  it("returns null for no breaks, no dataset, and an empty break list", () => {
    expect(breakCompositionFromBreaks(ds, null, null, [1])).toBeNull();
    expect(breakCompositionFromBreaks(ds, [], null, [1])).toBeNull();
    expect(breakCompositionFromBreaks(null, [[2, 3]], null, [1])).toBeNull();
    expect(breakCompositionFromBreaks(undefined, [[2, 3]], null, [1])).toBeNull();
  });

  it("refuses fewer than two surviving panels -- breakAtGaps' own refusal", () => {
    expect(breakCompositionFromBreaks(ds, [[7, 8]], null, [1])).toBeNull();
  });

  it("honors row exclusion (analysisData), same as a fresh breakAtGaps gesture", () => {
    // Every row above the break is excluded, so only one panel survives and
    // the arrangement is refused -- the screen then draws an ORDINARY plot
    // while an export of the same document still draws a broken axis
    // (`lib/figureSpec.ts` sends `overrides.x_breaks` unconditionally). That
    // divergence is recorded as a residual on BUG-012, not fixed here.
    const excluded: Dataset = { ...ds, excludedRows: [3, 4, 5] };
    expect(breakCompositionFromBreaks(excluded, [[2, 3]], null, [1])).toBeNull();
  });
});

describe("durableComposition", () => {
  const data: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [
      [1, 10],
      [1, 20],
      [1, 30],
      [2, 40],
      [2, 50],
      [2, 60],
    ],
    labels: ["grp", "y"],
    units: ["", ""],
    metadata: {},
  };
  const ds: Dataset = { id: "d1", name: "ds1", data };

  it("builds the facet grid from a facetKey", () => {
    expect(facetPanelsOf(durableComposition(ds, 0, null, null, [1]))).toHaveLength(2);
  });

  it("builds the break panels from saved ranges", () => {
    expect(breakPanelsOf(durableComposition(ds, null, [[2, 3]], null, [1]))).toHaveLength(2);
  });

  // PRECEDENCE, mirroring the export path: `routes/export_figures.py` branches
  // on `if req.facets:` before the flat renderer's `x_breaks` override is ever
  // consulted, and `calc/figure_facets.render_facets_figure` honors an
  // override subset that excludes `x_breaks`.
  it("resolves facet-beats-break when a figure carries BOTH", () => {
    const both = durableComposition(ds, 0, [[2, 3]], null, [1]);
    expect(facetPanelsOf(both)).toHaveLength(2);
    expect(breakPanelsOf(both)).toBeNull();
  });

  it("returns null (an ordinary plot) with neither binding", () => {
    expect(durableComposition(ds, null, null, null, [1])).toBeNull();
    expect(durableComposition(null, 0, [[2, 3]], null, [1])).toBeNull();
  });
});

// BUG-012 review NIT 13: "ONE construction site" is the invariant the fix
// sells -- `breakCompositionFromBreaks`/`breakCompositionFromData` are the
// only places a break arrangement is ever built, which is also what lets
// `Stage/useEffectiveComposition`'s `multiPanelShowing` promise it never
// mounts a one-panel "break" (the `>= 2` refusal lives in that one place).
// Sabotage measured during the review: reintroducing a second, behaviourally
// identical `breakComposition(breakPayloads(...))` in the store left
// 1236/1236 tests green. This ratchets it, in the same `import.meta.glob`
// style `architecture.test.ts` uses -- kept HERE, beside the functions it
// guards, rather than in that file.
describe("break arrangements have ONE construction site (review NIT 13)", () => {
  const modules = import.meta.glob("../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("only lib/facet.ts calls breakComposition()", () => {
    // Non-vacuity: the glob must actually reach outside lib/ (store/, components/).
    expect(Object.keys(modules).filter((p) => p.includes("store/")).length).toBeGreaterThan(20);
    const callers = Object.entries(modules)
      .filter(([p]) => !/\.test\.(ts|tsx)$/.test(p) && !/\.testkit\.ts$/.test(p))
      .filter(([, src]) => /\bbreakComposition\s*\(/.test(src))
      .map(([p]) => p.replace(/^\.\.\//, "").replace(/^\.\//, "lib/"))
      .sort();
    expect(
      callers,
      "build break panels through lib/facet.ts (breakCompositionFromBreaks / breakCompositionFromData); a second builder drifts silently",
    ).toEqual(["lib/composition.ts", "lib/facet.ts"]);
  });
});
