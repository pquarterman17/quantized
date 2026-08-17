import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import {
  assignQuickFigureColumn,
  assignmentFor,
  initialQuickFigureMapping,
  mappingReady,
  useAcquisitionAxis,
} from "./quickFigureMapping";

const dataset: Dataset = {
  id: "d1",
  name: "xyerr.csv",
  data: {
    time: [0, 1],
    values: [[2, .1, 4], [3, .2, 5]],
    labels: ["signal", "signal_err", "other"],
    units: ["V", "V", "A"],
    metadata: {},
  },
};

describe("Quick Figure Builder mapping draft", () => {
  it("seeds defensible error inference without plotting the error as Y", () => {
    const mapping = initialQuickFigureMapping(dataset);
    expect(mapping.yKeys).toEqual([0, 2]);
    expect(mapping.errorBindings).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(assignmentFor(mapping, 1).role).toBe("error");
    expect(mappingReady(mapping)).toBe(true);
  });

  it("keeps roles exclusive and drops bindings whose target stops being Y", () => {
    const initial = initialQuickFigureMapping(dataset);
    const x = assignQuickFigureColumn(initial, 0, { role: "x" });
    expect(x.xKey).toBe(0);
    expect(x.yKeys).toEqual([2]);
    expect(x.errorBindings).toEqual([]);
    const ignored = assignQuickFigureColumn(x, 0, { role: "ignore" });
    expect(ignored.xKey).toBeNull();
    expect(ignored.ignoredKeys).toContain(0);
  });

  it("supports explicit asymmetric Y and X error assignments", () => {
    let mapping = assignQuickFigureColumn(initialQuickFigureMapping(dataset), 1, {
      role: "error", target: 2, axis: "y", side: "+",
    });
    expect(mapping.errorBindings).toContainEqual({ channel: 1, target: 2, axis: "y", side: "+" });
    mapping = assignQuickFigureColumn(mapping, 0, { role: "error", target: -1, axis: "x", side: "-" });
    expect(mapping.errorBindings).toContainEqual({ channel: 0, target: -1, axis: "x", side: "-" });
    expect(mappingReady(mapping)).toBe(true);
  });

  it("can restore the immutable acquisition axis after choosing a value column as X", () => {
    const alternate = assignQuickFigureColumn(initialQuickFigureMapping(dataset), 2, { role: "x" });
    expect(useAcquisitionAxis(alternate).xKey).toBeNull();
  });
});

// P2 (X-error orphaning): an X-error binding carries target:-1 (the axis
// sentinel, not a real channel index), so the dependent-binding cleanup in
// assignQuickFigureColumn (which filters `binding.target !== channel`) never
// matches it when X itself is reassigned. A stale X-error binding left in
// place renders as a "confidently wrong" error bar for data it was never
// paired with -- the exact class lib/errorRoles.ts's docstring warns about.
describe("Quick Figure Builder mapping draft — X-error orphaning (P2)", () => {
  const plain: Dataset = {
    id: "d2",
    name: "plain.csv",
    data: {
      time: [0, 1],
      values: [[1, 2, 3], [4, 5, 6]],
      labels: ["A", "B", "C"],
      units: ["", "", ""],
      metadata: {},
    },
  };

  function mappingWithXAndXError(): ReturnType<typeof initialQuickFigureMapping> {
    let mapping = initialQuickFigureMapping(plain);
    mapping = assignQuickFigureColumn(mapping, 0, { role: "x" }); // X = A (channel 0)
    mapping = assignQuickFigureColumn(mapping, 2, { role: "error", target: -1, axis: "x", side: "both" }); // C paired with X
    expect(assignmentFor(mapping, 2)).toEqual({ role: "error", target: -1, axis: "x", side: "both" });
    return mapping;
  }

  it("reassigning X to a different column drops the stale X-error binding", () => {
    const mapping = mappingWithXAndXError();
    const reassigned = assignQuickFigureColumn(mapping, 1, { role: "x" }); // X = B (channel 1)
    expect(reassigned.xKey).toBe(1);
    expect(assignmentFor(reassigned, 2).role).not.toBe("error");
    expect(reassigned.errorBindings.some((b) => b.channel === 2)).toBe(false);
  });

  it("clearing X back to the acquisition axis drops the stale X-error binding", () => {
    const mapping = mappingWithXAndXError();
    const cleared = useAcquisitionAxis(mapping);
    expect(cleared.xKey).toBeNull();
    expect(assignmentFor(cleared, 2).role).not.toBe("error");
    expect(cleared.errorBindings.some((b) => b.channel === 2)).toBe(false);
  });
});

