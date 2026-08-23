// The canonical error-role contract (MAIN_PLAN #33 / #36). The tests care most
// about the two rules the plan is explicit on: names are SUGGESTED not forced,
// and half an asymmetric pair is never drawn as a whole one.

import { describe, expect, it } from "vitest";

import {
  asymmetricPair,
  incompleteAsymmetricPairs,
  classifyErrorLabel,
  errKeysFromBindings,
  hasRichErrorBindings,
  inferErrorBindings,
  inferErrorBindingsFromLabels,
  sanitizeBindings,
  symmetricBinding,
  type ErrorBinding,
} from "./errorRoles";
import type { DataStruct } from "./types";

const ds = (labels: string[]): DataStruct => ({
  time: [1, 2],
  values: [labels.map(() => 1), labels.map(() => 2)],
  labels,
  units: labels.map(() => ""),
  metadata: {},
});

describe("classifyErrorLabel", () => {
  it("recognizes the common uncertainty names", () => {
    for (const n of ["err", "error", "sigma", "sd", "se", "stderr", "unc"]) {
      expect(classifyErrorLabel(n), n).not.toBeNull();
    }
  });

  it("reads an explicit axis prefix", () => {
    expect(classifyErrorLabel("xerr")?.axis).toBe("x");
    expect(classifyErrorLabel("yerr")?.axis).toBe("y");
  });

  it("reads asymmetric suffixes, and does not mistake them for the base", () => {
    expect(classifyErrorLabel("err+")?.side).toBe("+");
    expect(classifyErrorLabel("err-")?.side).toBe("-");
    expect(classifyErrorLabel("err_upper")?.side).toBe("+");
    expect(classifyErrorLabel("errlow")?.side).toBe("-");
  });

  it("treats a leading d as the instrument delta convention", () => {
    expect(classifyErrorLabel("dR")?.base).toBe("r");
    expect(classifyErrorLabel("dQ")?.base).toBe("q");
  });

  it("does NOT classify an ordinary measurement column", () => {
    // A false positive turns real data into whiskers.
    for (const n of ["Moment", "Temp", "R", "Intensity", "2Theta", ""]) {
      expect(classifyErrorLabel(n), n).toBeNull();
    }
  });
});

