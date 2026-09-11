// lib/statschooser — group building, run-request dispatch, result flattening (#26).

import { describe, expect, it } from "vitest";

import { resolveCategoryLabels } from "./barlayout";
import {
  buildRunRequest,
  groupsByCategory,
  groupsByCategoryIndexed,
  groupsFromColumns,
  reportRecord,
  resultRows,
} from "./statschooser";
import type { DataStruct } from "./types";

const DATA: DataStruct = {
  time: [1, 2, 3, 4, 5, 6],
  values: [
    [10, 0],
    [11, 0],
    [Number.NaN, 0],
    [20, 1],
    [21, 1],
    [22, 1],
  ],
  labels: ["signal", "batch"],
  units: ["V", ""],
  metadata: { x_column_name: "T" },
};

describe("groupsFromColumns", () => {
  it("one group per column, finite values only, labelled from labels/x-name", () => {
    const gs = groupsFromColumns(DATA, [-1, 0]);
    expect(gs.map((g) => g.label)).toEqual(["T", "signal"]);
    expect(gs[0].values).toEqual([1, 2, 3, 4, 5, 6]);
    expect(gs[1].values).toEqual([10, 11, 20, 21, 22]); // NaN dropped
  });
});

describe("groupsByCategory", () => {
  it("partitions the value column by category levels in ascending order", () => {
    const gs = groupsByCategory(DATA, 0, 1);
    expect(gs.map((g) => g.label)).toEqual(["batch = 0", "batch = 1"]);
    expect(gs[0].values).toEqual([10, 11]); // NaN pair dropped
    expect(gs[1].values).toEqual([20, 21, 22]);
  });

  it("uses imported categorical names in both statistical grouping paths", () => {
    const categorical: DataStruct = {
      ...DATA,
      cat_levels: { 1: ["Reference", "Annealed"] },
    };
    expect(groupsByCategory(categorical, 0, 1).map((g) => g.label)).toEqual([
      "batch = Reference",
      "batch = Annealed",
    ]);
    expect(groupsByCategoryIndexed(categorical, 0, 1).map((g) => g.label)).toEqual([
      "batch = Reference",
      "batch = Annealed",
    ]);
  });

  it("labels an Origin text-column categorical the same way Data Filter and Tabulate do", () => {
    // A channel is categorical whenever `channelModelingType` says so — which
    // includes a `channelTypes` override and `inferModelingType`, not just a
    // P1.4 level table. An Origin `.opj` import is exactly that shape: numeric
    // codes plus `origin_text_columns`, NO `cat_levels`. Reading only the level
    // table (`categorical.groupLevelLabel`) printed "batch = 0" here while
    // Data Filter and Tabulate printed "Reference" for the same column — the
    // divergence this shares its resolver with them to prevent.
    const origin: DataStruct = {
      ...DATA,
      metadata: {
        ...DATA.metadata,
        origin_text_columns: {
          "1": ["Reference", "Reference", "Reference", "Annealed", "Annealed", "Annealed"],
        },
      },
    };
    const viaStats = groupsByCategory(origin, 0, 1).map((g) => g.label);
    // The same labels the shared resolver hands Data Filter / Tabulate.
    const viaSharedResolver = resolveCategoryLabels(origin, 1, [0, 1])
      .map((text) => `batch = ${text}`);
    expect(viaStats).toEqual(viaSharedResolver);
    expect(viaStats).toEqual(["batch = Reference", "batch = Annealed"]);
  });
});

