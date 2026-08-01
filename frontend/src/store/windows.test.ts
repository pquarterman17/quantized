// PLOT_WORKFLOW_PLAN item 2: datasetViewDefaults' technique-defaults wiring.
// Other windows.ts behavior (focus/close/minimize/tile/…) is exercised via
// useApp.test.ts / exportParity2.test.ts; this file is scoped to the new
// technique-driven axis-scale reset added on top of the existing (unchanged)
// channel-keyed reset.

import { describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { datasetViewDefaults } from "./windows";

function ds(technique: string, metadataExtra: Record<string, unknown> = {}): Dataset {
  return {
    id: "d1",
    name: "test",
    data: {
      time: [0, 1, 2],
      values: [[1], [2], [3]],
      labels: ["Y"],
      units: [""],
      metadata: { technique, ...metadataExtra },
    },
  };
}

describe("datasetViewDefaults — technique defaults apply with no prevDs (import/split/reimport)", () => {
  it("XRD gets log-y", () => {
    expect(datasetViewDefaults(ds("xrd.powder")).yScale).toBe("log");
  });

  it("SIMS and RSM also get log-y", () => {
    expect(datasetViewDefaults(ds("sims")).yScale).toBe("log");
    expect(datasetViewDefaults(ds("xrd.rsm")).yScale).toBe("log");
  });

  it("magnetometry/transport are explicitly linear", () => {
    expect(datasetViewDefaults(ds("magnetometry.mvsh")).yScale).toBe("linear");
    expect(datasetViewDefaults(ds("magnetometry.mvst")).yScale).toBe("linear");
    expect(datasetViewDefaults(ds("transport")).yScale).toBe("linear");
  });

  it("generic keeps the density heuristic -- no axis-scale opinion, yKeys still delegates downstream", () => {
    const patch = datasetViewDefaults(ds("generic"));
    expect(patch.yScale).toBeUndefined();
    expect(patch.xScale).toBeUndefined();
    expect(patch.yKeys).toBeNull(); // lib/plotdata.ts's defaultDenseChannels resolves this
  });

  it("an unrecognized technique tag also falls back to generic (never guesses)", () => {
    expect(datasetViewDefaults(ds("some.future.tag")).yScale).toBeUndefined();
  });

  it("ncnr reflectometry keeps its default_value_channels channel hint AND gets log R", () => {
    const reflDs = ds("reflectometry", { default_value_channels: [0, 2] });
    const patch = datasetViewDefaults(reflDs);
    expect(patch.yScale).toBe("log"); // the new axis-scale default
    expect(patch.yKeys).toBeNull(); // untouched -- the hint still resolves through plotdata.ts
    expect(reflDs.data.metadata.default_value_channels).toEqual([0, 2]); // hint itself is untouched
  });
});

describe("datasetViewDefaults — technique-change gating (log axes survive a same-technique switch)", () => {
  it("does not reapply the technique default on a same-technique switch", () => {
    const prev = ds("xrd.powder");
    const next = ds("xrd.powder");
    // A manual override (or the technique default itself) on the current view
    // is left alone -- datasetViewDefaults contributes no yScale key at all.
    expect(datasetViewDefaults(next, prev).yScale).toBeUndefined();
  });

  it("reapplies the technique default on a genuine technique change", () => {
    const prev = ds("magnetometry.mvsh"); // linear
    const next = ds("xrd.powder"); // log
    expect(datasetViewDefaults(next, prev).yScale).toBe("log");
  });

  it("an omitted prevDs (fresh import/split/reimport) always counts as a change", () => {
    expect(datasetViewDefaults(ds("xrd.powder"), undefined).yScale).toBe("log");
  });
});
