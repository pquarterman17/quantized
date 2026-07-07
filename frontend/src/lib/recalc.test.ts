// lib/recalc — the #1 dependency graph: bgRef chains + fit nodes.

import { describe, expect, it } from "vitest";

import { downstreamOf, markStale } from "./recalc";
import type { Dataset, DataStruct } from "./types";

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
