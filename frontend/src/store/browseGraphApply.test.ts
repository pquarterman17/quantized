// Item 22: Browse graph steps one curve through columns / same-shaped sheets
// through the real rebind path (one undo step, style kept, ring wraps).

import { beforeEach, describe, expect, it } from "vitest";

import { planBrowse, visibleCurves } from "../lib/browseGraph";
import { curveBindingAt } from "../lib/curveRebind";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import type { Dataset } from "../lib/types";
import { browseGraph } from "./browseGraphApply";
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
const a = sheet("a", ["T", "R", "M", "N"], 100);
const b = sheet("b", ["T", "R", "M", "N"], 200);
const dup = sheet("dup", ["T", "R", "R", "N"], 300); // R twice: ambiguous, skipped
const lacking = sheet("lacking", ["T", "Q"], 400); // no R: not offered

const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;
const toasts = () => useToasts.getState().toasts.map((t) => t.msg).join(" | ");

beforeEach(() => {
  useApp.setState({
    datasets: [a, b, dup, lacking], activeId: "a", selectedIds: [], history: [], future: [], workbooks: [],
    xKey: null, yKeys: [1], hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {},
  });
  useToasts.setState({ toasts: [] });
});

describe("Browse graph: columns", () => {
  it("steps a plain graph's curve through the sheet's columns, wrapping, one undo step each", () => {
    expect(browseGraph("column", 1)).toBe(true); // R -> M; the plain graph becomes a live one
    expect(graph().linkedCurves).toHaveLength(1);
    expect(graph().linkedCurves![0]).toMatchObject({ datasetId: "a", yKey: 2 });
    useApp.setState({ history: [] });
    expect(browseGraph("column", 1)).toBe(true); // M -> N
    expect(graph().linkedCurves![0].yKey).toBe(3);
    expect(useApp.getState().history).toHaveLength(1);
    expect(browseGraph("column", 1)).toBe(true); // N -> T (wraps; T is a column, the X is the sheet's own)
    expect(graph().linkedCurves![0].yKey).toBe(0);
    expect(browseGraph("column", -1)).toBe(true); // back to N
    expect(graph().linkedCurves![0].yKey).toBe(3);
    useApp.getState().undo();
    expect(graph().linkedCurves![0].yKey).toBe(0);
  });

  it("keeps the curve's style and the other curves", async () => {
    useApp.setState({ datasets: [a, b], activeId: null, selectedIds: [] });
    await plotSelectedTogether(["a", "b"]);
    useApp.setState({ seriesStyles: { 0: { color: "#ff0000" }, 1: { color: "#00ff00" } }, history: [] });
    const other = { ...graph().linkedCurves![1] };
    expect(browseGraph("column", 1, 0)).toBe(true);
    expect(useApp.getState().seriesStyles[0]).toEqual({ color: "#ff0000" });
    expect(graph().linkedCurves![1]).toEqual(other);
  });

  it("refuses when a hidden curve would be dropped, and changes nothing", () => {
    useApp.setState({ yKeys: [1, 2], hiddenChannels: [2] });
    expect(browseGraph("column", 1)).toBe(false);
    expect(toasts()).toContain("Show all curves first");
    expect(useApp.getState().datasets.some((d) => d.linkedCurves)).toBe(false);
  });

  it("refuses a sheet with nothing to step to", () => {
    useApp.setState({ datasets: [{ ...lacking, data: { ...lacking.data, labels: ["Q"], values: [[1], [2]] } }], activeId: "lacking", yKeys: [0] });
    expect(planBrowse(useApp.getState(), "column", 1)).toMatchObject({ ok: false });
  });
});

describe("Browse graph: sheets", () => {
  it("steps through the sheets that carry the same columns, skipping ambiguous and lacking ones", () => {
    expect(browseGraph("sheet", 1)).toBe(true); // a -> b (dup is ambiguous, lacking has no R)
    expect(graph().linkedCurves![0]).toMatchObject({ datasetId: "b", yKey: 1 });
    expect(browseGraph("sheet", 1)).toBe(true); // wraps back to a
    expect(graph().linkedCurves![0]).toMatchObject({ datasetId: "a", yKey: 1 });
    expect(browseGraph("sheet", -1)).toBe(true);
    expect(graph().linkedCurves![0].datasetId).toBe("b");
  });

  it("keeps the browsed column when moving to the next sheet (the same name on the new sheet)", () => {
    browseGraph("column", 1); // M on a
    browseGraph("sheet", 1);
    expect(graph().linkedCurves![0]).toMatchObject({ datasetId: "b", yKey: 2 });
    expect(curveBindingAt(useApp.getState(), 0)).toMatchObject({ datasetId: "b", yKey: 2 });
    expect(visibleCurves(useApp.getState())).toEqual([0]);
  });
});
