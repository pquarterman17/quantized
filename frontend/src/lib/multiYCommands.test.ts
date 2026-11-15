// Plot ▸ Y Axis Settings… (gap audit 4 G11): the dialog's answers become
// one axis patch, the lane-H scales ride the format, and bad input is refused.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { newExtraYAxis } from "./multiY";
import { editExtraYAxes, extraAxisPatch } from "./multiYCommands";
import { useApp } from "../store/useApp";

const ask = vi.hoisted(() => vi.fn());
vi.mock("../store/paramDialog", () => ({ askParams: ask }));

const answers = (over: Record<string, unknown> = {}) => ({
  label: "Moment", scale: "Same as Y1", min: "", max: "", step: "", format: "Same as Y1", digits: 2, color: "", remove: false, ...over,
});

describe("extraAxisPatch", () => {
  const a = newExtraYAxis();

  it("maps the answers onto the axis", () => {
    expect(extraAxisPatch(a, answers({ min: "0", max: "5", step: "1", color: "#123abc", format: "Fixed", digits: 3 }))).toEqual({
      label: "Moment", scale: null, lim: [0, 5], step: 1, fmt: { mode: "fixed", digits: 3 }, color: "#123abc",
    });
  });

  it("the log2 / Ln / probability scales ride the format, as on Y1", () => {
    expect(extraAxisPatch(a, answers({ scale: "Log2" }))).toMatchObject({ scale: "log", fmt: { base: "2" } });
    expect(extraAxisPatch(a, answers({ scale: "Ln" }))).toMatchObject({ scale: "log", fmt: { base: "e" } });
    expect(extraAxisPatch(a, answers({ scale: "Probability (%)" }))).toMatchObject({ scale: "linear", fmt: { prob: "percent" } });
    const was = { ...a, scale: "log" as const, fmt: { mode: "auto" as const, digits: 2, base: "2" as const } };
    expect(extraAxisPatch(was, answers({ scale: "Log10", format: "Auto" }))).toMatchObject({ scale: "log", fmt: { mode: "auto", digits: 2 } });
    expect((extraAxisPatch(was, answers({ scale: "Log10", format: "Auto" })) as { fmt: object }).fmt).not.toHaveProperty("base");
  });

  it("drops a tick step given without a range", () => {
    expect(extraAxisPatch(a, answers({ step: "1" }))).toMatchObject({ lim: null, step: null });
  });

  it("refuses half a range, a reversed range, a bad step or colour", () => {
    expect(extraAxisPatch(a, answers({ min: "1" }))).toBe("give both limits, or neither");
    expect(extraAxisPatch(a, answers({ min: "5", max: "1" }))).toBe("the minimum must be below the maximum");
    expect(extraAxisPatch(a, answers({ step: "-2" }))).toBe("the tick step must be positive");
    expect(extraAxisPatch(a, answers({ min: "x", max: "2" }))).toMatch(/number/);
    expect(extraAxisPatch(a, answers({ color: "red" }))).toMatch(/#rrggbb/);
  });
});

describe("editExtraYAxes", () => {
  beforeEach(() => {
    ask.mockReset();
    useApp.setState({ yAxes: [], yAxisOf: {}, history: [], status: "" });
  });

  it("with no extra axis, says how to make one", async () => {
    await editExtraYAxes(useApp.getState);
    expect(useApp.getState().status).toMatch(/\+Y3/);
    expect(ask).not.toHaveBeenCalled();
  });

  it("applies one axis as one undo step, or removes it", async () => {
    useApp.setState({ yAxes: [newExtraYAxis()], yAxisOf: { 2: 3 } });
    ask.mockResolvedValueOnce(answers({ color: "#00ff00" }));
    await editExtraYAxes(useApp.getState);
    expect(useApp.getState().yAxes[0]).toMatchObject({ label: "Moment", color: "#00ff00" });
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["format Y3 axis"]);
    ask.mockResolvedValueOnce(answers({ remove: true }));
    await editExtraYAxes(useApp.getState);
    expect(useApp.getState().yAxes).toEqual([]);
    expect(useApp.getState().yAxisOf).toEqual({});
  });

  it("a refused answer changes nothing and says why", async () => {
    useApp.setState({ yAxes: [newExtraYAxis()], yAxisOf: { 2: 3 } });
    ask.mockResolvedValueOnce(answers({ min: "1" }));
    await editExtraYAxes(useApp.getState);
    expect(useApp.getState().yAxes[0]).toEqual(newExtraYAxis());
    expect(useApp.getState().status).toBe("Y3 unchanged: give both limits, or neither");
  });
});
