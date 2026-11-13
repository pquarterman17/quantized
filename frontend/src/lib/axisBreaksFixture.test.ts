// Y-axis breaks — screen == export, pinned as a SHARED wire fixture.
//
// `lib/axisBreaks.ts` (the canvas) and `src/quantized/calc/axis_breaks.py`
// (the export) are two implementations of ONE broken-axis rule. This builds,
// for a set of cases, where the canvas puts sample values along the axis, the
// values it reads back, its major ticks and its auto range, and freezes them
// in `tests/fixtures/wire/axis_breaks.json`; the backend half
// (`tests/test_axis_breaks.py`) recomputes every number with the Python
// functions and must land on the same ones.
//
// Regenerate only after a DELIBERATE rule change:
//   AXIS_BREAKS_FIXTURE_WRITE=1 npx vitest run src/lib/axisBreaksFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  breakAutoRange,
  breakBackward,
  breakForward,
  breakGap,
  breakTicks,
  elide,
  unelide,
  type AxisBreak,
} from "./axisBreaks";
import { normalizeBreaks } from "./axisFormat";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "axis_breaks.json",
);

interface Case {
  name: string;
  breaks: [number, number][];
  /** The drawn data's extent (sizes the gap and the auto range). */
  data: [number, number];
  /** The range the axis shows (sizes the ticks). */
  view: [number, number];
  step: number | null;
  samples: number[];
}

const CASES: Case[] = [
  { name: "two clusters far apart", breaks: [[12, 990]], data: [0, 1010], view: [0, 1012], step: null, samples: [0, 6, 12, 500, 990, 1000, 1010] },
  { name: "typed increment", breaks: [[12, 990]], data: [0, 1010], view: [0, 1012], step: 4, samples: [4, 992] },
  { name: "two breaks", breaks: [[10, 100], [120, 1000]], data: [0, 1030], view: [0, 1030], step: null, samples: [5, 10, 55, 100, 110, 120, 560, 1000, 1030] },
  { name: "negative values", breaks: [[-90, -10]], data: [-100, 5], view: [-101, 7], step: null, samples: [-100, -90, -50, -10, 0, 5] },
  { name: "sub-unit ticks", breaks: [[0.2, 5]], data: [0, 5.3], view: [0, 5.4], step: null, samples: [0.1, 0.2, 2.6, 5, 5.3] },
  // Live check: a 1..5 cluster under a 1000-unit one -- the short segment
  // must still get several ticks.
  { name: "short segment keeps its ticks", breaks: [[6, 995]], data: [1, 1007.8], view: [0, 1009.5], step: null, samples: [1, 3, 6, 995, 1007.8] },
];

const round = (v: number): number => Number(v.toPrecision(12));

function compute(c: Case) {
  const breaks: AxisBreak[] = c.breaks;
  const gap = breakGap(breaks, c.data[0], c.data[1]);
  const forward = c.samples.map((v) => round(breakForward(v, breaks, gap)));
  return {
    ...c,
    gap: round(gap),
    elided: c.samples.map((v) => round(elide(v, breaks))),
    forward,
    backward: c.samples.map((v) => round(breakBackward(breakForward(v, breaks, gap), breaks, gap))),
    ticks: breakTicks(c.view[0], c.view[1], breaks, c.step),
    autoRange: breakAutoRange(c.data[0], c.data[1], breaks).map(round),
  };
}

describe("axis breaks — the shared screen/export wire fixture", () => {
  it("elides the stretch: values above a break slide down by its length", () => {
    const breaks: AxisBreak[] = [[12, 990]];
    expect(elide(12, breaks)).toBe(12);
    expect(elide(500, breaks)).toBe(12); // flat across the break
    expect(elide(1000, breaks)).toBe(22);
    expect(unelide(22, breaks)).toBe(1000);
    expect(unelide(12, breaks)).toBe(12); // on the break: its lower edge
  });

  it("forward is monotonic and backward undoes it", () => {
    for (const c of CASES) {
      const out = compute(c);
      for (let i = 1; i < out.forward.length; i++) expect(out.forward[i]).toBeGreaterThan(out.forward[i - 1]);
      expect(out.backward).toEqual(c.samples);
    }
  });

  it("sizes the ticks for the KEPT span and puts none inside a break", () => {
    // 22 kept units, not 1012: a step of 5, where the unbroken axis would take 200.
    expect(breakTicks(0, 1012, [[12, 990]])).toEqual([0, 5, 10, 995, 1000, 1005, 1010]);
    expect(breakTicks(0, 1012, [[12, 990]], 4)).toEqual([0, 4, 8, 992, 996, 1000, 1004, 1008, 1012]);
    // No tick ON a break edge: the break marks sit there (live check).
    expect(breakTicks(0, 1012, [[6, 995]], 2)).not.toContain(6);
    expect(breakTicks(5, 5, [[12, 990]])).toEqual([]);
  });

  it("pads the auto range by the kept span, soft at zero", () => {
    // Kept span 30 -> pad 3: [0 (soft), 1013], not the unbroken [-101, 1111].
    expect(breakAutoRange(0, 1010, [[10, 990]])).toEqual([0, 1013]);
    expect(breakAutoRange(-100, 5, [[-90, -10]])).toEqual([-102.5, 7.5]);
  });

  it("normalizes a stored break list: sorted, non-overlapping, invalid entries dropped", () => {
    expect(normalizeBreaks([[100, 200], [1, 2], [150, 300], [5, 5], ["a", 3], [9, Infinity]])).toEqual([[1, 2], [100, 200]]);
    expect(normalizeBreaks([[1, 2], [2, 3], [3, 4], [4, 5], [5, 6]])).toHaveLength(4);
    expect(normalizeBreaks([])).toBeUndefined();
    expect(normalizeBreaks("nope")).toBeUndefined();
  });

  it("matches the committed fixture the backend half reads", () => {
    const fresh = { cases: CASES.map(compute) };
    if (process.env.AXIS_BREAKS_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(fresh)));
  });
});
