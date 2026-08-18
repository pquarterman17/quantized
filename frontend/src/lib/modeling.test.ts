import { describe, expect, it } from "vitest";

import { channelModelingType, inferModelingType, isCategorical } from "./modeling";
import type { Dataset } from "./types";

const ds = (values: number[][], types?: Dataset["channelTypes"]): Dataset => ({
  id: "d1",
  name: "test",
  data: {
    time: values.map((_, i) => i),
    values,
    labels: values[0].map((_, i) => `ch${i}`),
    units: values[0].map(() => ""),
    metadata: {},
  },
  ...(types ? { channelTypes: types } : {}),
});

describe("inferModelingType", () => {
  it("a smooth ramp is continuous", () => {
    expect(inferModelingType(Array.from({ length: 50 }, (_, i) => i * 0.1))).toBe("continuous");
  });

  it("few repeated levels read as nominal", () => {
    // 3 field setpoints × 10 repeats — a level column, not a measurement
    const col = [...Array(10).fill(100), ...Array(10).fill(200), ...Array(10).fill(500)];
    expect(inferModelingType(col)).toBe("nominal");
  });

  it("short columns stay continuous (not enough evidence)", () => {
    expect(inferModelingType([1, 1, 2, 2, 3, 3])).toBe("continuous");
  });

  it("levels must repeat ~3x to read as nominal", () => {
    // 8 distinct over 16 samples: only 2x each → continuous
    const col = Array.from({ length: 16 }, (_, i) => i % 8);
    expect(inferModelingType(col)).toBe("continuous");
    // 8 distinct over 24 samples: 3x each → nominal
    const col3 = Array.from({ length: 24 }, (_, i) => i % 8);
    expect(inferModelingType(col3)).toBe("nominal");
  });

  it("NaN/Inf are ignored, not levels", () => {
    const col = [...Array(12).fill(1), ...Array(12).fill(2), NaN, Infinity, -Infinity];
    expect(inferModelingType(col)).toBe("nominal");
  });
});

describe("channelModelingType", () => {
  const values = Array.from({ length: 30 }, (_, i) => [i * 0.5, i % 3]);

  it("uses the inference when no override is set", () => {
    const d = ds(values);
    expect(channelModelingType(d, 0)).toBe("continuous");
    expect(channelModelingType(d, 1)).toBe("nominal");
  });

  it("a user override wins over the inference", () => {
    const d = ds(values, { 0: "nominal", 1: "ordinal" });
    expect(channelModelingType(d, 0)).toBe("nominal");
    expect(channelModelingType(d, 1)).toBe("ordinal");
  });

  // P3.4 (docs/performance_envelope.md finding 11): channelModelingType now
  // caches its inference per `(ds.data.values, channel)` so repeated calls
  // (e.g. ChannelsCard re-rendering, or several windows on the same dataset)
  // don't re-scan the whole column every time. These tests pin the cache's
  // correctness contract, not just its speed.
  it("repeated calls on the same dataset return the same, correct result", () => {
    const d = ds(values);
    expect(channelModelingType(d, 0)).toBe("continuous");
    expect(channelModelingType(d, 0)).toBe("continuous"); // cache hit, not stale
    expect(channelModelingType(d, 1)).toBe("nominal");
    expect(channelModelingType(d, 1)).toBe("nominal");
  });

  it("two datasets with different values never cross-contaminate the cache", () => {
    // d1's channel 1 is nominal (3 repeated levels); d2's channel 1 at the
    // SAME index is a smooth ramp (continuous) — if the cache were keyed
    // wrong (e.g. by channel index alone) this would leak d1's answer.
    const d1 = ds(values);
    const d2 = ds(Array.from({ length: 30 }, (_, i) => [i * 0.2, i * 0.3]));
    expect(channelModelingType(d1, 1)).toBe("nominal");
    expect(channelModelingType(d2, 1)).toBe("continuous");
    // Re-check d1 after d2 primed its own cache entry — still correct.
    expect(channelModelingType(d1, 1)).toBe("nominal");
  });

  it("a dataset that later gains a channelTypes override still reads the override, even though the underlying values array is unchanged (bypasses any stale cache entry)", () => {
    const d = ds(values);
    expect(channelModelingType(d, 1)).toBe("nominal"); // primes the inference cache
    const withOverride: Dataset = { ...d, channelTypes: { 1: "continuous" } };
    expect(channelModelingType(withOverride, 1)).toBe("continuous");
  });
});

describe("isCategorical", () => {
  it("nominal + ordinal are categorical; continuous is not", () => {
    expect(isCategorical("nominal")).toBe(true);
    expect(isCategorical("ordinal")).toBe(true);
    expect(isCategorical("continuous")).toBe(false);
  });
});

// P1.4: a channel with a level table (lib/categorical.ts) defaults to
// "nominal" — the strongest possible signal, so it's checked before the
// numeric-shape inference (which would otherwise call a smooth-looking code
// column "continuous").
describe("channelModelingType — P1.4 categorical default", () => {
  it("a channel with a level table reads as nominal even with a smooth-ramp code column", () => {
    const smoothCodes = Array.from({ length: 30 }, (_, i) => [i * 0.5, i]); // 30 distinct codes -> would infer continuous
    const d: Dataset = {
      id: "d1",
      name: "test",
      data: {
        time: smoothCodes.map((_, i) => i),
        values: smoothCodes,
        labels: ["x", "cat"],
        units: ["", ""],
        metadata: {},
        catLevels: { 1: smoothCodes.map((_, i) => `L${i}`) },
      },
    };
    expect(channelModelingType(d, 1)).toBe("nominal");
    expect(channelModelingType(d, 0)).toBe("continuous"); // the non-categorical channel is untouched
  });

  it("a user override still wins over the categorical default", () => {
    const d: Dataset = {
      id: "d1",
      name: "test",
      data: {
        time: [0, 1, 2],
        values: [[0], [1], [0]],
        labels: ["cat"],
        units: [""],
        metadata: {},
        catLevels: { 0: ["A", "B"] },
      },
      channelTypes: { 0: "continuous" },
    };
    expect(channelModelingType(d, 0)).toBe("continuous");
  });
});
