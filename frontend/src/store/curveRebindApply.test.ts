// Item 38: Change Y / Change X / Change Worksheet and Hide others / Show all.
// A re-bind is one undo step through Layer Contents' apply path; the style
// stays, the legend follows the source unless typed, and anything ambiguous
// is refused, never guessed.

import { beforeEach, describe, expect, it } from "vitest";

import { curveBindingAt, matchColumn, resolveOnSheet, worksheetCandidates } from "../lib/curveRebind";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { changeCurveWorksheet, hideOtherCurves, rebindCurve, showAllCurves } from "./curveRebindApply";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const sheet = (id: string, labels: string[], base: number): Dataset => ({
  id,
  name: `S${id}`,
  data: {
    time: [0, 1],
    values: [labels.map((_, c) => base + c), labels.map((_, c) => base + 10 + c)],
    labels,
    units: labels.map(() => ""),
    metadata: {},
  },
});
const a = sheet("a", ["T", "R", "M"], 100);
const b = sheet("b", ["T", "R", "M"], 200);
const dup = sheet("dup", ["T", "R", "R"], 300); // R twice: ambiguous
const lacking = sheet("lacking", ["T", "Q"], 400); // no R: left out
const loose = sheet("loose", ["t ", "r", "m"], 500); // case/blank-insensitive match

const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;
const toasts = () => useToasts.getState().toasts.map((t) => t.msg).join(" | ");
const binding = (ch: number) => curveBindingAt(useApp.getState(), ch)!;

beforeEach(async () => {
  useApp.setState({ datasets: [a, b, dup, lacking, loose], selectedIds: [], history: [], future: [], workbooks: [] });
  useToasts.setState({ toasts: [] });
  await plotSelectedTogether(["a", "b"]); // curve 0 from a, curve 1 from b
  const first = binding(0);
  rebindCurve(0, first, { datasetId: "a", xKey: 0, yKey: 1 }); // curve 0: R against T
  useApp.setState({
    seriesStyles: { 0: { color: "#ff0000" }, 1: { color: "#00ff00" } },
    seriesLabels: {},
    hiddenChannels: [],
    history: [],
    future: [],
  });
  expect(graph().linkedCurves).toHaveLength(2);
});

