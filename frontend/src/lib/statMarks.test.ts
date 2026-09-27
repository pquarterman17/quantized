// P2.6 box 1 — the categorical marks' pure layer. The error-bar conventions
// and the label wrapping are held to the BACKEND by two shared fixtures the
// Python suite reads too (`tests/test_calc_figure_stat_marks.py`):
//   tests/fixtures/wire/stat_error_bars.json  (hand-computed SD / SE / t-CI)
//   tests/fixtures/wire/stat_label_wrap.json  (wrap cases)
// so the numbers and lines the canvas draws are the ones the export draws.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { seriesStat } from "./barlayout";
import { sanitizePlotView } from "./plotview";
import { sanitizeStatMarks } from "./plotviewSanitize";
import {
  axisStyleWire,
  errorBounds,
  errorHalfWidth,
  nestedTiers,
  resolveStatMarks,
  wrapLabel,
  type StatErrorBars,
} from "./statMarks";
import { boxStatsClient } from "./statstage";

const WIRE = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/wire");
const load = <T,>(name: string): T => JSON.parse(readFileSync(join(WIRE, name), "utf-8")) as T;

interface ErrorCase {
  name: string;
  values: number[];
  n: number;
  mean: number;
  median: number;
  sd: number | null;
  se: number | null;
  bounds: Record<"sd" | "se" | "ci95", [number, number] | null>;
}
const ERROR_CASES = load<{ cases: ErrorCase[] }>("stat_error_bars.json").cases;
const WRAP_CASES = load<{ cases: { text: string; width: number; lines: string[] }[] }>("stat_label_wrap.json").cases;
const KINDS = ["sd", "se", "ci95"] as const satisfies readonly StatErrorBars[];

function close(got: number, want: number, rel: number) {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(want)));
}

describe("error bars — the shared hand-computed fixture (backend parity)", () => {
  it.each(ERROR_CASES.map((c) => [c.name, c] as const))("%s: box stats (client fallback)", (_, c) => {
    const b = boxStatsClient(c.values);
    expect(b.n).toBe(c.n);
    close(b.mean, c.mean, 1e-12);
    close(b.median, c.median, 1e-12);
    if (c.sd === null) expect(b.sd).toBeNaN();
    else close(b.sd as number, c.sd, 1e-12);
    for (const k of KINDS) {
      const got = errorBounds(b, k);
      const want = c.bounds[k];
      if (want === null) expect(got).toBeNull();
      else {
        // The t critical value is a bisection over the incomplete beta
        // (lib/tdist.ts), scipy-exact to ~1e-9 relative; SD / SE are exact.
        close(got![0], want[0], k === "ci95" ? 1e-9 : 1e-12);
        close(got![1], want[1], k === "ci95" ? 1e-9 : 1e-12);
      }
    }
    expect(errorBounds(b, "none")).toBeNull();
  });

  it.each(ERROR_CASES.map((c) => [c.name, c] as const))("%s: bar mode's (mean, SE, n) path", (_, c) => {
    const s = seriesStat(c.values);
    for (const k of KINDS) {
      const half = errorHalfWidth(k, s.sem, s.n);
      const want = c.bounds[k];
      if (want === null) expect(half).toBeNaN();
      else close(half, (want[1] - want[0]) / 2, 1e-9);
    }
  });

  it("the backend's own numbers win when the box stats carry them", () => {
    const b = { ...boxStatsClient([1, 2, 3, 4]), sd: 10, ciLo: -5, ciHi: 9 };
    expect(errorBounds(b, "sd")).toEqual([b.mean - 10, b.mean + 10]);
    expect(errorBounds(b, "ci95")).toEqual([-5, 9]);
  });
});

describe("wrapLabel — the shared fixture (export parity)", () => {
  it.each(WRAP_CASES.map((c) => [c.text, c] as const))("%j", (_, c) => {
    expect(wrapLabel(c.text, c.width)).toEqual(c.lines);
  });
});

describe("nestedTiers", () => {
  it("splits inner labels and maximal consecutive outer runs", () => {
    expect(nestedTiers(["lot = 1 / w = a", "lot = 1 / w = b", "lot = 2 / w = a", "lot = 1 / w = c"])).toEqual({
      inner: ["w = a", "w = b", "w = a", "w = c"],
      runs: [
        { label: "lot = 1", first: 0, last: 1 },
        { label: "lot = 2", first: 2, last: 2 },
        { label: "lot = 1", first: 3, last: 3 },
      ],
    });
    expect(nestedTiers(["A", "lot = 1 / w = a"])).toBeNull();
    expect(nestedTiers([])).toBeNull();
  });
});

describe("resolveStatMarks — per-mode defaults", () => {
  it("reproduces what each mode always drew", () => {
    expect(resolveStatMarks("box", {})).toEqual({
      points: "outliers", jitterWidth: 0.7, summary: "none", errorBars: "ci95", connectMeans: false,
      labelRotation: 0, labelWrap: false,
    });
    expect(resolveStatMarks("strip", null).points).toBe("all");
    expect(resolveStatMarks("strip", null).jitterWidth).toBe(0.85);
    expect(resolveStatMarks("violin", undefined).points).toBe("none");
    expect(resolveStatMarks("bar", {}).errorBars).toBe("se");
  });

  it("jitter off is width 0 whatever width is remembered", () => {
    expect(resolveStatMarks("strip", { jitter: false, jitterWidth: 0.5 }).jitterWidth).toBe(0);
    expect(resolveStatMarks("strip", { jitter: true, jitterWidth: 0.5 }).jitterWidth).toBe(0.5);
  });
});

describe("axisStyleWire", () => {
  const r = resolveStatMarks("box", {});
  it("is null for an untouched flat axis, so the request is unchanged", () => {
    expect(axisStyleWire(r, ["a", "b"])).toBeNull();
  });
  it("carries tiers exactly when the screen draws them, and the options", () => {
    expect(axisStyleWire(r, ["a = 1 / b = 1"])).toEqual({ rotation: 0, wrap: null, tiered: true });
    expect(axisStyleWire({ ...r, labelRotation: 90, labelWrap: true }, ["a"])).toEqual({
      rotation: 90, wrap: 12, tiered: false,
    });
  });
});

describe("sanitizeStatMarks (the .dwk boundary)", () => {
  it("keeps well-formed fields and drops junk field by field", () => {
    expect(
      sanitizeStatMarks({
        points: "some", jitter: false, jitterWidth: 2, summary: "median", errorBars: "sd",
        connectMeans: "yes", labelRotation: 30, labelWrap: true, extra: 1,
      }),
    ).toEqual({ jitter: false, summary: "median", errorBars: "sd", labelWrap: true });
    expect(sanitizeStatMarks({ jitterWidth: 0.4, labelRotation: 90 })).toEqual({ jitterWidth: 0.4, labelRotation: 90 });
    expect(sanitizeStatMarks(null)).toEqual({});
    expect(sanitizeStatMarks("x")).toEqual({});
  });
  it("a file written before the field existed opens with the defaults", () => {
    expect(sanitizePlotView({ statMode: true }).statMarks).toEqual({});
  });
});
