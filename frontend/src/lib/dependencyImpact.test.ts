// LIBRARY_WORKBOOK_UX_PLAN PR M (L0.45 + L0.55): the shared impact-preview
// computation both reimport and delete gate on.

import { describe, expect, it } from "vitest";

import { computeDependencyImpact, formatDependencyImpact, hasDependencyImpact } from "./dependencyImpact";
import type { Dataset, DataStruct } from "./types";

const data: DataStruct = { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} };

const ds = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name: id,
  data,
  ...over,
});

describe("computeDependencyImpact", () => {
  it("is empty for a source with no dependents", () => {
    const impact = computeDependencyImpact([ds("a")], ["a"]);
    expect(impact).toEqual({ affectedDatasetNames: [], affectedFitNames: [] });
    expect(hasDependencyImpact(impact)).toBe(false);
  });

  it("finds a bgRef-chained dependent and its fit, by NAME", () => {
    const datasets = [
      ds("a", { name: "Source" }),
      ds("b", {
        name: "Corrected",
        raw: data,
        corrections: { yOff: 1 },
        bgRef: { datasetId: "a", interp: "linear" },
        fitSpec: { model: "Linear" },
      }),
    ];
    const impact = computeDependencyImpact(datasets, ["a"]);
    expect(impact.affectedDatasetNames).toEqual(["Corrected"]);
    expect(impact.affectedFitNames).toEqual(["Corrected"]);
    expect(hasDependencyImpact(impact)).toBe(true);
  });

  it("finds a derived worksheet", () => {
    const datasets = [
      ds("a", { name: "Source" }),
      ds("b", { name: "Derived", derivedFrom: { datasetId: "a", pipeline: "x" } }),
    ];
    const impact = computeDependencyImpact(datasets, ["a"]);
    expect(impact.affectedDatasetNames).toEqual(["Derived"]);
  });

  it("excludes other members of the source set from the affected list", () => {
    // b is derived from a, but BOTH a and b are being deleted together
    // (a workbook's member ids) — b is not a "dependent" in this preview,
    // it's part of the thing being removed.
    const datasets = [
      ds("a", { name: "Source" }),
      ds("b", { name: "Derived", derivedFrom: { datasetId: "a", pipeline: "x" } }),
    ];
    const impact = computeDependencyImpact(datasets, ["a", "b"]);
    expect(impact.affectedDatasetNames).toEqual([]);
  });

  it("excludes a source member's OWN fit when `removed: true` (delete path — review round P2)", () => {
    // d1 (a workbook member) owns its own saved fit. Deleting the workbook
    // destroys d1 AND its fit together — the fit must not be reported as
    // something that will merely go stale (it won't exist to go stale).
    const datasets = [
      ds("d1", { name: "d1.dat", fitSpec: { model: "Linear" } }),
      ds("d2", { name: "d2.dat" }),
    ];
    const impact = computeDependencyImpact(datasets, ["d1", "d2"], { removed: true });
    expect(impact.affectedFitNames).toEqual([]);
  });

  it("still reports the source's OWN fit when NOT removed — the reimport survives (review round P2 asymmetry)", () => {
    // Same shape as above, but this is the reimport call: the dataset
    // SURVIVES with fresh data, so its own saved fit correctly goes stale
    // and belongs in the preview — the opposite of the delete case above.
    const datasets = [ds("d1", { name: "d1.dat", fitSpec: { model: "Linear" } })];
    const impact = computeDependencyImpact(datasets, ["d1"]);
    expect(impact.affectedFitNames).toEqual(["d1.dat"]);
  });

  it("unions and dedupes across multiple source ids sharing a dependent", () => {
    const datasets = [
      ds("a"),
      ds("b"),
      ds("c", {
        name: "SharedFit",
        derivedFrom: { datasetId: "a", pipeline: "x" },
        fitSpec: { model: "Linear" },
      }),
    ];
    // c is only actually reachable from "a" (its real source) here, but a
    // caller passing both a and b as sourceIds must not double-count it.
    const impact = computeDependencyImpact(datasets, ["a", "b"]);
    expect(impact.affectedDatasetNames).toEqual(["SharedFit"]);
    expect(impact.affectedFitNames).toEqual(["SharedFit"]);
  });
});

describe("formatDependencyImpact", () => {
  it("is empty for no impact", () => {
    expect(formatDependencyImpact({ affectedDatasetNames: [], affectedFitNames: [] })).toBe("");
  });

  it("pluralizes correctly and names every affected item", () => {
    const msg = formatDependencyImpact({ affectedDatasetNames: ["X"], affectedFitNames: ["Y", "Z"] });
    expect(msg).toContain("1 dependent worksheet (X)");
    expect(msg).toContain("2 fits (Y, Z)");
    expect(msg).toMatch(/marked stale/);
  });
});
