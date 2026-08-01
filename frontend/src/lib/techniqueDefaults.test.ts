// PLOT_WORKFLOW_PLAN item 2: the standard-plot defaults table.

import { describe, expect, it } from "vitest";

import { isTechniqueChange, techniqueOf, techniqueViewDefaults } from "./techniqueDefaults";
import type { Dataset } from "./types";

function ds(technique: unknown, metadataExtra: Record<string, unknown> = {}): Dataset {
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

describe("techniqueOf", () => {
  it("reads a recognized technique tag verbatim", () => {
    expect(techniqueOf(ds("xrd.powder"))).toBe("xrd.powder");
    expect(techniqueOf(ds("magnetometry.mvsh"))).toBe("magnetometry.mvsh");
  });

  it("falls back to generic for a missing dataset", () => {
    expect(techniqueOf(undefined)).toBe("generic");
  });

  it("falls back to generic when metadata carries no technique field", () => {
    const d: Dataset = {
      id: "d1",
      name: "t",
      data: { time: [0], values: [[1]], labels: ["Y"], units: [""], metadata: {} },
    };
    expect(techniqueOf(d)).toBe("generic");
  });

  it("falls back to generic for an unrecognized string -- never guesses", () => {
    expect(techniqueOf(ds("some.future.tag"))).toBe("generic");
  });

  it("falls back to generic for a non-string technique value", () => {
    expect(techniqueOf(ds(42))).toBe("generic");
  });
});

describe("techniqueViewDefaults", () => {
  it.each([
    ["xrd.powder", "log"],
    ["xrd.rsm", "log"],
    ["sims", "log"],
    ["reflectometry", "log"],
    ["magnetometry.mvsh", "linear"],
    ["magnetometry.mvst", "linear"],
    ["transport", "linear"],
  ] as const)("%s -> yScale %s (the MATLAB/reflectometry defaults)", (technique, expected) => {
    expect(techniqueViewDefaults(ds(technique)).yScale).toBe(expected);
  });

  it("spectroscopy and generic carry no axis-scale opinion", () => {
    expect(techniqueViewDefaults(ds("spectroscopy"))).toEqual({});
    expect(techniqueViewDefaults(ds("generic"))).toEqual({});
  });

  it("reflectometry's log-R default coexists with the default_value_channels hint (subsumes, not fights)", () => {
    const reflDs = ds("reflectometry", { default_value_channels: [0, 2] });
    expect(techniqueViewDefaults(reflDs)).toEqual({ yScale: "log" });
    // The channel hint itself is untouched -- lib/plotdata.ts's
    // defaultDenseChannels is the sole reader of it.
    expect(reflDs.data.metadata.default_value_channels).toEqual([0, 2]);
  });
});

describe("isTechniqueChange", () => {
  it("true when prevDs is undefined (fresh import/split/reimport)", () => {
    expect(isTechniqueChange(ds("xrd.powder"), undefined)).toBe(true);
  });

  it("false for a same-technique switch", () => {
    expect(isTechniqueChange(ds("xrd.powder"), ds("xrd.powder"))).toBe(false);
  });

  it("true for a genuine technique change", () => {
    expect(isTechniqueChange(ds("xrd.powder"), ds("magnetometry.mvsh"))).toBe(true);
  });
});
