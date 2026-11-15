// Gap audit 4 G17 in the Axis dialog: log2 and probability scales, custom
// tick positions and labels, and the axis crossing -- authored, validated
// (fail closed), committed as one undo step, persisted and carried by a
// graph template.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import FigureDialogs from "./FigureDialogs";
import { axisDraft, axisDraftErrors, axisPatch, joinLabels, otherAxisKind, splitLabels } from "../../../lib/axisDialogModel";
import { axisFmtParam, hasAxisExtras, inheritedAxisFormat, sanitizeAxisExtras, type AxisFormat } from "../../../lib/axisFormat";
import { captureGraphFormat, graphFormatPatch, sanitizeGraphFormat } from "../../../lib/graphFormat";
import { defaultPlotView, sanitizePlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { openFigureDialog, useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";

const ds: Dataset = { id: "d", name: "d.csv", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["A"], units: [""], metadata: {} } };

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({ ...defaultPlotView(), datasets: [ds], activeId: "d", history: [], future: [], status: "", stageTab: "plot" });
});

const draftOf = (over: Partial<ReturnType<typeof axisDraft>>, axis: "x" | "y" = "y") => ({ ...axisDraft(defaultPlotView(), axis), ...over });

describe("Axis dialog model: G17 scales, ticks and crossing", () => {
  it("round-trips log2, both probability units, custom ticks and the crossing", () => {
    const view = defaultPlotView();
    const log2 = axisPatch(view, "y", draftOf({ scale: "log2" }));
    expect(log2).toMatchObject({ yScale: "log", yFmt: { base: "2" } });
    expect(axisDraft({ ...view, ...log2 }, "y").scale).toBe("log2");
    for (const [choice, unit] of [["probit", "fraction"], ["probitPct", "percent"]] as const) {
      const p = axisPatch(view, "y", draftOf({ scale: choice }));
      expect(p).toMatchObject({ yScale: "linear", yFmt: { prob: unit } });
      expect(axisDraft({ ...view, ...p }, "y").scale).toBe(choice);
    }
    const c = axisPatch(view, "x", draftOf({ tickAt: "0, 2.5, 5", tickLabels: "lo, , hi", cross: "0" }, "x"));
    expect(c.xFmt).toMatchObject({ custom: { at: [0, 2.5, 5], labels: ["lo", "", "hi"] }, cross: 0 });
    const back = axisDraft({ ...view, ...c }, "x");
    expect([back.tickAt, back.tickLabels, back.cross]).toEqual(["0, 2.5, 5", "lo, , hi", "0"]);
    // Blank fields clear them again.
    expect(axisPatch({ ...view, ...c }, "x", { ...back, tickAt: "", tickLabels: "", cross: "" }).xFmt).not.toHaveProperty("custom");
  });

  it("fails closed on values the scale cannot draw", () => {
    const errs = (over: Partial<ReturnType<typeof axisDraft>>, axis: "x" | "y" = "y", other?: string) => axisDraftErrors(draftOf(over, axis), axis, other).join(" ");
    expect(errs({ scale: "log2", from: "0", to: "8" })).toMatch(/needs positive limits/);
    expect(errs({ scale: "probit", from: "0", to: "0.9" })).toMatch(/strictly between 0 and 1/);
    expect(errs({ scale: "probitPct", from: "1", to: "100" })).toMatch(/strictly between 0 and 100 %/);
    expect(errs({ scale: "probitPct", from: "1", to: "99" })).toBe("");
    expect(errs({ scale: "probit", tickAt: "0.5, 1" })).toMatch(/Tick positions on a probability axis/);
    expect(errs({ scale: "log2", tickAt: "1, -2" })).toMatch(/must be positive/);
    expect(errs({ tickAt: "1, x" })).toMatch(/must be numbers/);
    // Review M5: labels with no positions are dropped (their field is hidden), not an error.
    expect(errs({ tickLabels: "a" })).toBe("");
    expect(axisPatch(defaultPlotView(), "y", draftOf({ tickLabels: "a" })).yFmt).not.toHaveProperty("custom");
    // Review H4: a repeated position is refused.
    expect(errs({ tickAt: "1, 1", tickLabels: "a" })).toMatch(/only once/);
    expect(errs({ tickAt: "1", tickLabels: "a, b" })).toMatch(/more tick labels/);
    expect(errs({ scale: "probit", breakFrom: "0.2", breakTo: "0.3" })).toMatch(/cannot have a break/);
    expect(errs({ cross: "0", offset: "4" })).toMatch(/cannot also be offset/);
    expect(errs({ cross: "0", rotate: "30" }, "x")).toMatch(/rotated labels/);
    // The crossing must be a value the OTHER axis can show.
    expect(errs({ cross: "0" }, "y", "log")).toMatch(/cannot show 0/);
    expect(errs({ cross: "1" }, "y", "prob:fraction")).toMatch(/cannot show 1/);
    expect(errs({ cross: "0.5" }, "y", "prob:fraction")).toBe("");
    expect(otherAxisKind({ ...defaultPlotView(), xFmt: { mode: "auto", digits: 2, prob: "percent" } }, "y")).toBe("prob:percent");
    expect(otherAxisKind({ ...defaultPlotView(), yScale: "log" }, "x")).toBe("log");
  });

  it("a file or template value is validated: an invalid custom list is refused whole", () => {
    const raw = { mode: "auto", digits: 2, base: "2", prob: "percent", custom: { at: [1, 2], labels: ["a"] }, cross: 0 } as AxisFormat;
    expect(sanitizeAxisExtras(raw)).toEqual(raw);
    const bad = sanitizeAxisExtras({ mode: "auto", digits: 2, base: "3", prob: "odds", custom: { at: [1, Number.NaN] }, cross: Number.POSITIVE_INFINITY } as unknown as AxisFormat);
    expect(bad).toEqual({ mode: "auto", digits: 2 });
    expect(sanitizeAxisExtras({ mode: "auto", digits: 2, custom: { at: [1], labels: ["a", "b"] } })).toEqual({ mode: "auto", digits: 2 });
    // Review H4: duplicate positions fail closed -- the whole list is dropped.
    expect(sanitizeAxisExtras({ mode: "auto", digits: 2, custom: { at: [1, 1], labels: ["a", "b"] } })).toEqual({ mode: "auto", digits: 2 });
    // Each one travels to the export, and is the axis' own (Y2 does not inherit it).
    for (const f of [{ base: "2" as const }, { prob: "fraction" as const }, { custom: { at: [1] } }, { cross: 0 }]) {
      const fmt: AxisFormat = { mode: "auto", digits: 2, ...f };
      expect(hasAxisExtras(fmt)).toBe(true);
      expect(axisFmtParam(fmt)).toBe(fmt);
    }
    expect(inheritedAxisFormat({ mode: "auto", digits: 2, prob: "fraction", custom: { at: [1] }, cross: 0 })).toEqual({ mode: "auto", digits: 2 });
  });

  it("persists in a saved view and survives a graph template", () => {
    const yFmt: AxisFormat = { mode: "auto", digits: 2, prob: "percent", custom: { at: [5, 50, 95], labels: ["", "median", ""] }, cross: 0 };
    const view = { ...defaultPlotView(), yFmt, xFmt: { mode: "auto" as const, digits: 2, base: "2" as const }, xScale: "log" as const };
    const reloaded = sanitizePlotView(JSON.parse(JSON.stringify(view)));
    expect(reloaded.yFmt).toEqual(yFmt);
    expect(reloaded.xFmt).toEqual(view.xFmt);
    const tpl = sanitizeGraphFormat(JSON.parse(JSON.stringify(captureGraphFormat({ ...view, seriesStyles: {} }, [0]))));
    expect(tpl).not.toBeNull();
    const patch = graphFormatPatch(tpl!, [0], {});
    expect(patch.yFmt).toEqual(yFmt);
    expect(patch.xFmt).toEqual(view.xFmt);
  });
});

