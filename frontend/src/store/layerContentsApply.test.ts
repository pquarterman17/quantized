// Gap audit 3 N1: Layer Contents removes, reorders, re-binds and adds curves
// of a live graph as ONE undo step; every per-curve setting follows its curve,
// a re-bind never lands on a column the user did not pick, and Undo restores
// the graph exactly.

import { beforeEach, describe, expect, it } from "vitest";

import { layerRowsOf, newCurve, type LayerRow } from "../lib/layerContents";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import type { Dataset } from "../lib/types";
import { addDroppedToGraph, applyLayerContents, appendCurvesTo } from "./layerContentsApply";
import { flushLinkedCurves } from "./linkedCurvesSync";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const sheet = (id: string, y: number[], z: number[]): Dataset => ({
  id,
  name: `S${id}`,
  data: { time: y.map((_, i) => i), values: y.map((v, i) => [v, z[i]]), labels: ["Y", "Z"], units: ["V", "A"], metadata: {} },
});
const a = sheet("a", [1, 2], [10, 20]);
const b = sheet("b", [3, 4], [30, 40]);
const c = sheet("c", [5, 6], [50, 60]);

const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;
const curveIds = () => graph().linkedCurves!.map((k) => `${k.datasetId}${k.yKey}`);

beforeEach(async () => {
  useApp.setState({ datasets: [a, b, c], selectedIds: [], history: [], future: [] });
  useToasts.setState({ toasts: [] });
  await plotSelectedTogether(["a", "b", "c"]);
  // Per-curve settings on the graph's columns 0..2.
  useApp.setState({
    seriesStyles: { 0: { color: "#ff0000" }, 1: { color: "#00ff00" }, 2: { color: "#0000ff" } },
    seriesLabels: { 2: "third" },
    hiddenChannels: [1],
    history: [],
    future: [],
  });
});

describe("Layer Contents apply", () => {
  it("removes and reorders curves; styles, labels and hidden state follow; one undo step", () => {
    const rows = layerRowsOf(graph().linkedCurves!);
    // Draft: c, a  (b removed)
    expect(applyLayerContents(graph().id, [rows[2], rows[0]])).toBe(true);
    expect(curveIds()).toEqual(["c0", "a0"]);
    const s = useApp.getState();
    expect(s.seriesStyles).toEqual({ 0: { color: "#0000ff" }, 1: { color: "#ff0000" } });
    expect(s.seriesLabels).toEqual({ 0: "third" });
    expect(s.hiddenChannels).toEqual([]); // the hidden curve was the removed one
    expect(graph().data.labels).toEqual(["Sc", "Sa"]);
    expect(s.history).toHaveLength(1);
  });

  it("re-binds a curve to another source's X/Y, keeping its style", () => {
    const rows: LayerRow[] = layerRowsOf(graph().linkedCurves!);
    rows[0] = { ...rows[0], curve: newCurve(b, 0, 1) };
    applyLayerContents(graph().id, rows);
    expect(graph().linkedCurves![0]).toEqual({ datasetId: "b", xKey: 0, yKey: 1, label: "Sb: Z", labelFrom: "nameCol" });
    expect(useApp.getState().seriesStyles[0]).toEqual({ color: "#ff0000" });
    // Drawn from b: X = b's Y column (3, 4), Y = b's Z column.
    const col0 = graph().data.values.map((r) => r[0]).filter((v) => !Number.isNaN(v));
    expect(col0).toEqual([30, 40]);
    // Still live: an edit to b reaches the re-bound curve.
    useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.id === "b" ? { ...b, data: { ...b.data, values: [[3, 99], [4, 40]] } } : d)) }));
    flushLinkedCurves();
    expect(graph().data.values.map((r) => r[0]).filter((v) => !Number.isNaN(v))).toEqual([99, 40]);
  });

  it("refuses a re-bind with no Y picked (fail closed) and changes nothing", () => {
    const before = useApp.getState().datasets;
    const rows = layerRowsOf(graph().linkedCurves!);
    rows[1] = { ...rows[1], curve: { datasetId: "c", xKey: null, yKey: -1, label: "" } };
    expect(applyLayerContents(graph().id, rows)).toBe(false);
    expect(useApp.getState().datasets).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
    expect(useToasts.getState().toasts.map((t) => t.msg).join(" ")).toMatch(/choose a Y column/);
  });

  it("Undo restores the graph, its curves and every per-curve setting exactly; Redo re-applies", () => {
    const s0 = useApp.getState();
    const snapshot = { datasets: s0.datasets, seriesStyles: s0.seriesStyles, seriesLabels: s0.seriesLabels, hiddenChannels: s0.hiddenChannels, yKeys: s0.yKeys };
    const rows = layerRowsOf(graph().linkedCurves!);
    applyLayerContents(graph().id, [rows[2], { curve: newCurve(a, null, 1), from: null }, rows[0]]);
    expect(curveIds()).toEqual(["c0", "a1", "a0"]);
    useApp.getState().undo();
    const s1 = useApp.getState();
    expect({ datasets: s1.datasets, seriesStyles: s1.seriesStyles, seriesLabels: s1.seriesLabels, hiddenChannels: s1.hiddenChannels, yKeys: s1.yKeys }).toEqual(snapshot);
    useApp.getState().redo();
    expect(curveIds()).toEqual(["c0", "a1", "a0"]);
  });

  it("a point masked on the graph stays masked on the same point when the layer changes", () => {
    // Rows: a0 a1 | b0 b1 | c0 c1. Mask b's second point (graph row 3).
    useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.linkedCurves ? { ...d, excludedRows: [3] } : d)) }));
    const rows = layerRowsOf(graph().linkedCurves!);
    applyLayerContents(graph().id, [rows[2], rows[1]]); // c, b: c0 c1 | b0 b1
    expect(graph().excludedRows).toEqual([3]);
    applyLayerContents(graph().id, [layerRowsOf(graph().linkedCurves!)[1]]); // b alone: b1 = row 1
    expect(graph().excludedRows).toEqual([1]);
    expect(graph().data.values.map((r) => r[0])).toEqual([3, 4]);
  });

  it("a plain dataset's graph can take another of its own columns (no false cycle)", () => {
    useApp.setState({ activeId: "a", xKey: null, yKeys: [0], seriesOrder: null, hiddenChannels: [] });
    expect(appendCurvesTo("a", [newCurve(a, null, 1)])).toBe(true);
    const g = useApp.getState().datasets.filter((d) => d.linkedCurves).at(-1)!;
    expect(g.linkedCurves!.map((k) => `${k.datasetId}${k.yKey}`)).toEqual(["a0", "a1"]);
  });

  it("an added curve is drawn even when the view names its curves", () => {
    useApp.setState({ yKeys: [0, 2] });
    appendCurvesTo(graph().id, [newCurve(c, null, 1)]);
    expect(curveIds()).toEqual(["a0", "b0", "c0", "c1"]);
    expect(useApp.getState().yKeys).toEqual([0, 2, 3]);
  });
});

