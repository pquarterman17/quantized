import { describe, expect, it } from "vitest";

import { quickFigureCommit } from "./quickFigureCommit";
import type { QuickFigureMapping } from "./quickFigureMapping";
import type { Dataset } from "./types";

function dataset(): Dataset {
  return {
    id: "d1",
    name: "sample.dat",
    data: {
      time: [0, 1, 2],
      values: [[1, 0.1, 10, 99], [2, 0.2, 20, 98], [3, 0.3, 30, 97]],
      labels: ["signal", "dsignal", "temp", "junk"],
      units: ["V", "V", "K", ""],
      metadata: {},
    },
  };
}

function mapping(overrides: Partial<QuickFigureMapping> = {}): QuickFigureMapping {
  return {
    xKey: null,
    yKeys: [0, 2],
    errorBindings: [{ channel: 1, target: 0, axis: "y", side: "both" }],
    ignoredKeys: [3],
    ...overrides,
  };
}

describe("quickFigureCommit — style translation", () => {
  it('"line" -> mark "line", no marker overrides', () => {
    const pieces = quickFigureCommit(dataset(), mapping(), "line");
    expect(pieces.mark).toBe("line");
    expect(pieces.view.seriesStyles).toEqual({});
  });

  it('"scatter" -> mark "scatter", no seriesStyles patch (scatter draws points by convention)', () => {
    const pieces = quickFigureCommit(dataset(), mapping(), "scatter");
    expect(pieces.mark).toBe("scatter");
    expect(pieces.view.seriesStyles).toEqual({});
  });

  it('"line-symbol" -> mark "line" + marker:true on every mapped Y channel, and ONLY those channels', () => {
    const pieces = quickFigureCommit(dataset(), mapping(), "line-symbol");
    expect(pieces.mark).toBe("line");
    expect(pieces.view.seriesStyles).toEqual({
      0: { marker: true },
      2: { marker: true },
    });
    expect(pieces.view.seriesStyles[1]).toBeUndefined();
    expect(pieces.view.seriesStyles[3]).toBeUndefined();
  });
});

describe("quickFigureCommit — explicit-whitelist semantics", () => {
  it("view.yKeys is EXACTLY mapping.yKeys, never the null 'all channels' sentinel", () => {
    const pieces = quickFigureCommit(dataset(), mapping(), "line");
    expect(pieces.view.yKeys).toEqual([0, 2]);
    expect(pieces.view.yKeys).not.toBeNull();
  });

  it("ignored, error, and x columns never leak into yKeys even when explicitly re-mapped", () => {
    const m = mapping({ xKey: 3, yKeys: [0, 2], ignoredKeys: [], errorBindings: [] });
    const pieces = quickFigureCommit(dataset(), m, "line");
    expect(pieces.view.xKey).toBe(3);
    expect(pieces.view.yKeys).toEqual([0, 2]);
    expect(pieces.view.yKeys).not.toContain(3); // x column absent
    expect(pieces.view.yKeys).not.toContain(1); // error column absent
  });

  it("does NOT blend datasetViewDefaults/techniqueViewMemory -- the seed is defaultPlotView() plus only xKey/yKeys", () => {
    const pieces = quickFigureCommit(dataset(), mapping(), "line");
    expect(pieces.view.yScale).toBe("linear");
    expect(pieces.view.xScale).toBe("linear");
    expect(pieces.view.plotTemplate).toBe("screen");
  });
});

describe("quickFigureCommit — errors", () => {
  it("passes mapping.errorBindings through unchanged (values, not just length)", () => {
    const bindings: QuickFigureMapping["errorBindings"] = [
      { channel: 4, target: 0, axis: "y", side: "+" },
      { channel: 5, target: 0, axis: "y", side: "-" },
      { channel: 6, target: -1, axis: "x", side: "both" },
    ];
    const pieces = quickFigureCommit(dataset(), mapping({ errorBindings: bindings }), "line");
    expect(pieces.errors).toEqual(bindings);
  });

  it("errors is a fresh array, not the same reference as mapping.errorBindings", () => {
    const m = mapping();
    const pieces = quickFigureCommit(dataset(), m, "line");
    expect(pieces.errors).not.toBe(m.errorBindings);
    expect(pieces.errors).toEqual(m.errorBindings);
  });
});

describe("quickFigureCommit — name", () => {
  it('names the figure "Quick Figure — <dataset.name>", undeduped', () => {
    const pieces = quickFigureCommit(dataset(), mapping(), "line");
    expect(pieces.name).toBe("Quick Figure — sample.dat");
  });
});

describe("quickFigureCommit — purity", () => {
  it("never mutates the input dataset or mapping", () => {
    const ds = dataset();
    const m = mapping();
    const dsSnapshot = structuredClone(ds);
    const mSnapshot = structuredClone(m);
    quickFigureCommit(ds, m, "line-symbol");
    expect(ds).toEqual(dsSnapshot);
    expect(m).toEqual(mSnapshot);
  });
});
