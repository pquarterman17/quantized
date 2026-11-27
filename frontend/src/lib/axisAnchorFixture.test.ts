// Plan item 24: anchored major ticks, screen == export, as a SHARED wire fixture
// (`tests/fixtures/wire/axis_anchor.json`): the pure rule (`anchorTicks`), the splits the canvas' axis
// gets (`applyAxisExtras` over a typed increment and over uPlot's own found increment) and the export
// request for the same typed axis; `tests/test_axis_anchor.py` asserts the same ticks from
// `calc/axis_anchor.py` and from a real matplotlib draw.
//
// Regenerate only after a DELIBERATE rule change:
//   AXIS_ANCHOR_FIXTURE_WRITE=1 npx vitest run src/lib/axisAnchorFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type uPlot from "uplot";

import { anchorProblem, anchorTicks } from "./axisAnchorTicks";
import { axisDraft, axisDraftErrors, axisPatch } from "./axisDialogModel";
import { applyAxisExtras } from "./axisExtras";
import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { defaultPlotView } from "./plotview";
import { fixedLinearAxisSplits } from "./uplotOpts";
import type { Dataset } from "./types";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "axis_anchor.json");

const PURE: [number, number, number, number][] = [
  [0, 9, 2, 0.5], // 0.5, 2.5, ... 8.5
  [-3.2, 3.2, 1, 0], // whole numbers inside a fractional window
  [0, 1, 0.1, 0.05], // fractions stay clean: 0.15, not 0.15000000000000002
  [100, 130, 10, 7], // an anchor outside the window
  [0, 10, 5, -2.5], // a negative anchor
  [0, 5, 0, 1], // no step: no ticks
];

/** The ticks the canvas' axis draws: its splits function over [min, max]. */
function canvasTicks(fmt: { anchor: number }, own: ((min: number, max: number) => number[]) | null, min: number, max: number, incr: number): number[] {
  const axis = { ...(own ? { splits: (_u: uPlot, _i: number, a: number, b: number) => own(a, b) } : {}) } as unknown as uPlot.Axis;
  applyAxisExtras([axis], [{ mode: "auto", digits: 2, ...fmt }], ["linear"], "#000");
  return (axis.splits as (...a: unknown[]) => number[])({}, 0, min, max, incr, 40);
}

const ds = (): Dataset => ({ id: "d1", name: "A", data: { time: [0, 3, 6, 9], values: [[1], [2], [3], [4]], labels: ["S"], units: ["u"], metadata: {} } });

function request() {
  const view = { ...defaultPlotView(), xLim: [0, 9] as [number, number], xStep: 2, xFmt: { mode: "auto" as const, digits: 2, anchor: 0.5 } };
  return buildFigureSpecFromDocument(createFigureDocument({ id: "w1", name: "A", datasetId: "d1", view }), ds(), "anchor", { fmt: "svg" });
}

const fresh = () => ({
  pure: PURE.map(([min, max, step, anchor]) => ({ min, max, step, anchor, ticks: anchorTicks(min, max, step, anchor) })),
  typed: { fmt_anchor: 0.5, min: 0, max: 9, step: 2, ticks: canvasTicks({ anchor: 0.5 }, (a, b) => fixedLinearAxisSplits(a, b, 2), 0, 9, 2) },
  auto: { fmt_anchor: 0.5, min: 0, max: 9, incr: 2, ticks: canvasTicks({ anchor: 0.5 }, null, 0, 9, 2) },
  request: request(),
});

describe("anchored ticks, screen == export (shared wire fixture)", () => {
  it("anchor + k * step, clean decimals, bad steps draw none", () => {
    expect(anchorTicks(0, 9, 2, 0.5)).toEqual([0.5, 2.5, 4.5, 6.5, 8.5]);
    expect(anchorTicks(0, 1, 0.1, 0.05)).toEqual([0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]);
    expect(anchorTicks(0, 5, 0, 1)).toEqual([]);
    expect(anchorTicks(0, 1e9, 1, 0)).toEqual([]); // over MAX_ANCHOR_TICKS
  });

  it("the canvas axis anchors the typed increment and uPlot's own found increment alike", () => {
    expect(canvasTicks({ anchor: 0.5 }, (a, b) => fixedLinearAxisSplits(a, b, 2), 0, 9, 2)).toEqual([0.5, 2.5, 4.5, 6.5, 8.5]);
    expect(canvasTicks({ anchor: 0.5 }, null, 0, 9, 2)).toEqual([0.5, 2.5, 4.5, 6.5, 8.5]);
  });

  it("the Axis dialog round-trips the anchor and refuses it off a linear axis", () => {
    const view = defaultPlotView();
    const d = { ...axisDraft(view, "x"), anchor: "0.5" };
    expect(axisPatch(view, "x", d).xFmt).toMatchObject({ anchor: 0.5 });
    expect(axisDraft({ ...view, ...axisPatch(view, "x", d) }, "x").anchor).toBe("0.5");
    expect(axisDraftErrors(d, "x")).toEqual([]);
    expect(axisDraftErrors({ ...d, scale: "log" }, "x").join(" ")).toMatch(/Anchor ticks need a linear axis/);
    expect(axisDraftErrors({ ...d, tickAt: "1, 2" }, "x").join(" ")).toMatch(/Tick positions/);
    expect(axisDraftErrors({ ...d, anchor: "abc" }, "x").join(" ")).toMatch(/Anchor must be a number/);
    expect(axisPatch(view, "x", { ...d, anchor: "" }).xFmt).not.toHaveProperty("anchor");
    expect(anchorProblem("linear", false, false)).toBeNull();
  });

  it("is sent as x_fmt.anchor with the typed increment", () => {
    const r = request() as { x_fmt?: { anchor?: number }; x_step?: number };
    expect(r.x_fmt?.anchor).toBe(0.5);
    expect(r.x_step).toBe(2);
  });

  it("matches the committed wire fixture", () => {
    const now = JSON.parse(JSON.stringify(fresh()));
    if (process.env.AXIS_ANCHOR_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n", "utf8");
    expect(now).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
