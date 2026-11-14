// Gap audit 2 #12: peaks take the nearest XRD reference reflection within a
// documented tolerance, which feeds the {hkl}/{phase} label tokens.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_REFERENCE_TOLERANCE,
  matchReflection,
  referenceReflections,
  usesReferenceTokens,
} from "./peakPhaseMatch";
import type { RefLine } from "./types";

const stick = { intensity: 1, baseline: 0, height: 0.2, color: "#000", visible: true, showLabel: false };
const lines: RefLine[] = [
  { id: "r1", axis: "x", value: 38.18, label: "(111)", groupId: "g1", groupLabel: "Au · λ 1.54060 Å", stick },
  { id: "r2", axis: "x", value: 44.39, label: "(200)", groupId: "g1", stick },
  { id: "r3", axis: "x", value: 38.3, label: "(110)", groupId: "g2", groupLabel: "Other phase · λ unknown", stick },
  // A plain reference line (no stick) is not a reflection.
  { id: "r4", axis: "x", value: 40 },
  { id: "r5", axis: "y", value: 38.2, stick },
];

describe("peak → reference matching", () => {
  const refl = referenceReflections(lines);

  it("reads every reference stick with its pattern name as the phase", () => {
    expect(refl).toEqual([
      { twoTheta: 38.18, hkl: "(111)", phase: "Au" },
      { twoTheta: 44.39, hkl: "(200)", phase: "Au" },
      { twoTheta: 38.3, hkl: "(110)", phase: "Other phase" },
    ]);
  });

  it("takes the NEAREST stick within tolerance", () => {
    expect(matchReflection(38.2, refl)).toMatchObject({ hkl: "(111)", phase: "Au" });
    expect(matchReflection(38.28, refl)).toMatchObject({ hkl: "(110)", phase: "Other phase" });
  });

  it("matches nothing outside the tolerance (inclusive edge)", () => {
    expect(DEFAULT_REFERENCE_TOLERANCE).toBe(0.2);
    expect(matchReflection(44.0, refl)).toBeNull();
    expect(matchReflection(44.5, refl, 0.11)).not.toBeNull();
    expect(matchReflection(44.5, refl, 0.1)).toBeNull();
    expect(matchReflection(44.0, refl, 0.5)).toMatchObject({ hkl: "(200)" });
    expect(matchReflection(Number.NaN, refl)).toBeNull();
  });

  it("knows which templates need a reference", () => {
    expect(usesReferenceTokens("{center} {hkl}")).toBe(true);
    expect(usesReferenceTokens("{phase}")).toBe(true);
    expect(usesReferenceTokens("{center}")).toBe(false);
  });
});