describe("groupsByCategory honours the user's level ORDER (JMP_GAP J1)", () => {
  // The defect: box/violin/strip axis slots came from a private
  // `new Map(...).sort((a, b) => a[0] - b[0])`, i.e. ALWAYS ascending by raw
  // code, while every other order-sensitive surface went through
  // `lib/categorical.categoryLevels` and honoured `level_order` — bar layout,
  // the XY group split, Tabulate, facets, and the backend's own
  // `_ordered_levels` for an exported PDF. So a user who reordered levels saw
  // the bar chart and the export obey and the box plot silently not.
  //
  // The chokepoint guard in architecture.test.ts exists to prevent exactly this
  // ("a private copy would keep sorting by raw code while every other surface
  // honoured the user's order") and MISSED it twice over: it anchors on
  // `new Set` (this used `new Map`) and its comparator pattern only matched a
  // bare `a - b` (this was `a[0] - b[0]`). Both are widened in this change.
  const ordered: DataStruct = {
    ...DATA,
    cat_levels: { 1: ["Reference", "Annealed"] },
    level_order: { 1: [1, 0] },
  };

  it("puts the groups in the user's order, values following their labels", () => {
    const gs = groupsByCategory(ordered, 0, 1);
    expect(gs.map((g) => g.label)).toEqual(["batch = Annealed", "batch = Reference"]);
    // The VALUES must travel with their label, not just the label list reorder.
    expect(gs[0].values).toEqual([20, 21, 22]);
    expect(gs[1].values).toEqual([10, 11]);
  });

  it("reorders the INDEXED path identically — jitter points must not detach", () => {
    // `groupsByCategoryIndexed` feeds the raw-point overlay, which hashes
    // (rowIndex, category). If the two paths ordered differently, a box would
    // sit over another category's points.
    const gs = groupsByCategoryIndexed(ordered, 0, 1);
    expect(gs.map((g) => g.label)).toEqual(["batch = Annealed", "batch = Reference"]);
    expect(gs[0].points.map((pt) => pt.rowIndex)).toEqual([3, 4, 5]);
    expect(gs[1].points.map((pt) => pt.rowIndex)).toEqual([0, 1]);
  });

  it("still ascends when the dataset carries no order (the previous behaviour)", () => {
    expect(groupsByCategory(DATA, 0, 1).map((g) => g.label)).toEqual([
      "batch = 0",
      "batch = 1",
    ]);
  });

  it("FAILS OPEN on a partial order: named levels first, the rest ascending", () => {
    // categoryLevels' load-bearing rule. A level that appeared after the order
    // was saved must still get a box rather than hide behind a stale preference.
    const three: DataStruct = {
      time: [1, 2, 3],
      values: [
        [10, 0],
        [20, 1],
        [30, 2],
      ],
      labels: ["signal", "batch"],
      units: ["V", ""],
      metadata: {},
      level_order: { 1: [2] },
    };
    const gs = groupsByCategory(three, 0, 1);
    expect(gs.map((g) => g.values)).toEqual([[30], [10], [20]]);
  });

  it("does not invent a group for an ordered level the data no longer has", () => {
    const stale: DataStruct = { ...DATA, level_order: { 1: [9, 1, 0] } };
    expect(groupsByCategory(stale, 0, 1)).toHaveLength(2);
    expect(groupsByCategory(stale, 0, 1)[0].values).toEqual([20, 21, 22]);
  });
});

describe("buildRunRequest", () => {
  const g2 = [
    [1, 2, 3],
    [4, 5, 6],
  ];

  it("routes one group to a one-sample t-test vs mu=0", () => {
    expect(buildRunRequest("/api/stats/ttest", [g2[0]], false)).toEqual({
      path: "/api/stats/ttest",
      body: { x: g2[0], mu: 0 },
    });
  });

  it("routes two groups to paired / Welch t-test per the paired flag", () => {
    expect(buildRunRequest("/api/stats/ttest", g2, true)?.body).toEqual({
      x: g2[0],
      y: g2[1],
      paired: true,
    });
    expect(buildRunRequest("/api/stats/ttest", g2, false)?.body).toEqual({
      x: g2[0],
      y: g2[1],
      paired: false,
    });
  });

  it("covers the nonparametric endpoints and k-group tests", () => {
    expect(buildRunRequest("/api/stats/mann-whitney", g2, false)?.body).toEqual({
      x: g2[0],
      y: g2[1],
    });
    expect(buildRunRequest("/api/stats/wilcoxon", [g2[0]], false)?.body).toEqual({
      x: g2[0],
      mu: 0,
    });
    expect(buildRunRequest("/api/stats/anova", g2, false)?.body).toEqual({ groups: g2 });
    expect(buildRunRequest("/api/stats/kruskal", g2, false)?.body).toEqual({ groups: g2 });
  });

  it("returns null on an unknown endpoint (frontend/backend drift guard)", () => {
    expect(buildRunRequest("/api/stats/nope", g2, false)).toBeNull();
  });
});

describe("resultRows / reportRecord", () => {
  it("keeps scalars, drops arrays/objects/long strings", () => {
    const rows = resultRows({
      t: 2.5,
      p: 0.03,
      significant: true,
      note: "reject H0",
      ci: [1, 2],
      nested: { a: 1 },
      essay: "x".repeat(100),
    });
    expect(rows).toEqual([
      ["t", 2.5],
      ["p", 0.03],
      ["significant", "true"],
      ["note", "reject H0"],
    ]);
    expect(reportRecord("Welch t-test", { t: 2.5 })).toEqual({
      test: "Welch t-test",
      t: 2.5,
    });
  });
});
