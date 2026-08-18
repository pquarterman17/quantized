import { describe, expect, it } from "vitest";

import { categoricalLevels, isCategoricalChannel, levelLabel } from "./categorical";
import type { DataStruct } from "./types";

const catDs: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [10, 0],
    [20, 1],
    [30, NaN],
    [40, 0],
  ],
  labels: ["Moment", "Region"],
  units: ["emu", ""],
  metadata: {},
  catLevels: { 1: ["North", "South"] },
};

const plainDs: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["a"],
  units: [""],
  metadata: {},
};

describe("isCategoricalChannel", () => {
  it("true for a channel with a level table", () => {
    expect(isCategoricalChannel(catDs, 1)).toBe(true);
  });

  it("false for a numeric channel on the same dataset", () => {
    expect(isCategoricalChannel(catDs, 0)).toBe(false);
  });

  it("false when the dataset carries no catLevels at all", () => {
    expect(isCategoricalChannel(plainDs, 0)).toBe(false);
  });
});

describe("categoricalLevels", () => {
  it("returns the ordered level strings", () => {
    expect(categoricalLevels(catDs, 1)).toEqual(["North", "South"]);
  });

  it("returns null for a non-categorical channel", () => {
    expect(categoricalLevels(catDs, 0)).toBeNull();
  });
});

describe("levelLabel", () => {
  it("resolves a valid code to its level string", () => {
    expect(levelLabel(catDs, 1, 0)).toBe("North");
    expect(levelLabel(catDs, 1, 1)).toBe("South");
  });

  it("never throws — NaN, out-of-range, non-integer, and non-categorical all return null", () => {
    expect(levelLabel(catDs, 1, NaN)).toBeNull();
    expect(levelLabel(catDs, 1, 99)).toBeNull();
    expect(levelLabel(catDs, 1, 0.5)).toBeNull();
    expect(levelLabel(catDs, 0, 0)).toBeNull();
  });
});