describe("Axis dialog: G17 rows", () => {
  it("sets a percent probability Y with custom labelled ticks in one undo step, and undo restores it", () => {
    openFigureDialog({ kind: "axis", axis: "y" });
    render(<FigureDialogs />);
    fireEvent.change(screen.getByRole("combobox", { name: "Y axis Type" }), { target: { value: "probitPct" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Tick positions" }), { target: { value: "0, 50" } });
    expect(screen.getByRole("alert")).toHaveTextContent("strictly between 0 and 100 %");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Tick positions" }), { target: { value: "10, 50, 90" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Tick labels" }), { target: { value: ", median" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Cross X at" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const s = useApp.getState();
    expect(s.yScale).toBe("linear");
    expect(s.yFmt).toMatchObject({ prob: "percent", custom: { at: [10, 50, 90], labels: ["", "median"] }, cross: 1 });
    expect(s.history).toHaveLength(1);
    s.undo();
    expect(useApp.getState().yFmt.prob).toBeUndefined();
    expect(useApp.getState().yFmt.cross).toBeUndefined();
  });
});

describe("Axis dialog: tick labels with commas round-trip (review L2)", () => {
  it("escapes a literal comma or backslash, and reopens to the same labels", () => {
    const labels = ["1,000", "a\\b", "", "plain"];
    const text = joinLabels(labels);
    expect(text).toBe("1\\,000, a\\\\b, , plain");
    expect(splitLabels(text)).toEqual(labels);
    const view = { ...defaultPlotView(), xFmt: { mode: "auto" as const, digits: 2, custom: { at: [1, 2, 3, 4], labels } } };
    const d = axisDraft(view, "x");
    expect(axisDraftErrors(d, "x")).toEqual([]);
    expect(axisPatch(view, "x", d).xFmt?.custom).toEqual({ at: [1, 2, 3, 4], labels });
  });
});
