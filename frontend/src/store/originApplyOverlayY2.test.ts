// A8 (visual sweep vs Origin's saved previews): a double-Y graph window whose
// main layer combines several books (a cross-book overlay) must keep its
// right-axis layer. Absorption-D3.opju Cys_Cu: layer 1 plots four books
// against y 0..1, layer 2 one curve of a fifth book against y2 0..2 on the
// same X range and frame. The apply drew layer 1 only. Negative controls: a
// 2-layer window whose layers do NOT share an X range (two panels), and one
// whose frames are decoded apart, never merge.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { overlayDoubleYPair } from "../lib/originOverlayFigure";
import type { Dataset, DataStruct, OriginFigure } from "../lib/types";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

beforeAll(async () => {
  await loadOriginApplyLibs();
});

const book = (name: string, scale: number): DataStruct => ({
  time: [300, 350, 400],
  values: [[scale], [2 * scale], [3 * scale]],
  labels: [`${name} y`],
  units: [""],
  metadata: { origin_book: name, x_column_name: "A", origin_column_names: ["B"] },
});
const datasets: Dataset[] = [
  { id: "d1", name: "P:B1", data: book("B1", 0.1) },
  { id: "d2", name: "P:B2", data: book("B2", 0.2) },
  { id: "d3", name: "P:B3", data: book("B3", 1.5) },
];
const ids = datasets.map((d) => d.id);
const frame = { left: 10, top: 10, right: 90, bottom: 90 };

const layer = (id: string, n: number, books: string[], over: Partial<OriginFigure> = {}) => ({
  id, stem: "P", datasetId: `d${books[0].slice(1)}`, siblingIds: ids,
  figure: {
    name: "Cys", layer: n, frame,
    x_from: 300, x_to: 450, x_log: false, y_from: 0, y_to: n === 1 ? 1 : 2, y_log: false,
    n_curves: books.length, annotations: [] as string[],
    curves: books.map((b) => ({ book: b, x: "A", y: "B" })),
    ...over,
  },
});

beforeEach(() => {
  useApp.setState({
    datasets, activeId: null, history: [], future: [], macroSteps: [],
    originFigures: [layer("L1", 1, ["B1", "B2"]), layer("L2", 2, ["B3"])],
    xKey: null, yKeys: null, y2Keys: null, hiddenChannels: [],
  });
});

describe("applyOriginFigure — cross-book double-Y (A8)", () => {
  it.each(["L1", "L2"])("applying %s draws both layers, layer 2 on the right axis", (id) => {
    useApp.getState().applyOriginFigure(id);
    const s = useApp.getState();
    const shown = s.datasets.find((d) => d.id === s.activeId)!;
    expect(shown.data.metadata?.origin_overlay).toBe(true);
    expect(shown.data.labels).toEqual(["B1: B1 y", "B2: B2 y", "B3: B3 y"]);
    expect(s.yKeys).toEqual([0, 1, 2]);
    expect(s.y2Keys).toEqual([2]);
    expect(s.yLim).toEqual([0, 1]);
    expect(s.y2Lim).toEqual([0, 2]);
    expect(s.xLim).toEqual([300, 450]);
  });

  it("re-applying a plain cross-book figure afterwards clears the right axis", () => {
    useApp.getState().applyOriginFigure("L1");
    useApp.setState({ originFigures: [{ ...layer("solo", 1, ["B1", "B2"]), figure: { ...layer("solo", 1, ["B1", "B2"]).figure, name: "Solo" } }] });
    useApp.getState().applyOriginFigure("solo");
    expect(useApp.getState().y2Keys).toBeNull();
  });
});

describe("overlayDoubleYPair", () => {
  const a = layer("L1", 1, ["B1", "B2"]);
  const b = layer("L2", 2, ["B3"]);

  it("pairs a 2-layer window with one X range, two Y ranges and one frame (either order)", () => {
    expect(overlayDoubleYPair([b, a])?.map((e) => e.id)).toEqual(["L1", "L2"]);
  });

  it("never merges two panels: frames undecoded or apart, different X range, same Y range, a layer with no curves, or 3 layers", () => {
    // Undecoded frames keep the spatial multi-panel apply (Fixed Lambdas-style stacks).
    expect(overlayDoubleYPair([a, { ...b, figure: { ...b.figure, frame: null } }])).toBeNull();
    expect(overlayDoubleYPair([a, { ...b, figure: { ...b.figure, x_from: 0 } }])).toBeNull();
    expect(overlayDoubleYPair([a, { ...b, figure: { ...b.figure, y_to: 1 } }])).toBeNull();
    const apart = { left: 10, top: 100, right: 90, bottom: 180 };
    expect(overlayDoubleYPair([a, { ...b, figure: { ...b.figure, frame: apart } }])).toBeNull();
    expect(overlayDoubleYPair([a, { ...b, figure: { ...b.figure, curves: [] } }])).toBeNull();
    expect(overlayDoubleYPair([a, b, layer("L3", 3, ["B1"])])).toBeNull();
  });
});