describe("Layer Contents review fixes (gap audit 3 N1)", () => {
  const roles = () => graph().data.metadata.error_roles;
  const pair = (channel: number, target: number) => ({ channel, target, axis: "y", side: "both" });

  it("confirmed error pairings (metadata.error_roles) follow their curves, and go with a removed one", () => {
    useApp.setState((st) => ({
      datasets: st.datasets.map((d) => (d.linkedCurves ? { ...d, data: { ...d.data, metadata: { ...d.data.metadata, error_roles: [pair(1, 0)] } } } : d)),
    }));
    const rows = layerRowsOf(graph().linkedCurves!);
    applyLayerContents(graph().id, [rows[2], rows[1], rows[0]]); // c, b, a
    expect(roles()).toEqual([pair(1, 2)]);
    applyLayerContents(graph().id, layerRowsOf(graph().linkedCurves!).slice(0, 2)); // drop a (the target)
    expect(roles()).toEqual([]);
  });

  it("a re-bound curve drops its typed legend label and its error-bar pairing, keeps its style", () => {
    useApp.setState((st) => ({
      seriesLabels: { 0: "Sample A, 300 K", 2: "third" },
      errKeys: { 0: 1 },
      datasets: st.datasets.map((d) => (d.linkedCurves ? { ...d, errorRoles: [{ channel: 1, target: 0, axis: "y" as const, side: "both" as const }] } : d)),
    }));
    const rows = layerRowsOf(graph().linkedCurves!);
    rows[0] = { ...rows[0], curve: newCurve(b, null, 1) };
    applyLayerContents(graph().id, rows);
    const s = useApp.getState();
    expect(s.seriesLabels).toEqual({ 2: "third" });
    expect(s.errKeys).toEqual({});
    expect(graph().errorRoles).toBeUndefined();
    expect(s.seriesStyles[0]).toEqual({ color: "#ff0000" });
    expect(graph().data.labels[0]).toBe("Sb: Z"); // the auto label follows the new data
  });

  it("a drop onto a plain graph whose window lost focus while loading is refused, not misapplied", async () => {
    useApp.setState({ activeId: "a", xKey: null, yKeys: [0], seriesOrder: null, hiddenChannels: [] });
    const before = useApp.getState().datasets.length;
    const pending = addDroppedToGraph("a", { book: "", dataset: "b" });
    useApp.setState({ activeId: "c" }); // focus moves before the drop resolves
    expect(await pending).toBe(false);
    expect(useApp.getState().datasets).toHaveLength(before);
    expect(useToasts.getState().toasts.map((t) => t.msg).join(" ")).toMatch(/took focus while it loaded/);
  });

  it("refuses a draft made against curves that have since changed", () => {
    const drafted = graph().linkedCurves!;
    const rows = layerRowsOf(drafted);
    appendCurvesTo(graph().id, [newCurve(c, null, 1)]); // the graph moves on
    expect(applyLayerContents(graph().id, [rows[1], rows[0]], drafted)).toBe(false);
    expect(curveIds()).toEqual(["a0", "b0", "c0", "c1"]);
    expect(useToasts.getState().toasts.map((t) => t.msg).join(" ")).toMatch(/changed while Layer Contents was open/);
  });
});
