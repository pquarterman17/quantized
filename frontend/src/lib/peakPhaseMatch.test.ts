// {hkl}/{phase} tokens (gap audit 2 #12, OPEN_ITEMS #20): the matching is the
// backend's (calc/phase_match.py, tested there); these cover the pure bridges.

import { describe, expect, it } from "vitest";

import { DEFAULT_REFERENCE_TOLERANCE, usesReferenceTokens } from "./peakPhaseMatch";
import type { RefLine } from "./types";
import { patternsFromRefLines, peakAssignments, type XrdMatchResult } from "./xrdMatch";

const stick = { intensity: 1, baseline: 0, height: 0.2, color: "#000", visible: true, showLabel: false };
const lines: RefLine[] = [
  { id: "r1", axis: "x", value: 38.18, label: "(111)", groupId: "g1", groupLabel: "Au · λ 1.54060 Å", stick: { ...stick, intensity: 100 } },
  { id: "r2", axis: "x", value: 44.39, label: "(200)", groupId: "g1", stick: { ...stick, intensity: 45 } },
  { id: "r3", axis: "x", value: 38.3, label: "(110)", groupId: "g2", groupLabel: "Other phase · λ unknown", stick },
  { id: "r6", axis: "x", value: 30, label: "(1)", groupId: "g3", groupLabel: "Si (built-in) · λ 1.54060 Å", stick },
  // A plain reference line (no stick) and a y line are not reflections.
  { id: "r4", axis: "x", value: 40 },
  { id: "r5", axis: "y", value: 38.2, stick },
];

describe("reference sticks -> match patterns", () => {
  it("groups sticks by pattern with name, λ, intensity and label; skips built-in overlays", () => {
    expect(patternsFromRefLines(lines)).toEqual([
      { name: "Au", wavelength: 1.5406, lines: [
        { two_theta: 38.18, label: "(111)", intensity: 100 },
        { two_theta: 44.39, label: "(200)", intensity: 45 },
      ] },
      { name: "Other phase", lines: [{ two_theta: 38.3, label: "(110)", intensity: 1 }] },
    ]);
  });

  it("hands each peak its accepted phase's matched line (null when unmatched)", () => {
    const r = { phases: [
      { name: "Au", matches: [{ peak_index: 0, label: "(111)" }] },
      { name: "Other phase", matches: [{ peak_index: 2, label: "(110)" }] },
    ] } as unknown as XrdMatchResult;
    expect(peakAssignments(r, 3)).toEqual([{ hkl: "(111)", phase: "Au" }, null, { hkl: "(110)", phase: "Other phase" }]);
  });

  it("knows which templates need a reference, and the default tolerance", () => {
    expect(DEFAULT_REFERENCE_TOLERANCE).toBe(0.2);
    expect(usesReferenceTokens("{center} {hkl}")).toBe(true);
    expect(usesReferenceTokens("{phase}")).toBe(true);
    expect(usesReferenceTokens("{center}")).toBe(false);
  });
});