describe("inferErrorBindings", () => {
  it("pairs by base name, which is unambiguous", () => {
    const b = inferErrorBindings(ds(["R", "dR"]));
    expect(b).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("binds an explicit x-error column to the x axis", () => {
    const b = inferErrorBindings(ds(["Signal", "xerr"]));
    expect(b[0]).toMatchObject({ channel: 1, target: -1, axis: "x" });
  });

  it("falls back to the nearest PRECEDING value column", () => {
    // The instrument-file convention the reflectometry corpus relies on.
    const b = inferErrorBindings(ds(["R++", "err", "SA", "err"]));
    expect(b.map((x) => x.target)).toEqual([0, 2]);
  });

  it("captures both halves of an asymmetric pair", () => {
    const b = inferErrorBindings(ds(["M", "M_err+", "M_err-"]));
    expect(b.filter((x) => x.side === "+")).toHaveLength(1);
    expect(b.filter((x) => x.side === "-")).toHaveLength(1);
    expect(b.every((x) => x.target === 0)).toBe(true);
  });

  it("leaves an error column UNBOUND when nothing defensible precedes it", () => {
    // "Never silently forced" — a leading error column has no target.
    expect(inferErrorBindings(ds(["err", "M"]))).toEqual([]);
  });

  it("returns nothing for a dataset with no error columns", () => {
    expect(inferErrorBindings(ds(["Temp", "Moment"]))).toEqual([]);
  });
});

// P1.6 (Import Wizard): inferErrorBindingsFromLabels is the label-only core
// inferErrorBindings delegates to — the wizard seeds suggestions from it
// directly, against a preview's resolved column names, before any
// DataStruct/`.values` exists at all.
describe("inferErrorBindingsFromLabels (label-only core, P1.6)", () => {
  it("is exactly what inferErrorBindings delegates to for a real DataStruct", () => {
    const labels = ["R", "dR", "M_err+", "M_err-", "M"];
    expect(inferErrorBindingsFromLabels(labels)).toEqual(inferErrorBindings(ds(labels)));
  });

  it("works with no DataStruct at all — just the label array", () => {
    expect(inferErrorBindingsFromLabels(["Signal", "xerr"])[0]).toMatchObject({
      channel: 1,
      target: -1,
      axis: "x",
    });
  });
});

describe("errKeysFromBindings (legacy projection)", () => {
  const bindings: ErrorBinding[] = [
    { channel: 1, target: 0, axis: "y", side: "both" },
    { channel: 3, target: 2, axis: "y", side: "+" },
    { channel: 4, target: 2, axis: "y", side: "-" },
    { channel: 5, target: -1, axis: "x", side: "both" },
  ];

  it("projects only symmetric Y bindings", () => {
    expect(errKeysFromBindings(bindings)).toEqual({ 0: 1 });
  });

  it("does NOT collapse an asymmetric pair into the legacy shape", () => {
    // Collapsing would draw whiskers that misstate the data on one side.
    expect(errKeysFromBindings(bindings)[2]).toBeUndefined();
  });

  it("does not project X error into a Y-only map", () => {
    expect(Object.values(errKeysFromBindings(bindings))).not.toContain(5);
  });
});

describe("asymmetricPair / symmetricBinding", () => {
  const bindings: ErrorBinding[] = [
    { channel: 2, target: 0, axis: "y", side: "+" },
    { channel: 3, target: 0, axis: "y", side: "-" },
    { channel: 4, target: 1, axis: "y", side: "+" },
    { channel: 5, target: 1, axis: "y", side: "both" },
  ];

  it("returns a pair only when BOTH halves exist", () => {
    expect(asymmetricPair(bindings, 0, "y")).toEqual({ plus: 2, minus: 3 });
    // Half a pair is not an asymmetric bar; drawing it would invent the rest.
    expect(asymmetricPair(bindings, 1, "y")).toBeNull();
  });

  it("finds a symmetric binding", () => {
    expect(symmetricBinding(bindings, 1, "y")).toBe(5);
    expect(symmetricBinding(bindings, 0, "y")).toBeNull();
  });

  it("reports only the asymmetric targets missing one half", () => {
    expect(incompleteAsymmetricPairs(bindings)).toEqual([
      { target: 1, axis: "y", plus: 4, minus: null },
    ]);
    expect(incompleteAsymmetricPairs([
      { channel: 6, target: -1, axis: "x", side: "+" },
    ])).toEqual([{ target: -1, axis: "x", plus: 6, minus: null }]);
  });
});

describe("hasRichErrorBindings (G4)", () => {
  it("false for undefined or empty", () => {
    expect(hasRichErrorBindings(undefined)).toBe(false);
    expect(hasRichErrorBindings([])).toBe(false);
  });

  it("false when every binding is legacy-expressible (y, both)", () => {
    const legacy: ErrorBinding[] = [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 3, target: 2, axis: "y", side: "both" },
    ];
    expect(hasRichErrorBindings(legacy)).toBe(false);
  });

  it("true when any binding is X-axis", () => {
    expect(hasRichErrorBindings([{ channel: 1, target: -1, axis: "x", side: "both" }])).toBe(true);
  });

  it("true when any binding is asymmetric (+/-), even alongside legacy ones", () => {
    const mixed: ErrorBinding[] = [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 2, target: 0, axis: "y", side: "+" },
    ];
    expect(hasRichErrorBindings(mixed)).toBe(true);
  });
});

describe("sanitizeBindings", () => {
  it("drops references to channels the dataset no longer has", () => {
    // What stops a reapplied template binding error bars to the wrong column
    // after the source's shape changed.
    const raw = [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 9, target: 0, axis: "y", side: "both" },
      { channel: 1, target: 9, axis: "y", side: "both" },
    ];
    expect(sanitizeBindings(raw, 3)).toEqual([
      { channel: 1, target: 0, axis: "y", side: "both" },
    ]);
  });

  it("keeps the x-axis sentinel", () => {
    expect(sanitizeBindings([{ channel: 1, target: -1, axis: "x", side: "both" }], 2)).toHaveLength(1);
  });

  it("rejects malformed entries rather than trusting the slot", () => {
    expect(sanitizeBindings([null, 5, { channel: "a" }, { axis: "z" }], 3)).toEqual([]);
  });

  it("returns undefined for a non-array", () => {
    expect(sanitizeBindings("nope", 3)).toBeUndefined();
  });
});
