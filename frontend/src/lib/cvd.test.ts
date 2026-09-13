import { describe, expect, it } from "vitest";

import { deltaE, distinguishabilityVerdict, type Rgb, seriesDistinguishability, simulateCvd } from "./cvd";

// Known-answer tests for the Machado (2009) simulation matrices. Numbers were
// measured directly from this module (not guessed) — see the commit body for
// the exact figures. Each threshold below is deliberately loose around the
// measured value so the test asserts the qualitative, documented behaviour
// (a big drop, a small drop, unchanged) rather than pinning brittle floats.
describe("simulateCvd", () => {
  const red: Rgb = [255, 0, 0];
  const green: Rgb = [0, 255, 0];

  it("collapses most of red vs green's contrast under protan and deutan, leaves it mostly intact under tritan", () => {
    const normal = deltaE(red, green); // measured ~170.6
    const protan = deltaE(simulateCvd(red, "protan"), simulateCvd(green, "protan")); // measured ~65.9
    const deutan = deltaE(simulateCvd(red, "deutan"), simulateCvd(green, "deutan")); // measured ~27.8
    const tritan = deltaE(simulateCvd(red, "tritan"), simulateCvd(green, "tritan")); // measured ~153.2

    expect(normal).toBeGreaterThan(150);
    // Protan: contrast drops to well under half of normal (the documented factor).
    expect(protan).toBeLessThan(normal * 0.5);
    // Deutan: an even bigger collapse — under a quarter of normal.
    expect(deutan).toBeLessThan(normal * 0.25);
    // Tritan: red/green sit off its blue-yellow confusion axis, so most of
    // the contrast survives — at least 80% of normal.
    expect(tritan).toBeGreaterThan(normal * 0.8);
  });

  it("leaves a neutral grey unchanged (ΔE to itself ~0, stays hue-neutral) under every simulation", () => {
    const grey: Rgb = [128, 128, 128];
    for (const kind of ["protan", "deutan", "tritan"] as const) {
      const simulated = simulateCvd(grey, kind);
      expect(deltaE(grey, simulated)).toBeLessThan(0.01);
      // Hue-neutral: r, g, b stay equal (an achromatic matrix mustn't tint grey).
      expect(simulated[0]).toBe(simulated[1]);
      expect(simulated[1]).toBe(simulated[2]);
    }
  });

  it("is a pure function of its inputs (same input, same output)", () => {
    expect(simulateCvd(red, "deutan")).toEqual(simulateCvd(red, "deutan"));
  });
});

describe("deltaE", () => {
  it("is 0 for identical colours", () => {
    expect(deltaE([10, 20, 30], [10, 20, 30])).toBe(0);
  });

  it("is ~100 for black vs white (the CIE76 scale's own black-white span)", () => {
    expect(deltaE([0, 0, 0], [255, 255, 255])).toBeCloseTo(100, 0);
  });
});

describe("seriesDistinguishability", () => {
  // Hand-built quartet. A and B (indices 0, 1) are a real pair produced by
  // this module's own matrices — an olive green and a brick red that are
  // clearly different under normal vision AND under protan AND under tritan,
  // but collapse to nearly the same colour under deutan specifically (this
  // is not a synthetic/mocked matrix — it is what the real Machado deutan
  // matrix does to these two sRGB triples). C and D (indices 2, 3) are an
  // unrelated pair, included so the test also proves the function tracks a
  // DIFFERENT worst pair per condition rather than always reporting (0, 1).
  const A: Rgb = [64, 128, 0];
  const B: Rgb = [192, 32, 32];
  const C: Rgb = [120, 120, 120];
  const D: Rgb = [150, 110, 95];
  const colors = [A, B, C, D];

  it("flags (A, B) as the near-identical pair under deutan only", () => {
    const result = seriesDistinguishability(colors);

    // Measured: deltaE(simulateCvd(A,"deutan"), simulateCvd(B,"deutan")) ~ 0.50.
    expect(result.deutan.deltaE).toBeLessThan(1);
    expect([result.deutan.i, result.deutan.j].sort((a, b) => a - b)).toEqual([0, 1]);

    // The other three conditions are not fooled by (A, B): each finds a
    // materially larger minimum ΔE, on some OTHER pair (measured minimums:
    // normal ~20.1, protan ~12.2, tritan ~24.0 — all on (C, D) or (A, C),
    // never (A, B), whose own normal/protan/tritan ΔE is ~101/~31/~103).
    for (const condition of ["normal", "protan", "tritan"] as const) {
      expect(result[condition].deltaE).toBeGreaterThan(10);
      expect([result[condition].i, result[condition].j].sort((a, b) => a - b)).not.toEqual([0, 1]);
    }
  });

  it("returns {deltaE: Infinity, i: -1, j: -1} for fewer than 2 colours", () => {
    const result = seriesDistinguishability([A]);
    expect(result.normal).toEqual({ deltaE: Infinity, i: -1, j: -1 });
  });
});

describe("distinguishabilityVerdict", () => {
  const A: Rgb = [64, 128, 0];
  const B: Rgb = [192, 32, 32];
  const C: Rgb = [120, 120, 120];
  const D: Rgb = [150, 110, 95];

  it("fails (with the deutan pair named) when a list contains a deutan-confusable pair below threshold", () => {
    const verdict = distinguishabilityVerdict([A, B, C, D], 10);
    expect(verdict.ok).toBe(false);
    expect(verdict.worst.kind).toBe("deutan");
    expect([verdict.worst.i, verdict.worst.j].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(verdict.worst.deltaE).toBeLessThan(10);
  });

  it("reports fewer than 2 colours as a non-vacuous fail, not a silent pass", () => {
    const empty = distinguishabilityVerdict([]);
    expect(empty.ok).toBe(false);
    expect(empty.vacuous).toBe(true);
    expect(empty.worst.deltaE).toBe(Infinity);

    const single = distinguishabilityVerdict([A]);
    expect(single.ok).toBe(false);
    expect(single.vacuous).toBe(true);
  });

  it("passes for a list whose closest pair clears the threshold under every simulation", () => {
    // A grey ramp: hue confusion cannot touch it (a=b=0 throughout), so its
    // pairwise ΔE is lightness-only and identical (measured ~26.9) under
    // normal vision and all three simulations alike.
    const greyRamp: Rgb[] = [
      [15, 15, 15],
      [90, 90, 90],
      [170, 170, 170],
      [245, 245, 245],
    ];
    const verdict = distinguishabilityVerdict(greyRamp, 10);
    expect(verdict.ok).toBe(true);
  });

  it("defaults its threshold to DEFAULT_DISTINGUISHABILITY_THRESHOLD (10)", () => {
    const withDefault = distinguishabilityVerdict([A, B, C, D]);
    const withExplicit10 = distinguishabilityVerdict([A, B, C, D], 10);
    expect(withDefault).toEqual(withExplicit10);
  });
});
