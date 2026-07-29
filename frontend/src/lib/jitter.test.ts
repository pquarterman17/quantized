import { describe, expect, it } from "vitest";

import { deterministicJitter } from "./jitter";

// Pinned fixture values cross-checked bit-for-bit against
// `quantized.calc.statplots.deterministic_jitter` (Python) -- verified
// identical via `node`/`python` side by side during development; both test
// suites pin the same (rowIndex, category) pairs below so a future
// regression in either implementation shows up as a mismatched oracle
// constant, not just a "some number changed" diff. See
// tests/test_calc_statplots.py::test_deterministic_jitter_pinned_fixture_matches_the_js_oracle.
describe("deterministicJitter", () => {
  it("matches the Python oracle bit-for-bit for a pinned fixture", () => {
    const cases: [number, string, number][] = [
      [0, "grp = 0", 0.7925511453749032],
      [1, "grp = 0", 0.7577493716398602],
      [2, "grp = 0", -0.6638980008810521],
      [6, "grp = 0", -0.991754248736369],
      [3, "grp = 1", -0.5771982412732202],
      [4, "grp = 1", 0.9061691933093055],
      [5, "grp = 1", 0.4618767107515309],
      [9, "grp = 1", -0.4430490530661887],
      [0, "A", 0.8544226311739587],
      [100, "B", 0.6892106271556604],
    ];
    for (const [rowIndex, category, expected] of cases) {
      expect(deterministicJitter(rowIndex, category)).toBe(expected);
    }
  });

  it("is pure: identical inputs always produce the identical output", () => {
    expect(deterministicJitter(3, "x")).toBe(deterministicJitter(3, "x"));
  });

  it("always returns a value in [-1, 1]", () => {
    for (let i = 0; i < 200; i++) {
      const j = deterministicJitter(i, "category");
      expect(j).toBeGreaterThanOrEqual(-1);
      expect(j).toBeLessThanOrEqual(1);
    }
  });

  it("spreads across many distinct row indices (not a degenerate constant)", () => {
    const values = new Set(Array.from({ length: 20 }, (_, i) => deterministicJitter(i, "cat")));
    expect(values.size).toBeGreaterThan(15);
  });

  it("different categories at the same row generally jitter differently", () => {
    expect(deterministicJitter(0, "cat A")).not.toBe(deterministicJitter(0, "cat B"));
  });

  it("handles non-ASCII category labels without throwing", () => {
    expect(() => deterministicJitter(0, "α ≥ β")).not.toThrow();
    expect(Number.isFinite(deterministicJitter(0, "α ≥ β"))).toBe(true);
  });
});
