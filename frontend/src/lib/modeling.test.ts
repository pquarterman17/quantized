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
});

describe("isCategorical", () => {
  it("nominal + ordinal are categorical; continuous is not", () => {
    expect(isCategorical("nominal")).toBe(true);
    expect(isCategorical("ordinal")).toBe(true);
    expect(isCategorical("continuous")).toBe(false);
  });
});
