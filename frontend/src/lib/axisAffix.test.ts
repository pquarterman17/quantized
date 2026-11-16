// Tick-label prefix / suffix (gap audit 5 lane J, L3), screen half of the
// shared fixture `tests/fixtures/wire/tick_affix.json`; the export half is
// `tests/test_axis_affix.py`. Both must draw the fixture's labels.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { applyAxisExtras } from "./axisExtras";
import { axisDraft, axisPatch, type AxisView } from "./axisDialogModel";
import { hasAxisExtras, inheritedAxisFormat, sanitizeAxisExtras, type AxisFormat } from "./axisFormat";
import { defaultPlotView } from "./plotview";
import { tickFormatter } from "./uplotOpts";

interface Case { name: string; fmt: AxisFormat; splits: number[]; labels: string[] }
const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "../../../tests/fixtures/wire/tick_affix.json"), "utf8")) as { cases: Case[] };

function labelsOf(fmt: AxisFormat, splits: number[]): unknown[] {
  const axis: uPlot.Axis = { values: tickFormatter(fmt, "linear") };
  applyAxisExtras([axis], [fmt], ["linear"], "#000");
  let incr = Infinity;
  for (let i = 1; i < splits.length; i++) incr = Math.min(incr, Math.abs(splits[i] - splits[i - 1]));
  const values = axis.values as (...a: unknown[]) => unknown[];
  return values({}, splits, 0, 0, incr);
}

describe("tick-label prefix / suffix on the canvas", () => {
  for (const c of fixture.cases) {
    it(`fixture: ${c.name}`, () => {
      expect(labelsOf(c.fmt, c.splits)).toEqual(c.labels);
    });
  }

  it("is an axis extra, survives sanitizing and is dropped for an empty string", () => {
    const fmt: AxisFormat = { mode: "auto", digits: 2, prefix: "$", suffix: "" };
    expect(hasAxisExtras(fmt)).toBe(true);
    expect(sanitizeAxisExtras(fmt)).toEqual({ mode: "auto", digits: 2, prefix: "$" });
    expect(sanitizeAxisExtras({ mode: "auto", digits: 2, prefix: 5 as never }).prefix).toBeUndefined();
    expect(sanitizeAxisExtras({ mode: "auto", digits: 2, suffix: "x".repeat(40) }).suffix).toHaveLength(12);
  });

  it("a Y2 axis does not inherit Y's prefix (Y's units)", () => {
    expect(inheritedAxisFormat({ mode: "auto", digits: 2, prefix: "$", suffix: "K", minor: 2 })).toEqual({ mode: "auto", digits: 2, minor: 2 });
  });

  it("round trips through the Axis dialog model, keeping a leading space", () => {
    const view = defaultPlotView() as AxisView;
    const draft = { ...axisDraft(view, "y"), prefix: "$", suffix: " K" };
    const patch = axisPatch(view, "y", draft);
    expect(patch.yFmt).toMatchObject({ prefix: "$", suffix: " K" });
    const next = { ...view, ...patch } as AxisView;
    const back = axisDraft(next, "y");
    expect([back.prefix, back.suffix]).toEqual(["$", " K"]);
    const cleared = axisPatch(next, "y", { ...back, prefix: "", suffix: "" });
    expect(cleared.yFmt).not.toHaveProperty("prefix");
    expect(cleared.yFmt).not.toHaveProperty("suffix");
  });
});