// P2 (duplicate error-binding targets): two source columns can both bind the
// same (target, axis, side) -- the render helpers (errorbars.ts's
// symmetricBinding/asymmetricPair) use .find() and silently draw only the
// FIRST match, dropping the user's later choice. Last write must win.
describe("Quick Figure Builder mapping draft — duplicate error-binding targets (P2)", () => {
  const plain: Dataset = {
    id: "d3",
    name: "plain.csv",
    data: {
      time: [0, 1],
      values: [[1, 2, 3], [4, 5, 6]],
      labels: ["T", "A", "B"],
      units: ["", "", ""],
      metadata: {},
    },
  };

  it("a second y-error(both) binding on the same target replaces the first", () => {
    let mapping = initialQuickFigureMapping(plain);
    mapping = assignQuickFigureColumn(mapping, 1, { role: "error", target: 0, axis: "y", side: "both" }); // channel 1 -> target 0
    mapping = assignQuickFigureColumn(mapping, 2, { role: "error", target: 0, axis: "y", side: "both" }); // channel 2 -> same target 0
    expect(mapping.errorBindings).toEqual([{ channel: 2, target: 0, axis: "y", side: "both" }]);
    expect(assignmentFor(mapping, 1).role).not.toBe("error");
  });

  it("asymmetric '+' and '-' halves for the same target coexist (side is part of the key)", () => {
    let mapping = initialQuickFigureMapping(plain);
    mapping = assignQuickFigureColumn(mapping, 1, { role: "error", target: 0, axis: "y", side: "+" });
    mapping = assignQuickFigureColumn(mapping, 2, { role: "error", target: 0, axis: "y", side: "-" });
    expect(mapping.errorBindings).toEqual(
      expect.arrayContaining([
        { channel: 1, target: 0, axis: "y", side: "+" },
        { channel: 2, target: 0, axis: "y", side: "-" },
      ]),
    );
    expect(mapping.errorBindings).toHaveLength(2);
  });

  it("a second '+' for the same target replaces the first, but leaves the '-' half alone", () => {
    const fourCol: Dataset = {
      ...plain,
      data: {
        ...plain.data,
        values: [[1, 2, 3, 7], [4, 5, 6, 8]],
        labels: ["T", "A", "B", "D"],
        units: ["", "", "", ""],
      },
    };
    let mapping = initialQuickFigureMapping(fourCol);
    mapping = assignQuickFigureColumn(mapping, 1, { role: "error", target: 0, axis: "y", side: "+" });
    mapping = assignQuickFigureColumn(mapping, 2, { role: "error", target: 0, axis: "y", side: "-" });
    // channel 3 becomes a NEW '+' half for the same target -- must replace
    // channel 1's '+' without disturbing channel 2's '-'.
    mapping = assignQuickFigureColumn(mapping, 3, { role: "error", target: 0, axis: "y", side: "+" });
    expect(mapping.errorBindings).toEqual(
      expect.arrayContaining([
        { channel: 3, target: 0, axis: "y", side: "+" },
        { channel: 2, target: 0, axis: "y", side: "-" },
      ]),
    );
    expect(mapping.errorBindings.some((b) => b.channel === 1)).toBe(false);
    expect(mapping.errorBindings).toHaveLength(2);
  });
});