describe("Change Y / Change X", () => {
  it("re-binds Y to another column of the curve's sheet; style kept; automatic legend follows; one undo step", () => {
    const before = graph().linkedCurves![0];
    const exp = binding(0);
    expect(exp).toMatchObject({ xKey: 0, yKey: 1 });
    expect(rebindCurve(0, exp, { ...exp, yKey: 2 })).toBe(true);
    const c = graph().linkedCurves![0];
    expect(c).toMatchObject({ datasetId: before.datasetId, xKey: before.xKey, yKey: 2 });
    expect(c.label).toBe("Sa: M");
    expect(useApp.getState().seriesStyles[0]).toEqual({ color: "#ff0000" });
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(graph().linkedCurves![0]).toEqual(before);
  });

  it("keeps a legend the user typed", () => {
    useApp.setState({ seriesLabels: { 0: "my curve" } });
    const exp = binding(0);
    rebindCurve(0, exp, { ...exp, yKey: 2 });
    expect(useApp.getState().seriesLabels[0]).toBe("my curve");
  });

  it("re-binds X for that curve only, and back to its own X", () => {
    const exp = binding(0);
    expect(rebindCurve(0, exp, { ...exp, xKey: 2 })).toBe(true);
    expect(graph().linkedCurves![0].xKey).toBe(2);
    expect(graph().linkedCurves![1]).toMatchObject({ datasetId: "b" });
    const now = binding(0);
    expect(rebindCurve(0, now, { ...now, xKey: null })).toBe(true);
    expect(graph().linkedCurves![0].xKey).toBeNull();
  });

  it("changes nothing when the binding is the one it already has", () => {
    const exp = binding(0);
    expect(rebindCurve(0, exp, exp)).toBe(false);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("refuses when the curve is no longer what the menu showed", () => {
    const stale = { ...binding(0), yKey: 2 };
    expect(rebindCurve(0, stale, { ...stale, yKey: 1 })).toBe(false);
    expect(toasts()).toMatch(/changed while the menu was open/);
    expect(useApp.getState().history).toHaveLength(0);
  });
});

describe("Change Worksheet", () => {
  it("lists sheets whose columns all resolve; ambiguous ones as refusals; missing ones are left out", () => {
    const ids = worksheetCandidates(useApp.getState(), binding(0)).map((c) => [c.sheet.id, "ambiguous" in c.resolution]);
    expect(ids).toEqual([["b", false], ["dup", true], ["loose", false]]);
  });

  it("moves the curve to the same-named columns of another sheet, one undo step", () => {
    const exp = binding(0);
    expect(exp.datasetId).toBe("a");
    expect(changeCurveWorksheet(0, exp, "loose")).toBe(true);
    expect(graph().linkedCurves![0]).toMatchObject({ datasetId: "loose", yKey: exp.yKey });
    expect(useApp.getState().seriesStyles[0]).toEqual({ color: "#ff0000" });
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(graph().linkedCurves![0]).toMatchObject({ datasetId: "a" });
  });

  it("refuses an ambiguous sheet with a message and changes nothing", () => {
    expect(changeCurveWorksheet(0, binding(0), "dup")).toBe(false);
    expect(toasts()).toMatch(/columns named/);
    expect(graph().linkedCurves![0]).toMatchObject({ datasetId: "a" });
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("refuses a sheet lacking a column", () => {
    expect(changeCurveWorksheet(0, binding(0), "lacking")).toBe(false);
    expect(graph().linkedCurves![0]).toMatchObject({ datasetId: "a" });
  });

  it("matches by name; an own X stays its own X", () => {
    expect(matchColumn(a, 0, b)).toEqual({ col: 0 });
    expect(matchColumn(a, 1, dup)).toHaveProperty("ambiguous");
    expect(matchColumn(a, 2, lacking)).toEqual({ none: true });
    expect(resolveOnSheet(a, { datasetId: "a", xKey: 0, yKey: 1 }, b)).toEqual({ binding: { datasetId: "b", xKey: 0, yKey: 1 } });
    expect(resolveOnSheet(a, { datasetId: "a", xKey: null, yKey: 1 }, b)).toEqual({ binding: { datasetId: "b", xKey: null, yKey: 1 } });
    expect(resolveOnSheet(a, { datasetId: "a", xKey: 0, yKey: 2 }, lacking)).toEqual({ none: true });
  });
});

describe("Hide others / Show all", () => {
  it("hides every other curve, then shows them all again, each one undo step", () => {
    useApp.setState({ hiddenChannels: [9] }); // not plotted: untouched
    hideOtherCurves(1, [0, 1]);
    expect([...useApp.getState().hiddenChannels].sort()).toEqual([0, 9]);
    expect(useApp.getState().history).toHaveLength(1);
    showAllCurves([0, 1]);
    expect(useApp.getState().hiddenChannels).toEqual([9]);
    expect(useApp.getState().history).toHaveLength(2);
    useApp.getState().undo();
    expect([...useApp.getState().hiddenChannels].sort()).toEqual([0, 9]);
  });

  it("is not an undo step when nothing changes", () => {
    showAllCurves([0, 1]);
    expect(useApp.getState().history).toHaveLength(0);
  });
});

describe("persistence", () => {
  it("a re-bound curve survives save / reopen", () => {
    const exp = binding(0);
    rebindCurve(0, exp, { ...exp, yKey: 2 });
    const back = parseWorkspace(serializeWorkspace({ datasets: useApp.getState().datasets }), { width: 5000, height: 5000 });
    const g = back.datasets.find((d) => d.linkedCurves)!;
    expect(g.linkedCurves![0]).toMatchObject({ datasetId: "a", yKey: 2 });
    expect(g.data.labels).toEqual(graph().data.labels);
  });
});
