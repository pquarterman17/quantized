// lib/statschooser — group building, run-request dispatch, result flattening (#26).

import { describe, expect, it } from "vitest";

import {
  buildRunRequest,
  groupsByCategory,
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
