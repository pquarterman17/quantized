// B1/B2 (visual sweep vs Origin's own rendered graphs): multi-layer pages.
// B1: a window of stacked layers that each plot several books ("Fixed Lambdas
// SI" Graph5/6: two layers of 4 and 6 books) showed only the clicked layer;
// every layer must stay its own panel. B2: a top-X layer (SerialCore Bqqbar
// Graph2: same frame and Y, its own X drawn on top) was split into a second
// stacked panel; it must share the host's plot, its X mapped onto the host's.
// Negative controls: undecoded or overlapping-but-unequal geometry keeps the
// clicked layer's overlay (fail closed, as before); a genuine double-Y stays
// double-Y; panels whose frames are apart are never top-X paired.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpatialComposition } from "../lib/composition";
import { overlayTopXPair, topXAxis, topXMap } from "../lib/originOverlayFigure";
import { topForward } from "../lib/axisTop";
import type { Dataset, DataStruct, OriginFigure } from "../lib/types";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

beforeAll(async () => {
  await loadOriginApplyLibs();
});

const book = (name: string, xs: number[], scale: number): DataStruct => ({
  time: xs,
  values: xs.map((_, i) => [scale * (i + 1)]),
  labels: [`${name} y`],
  units: [""],
  metadata: { origin_book: name, x_column_name: "A", origin_column_names: ["B"] },
});
const datasets: Dataset[] = [
  { id: "d1", name: "P:B1", data: book("B1", [0, 1000, 2000], 1) },
  { id: "d2", name: "P:B2", data: book("B2", [0, 1000, 2000], 2) },
  { id: "d3", name: "P:B3", data: book("B3", [0, 1000, 2000], 3) },
  { id: "d4", name: "P:B4", data: book("B4", [2, 4, 8], 4) },
];
const ids = datasets.map((d) => d.id);
const top = { left: 100, top: 100, right: 900, bottom: 500 };
const bottom = { left: 100, top: 500, right: 900, bottom: 900 };

type Frame = OriginFigure["frame"];
const layer = (id: string, n: number, books: string[], frame: Frame, over: Partial<OriginFigure> = {}) => ({
  id, stem: "P", datasetId: `d${books[0].slice(1)}`, siblingIds: ids,
  figure: {
    name: "G", layer: n, frame,
    x_from: 0, x_to: 2500, x_log: false, y_from: n === 1 ? -1 : -2, y_to: 10, y_log: false,
    n_curves: books.length, annotations: [] as string[],
    curves: books.map((b) => ({ book: b, x: "A", y: "B" })),
    ...over,
  } as OriginFigure,
});

const panelsOf = (): SpatialComposition["panels"] => {
  const c = useApp.getState().composition;
  return c && "panels" in c ? (c as SpatialComposition).panels : [];
};

beforeEach(() => {
  useApp.setState({
    datasets, activeId: null, history: [], future: [], macroSteps: [],
    xKey: null, yKeys: null, y2Keys: null, hiddenChannels: [], composition: null, stackMode: false,
  });
});

describe("B1: stacked layers that each plot several books keep every panel", () => {
  beforeEach(() => {
    useApp.setState({
      originFigures: [layer("L1", 1, ["B1", "B2"], top), layer("L2", 2, ["B2", "B3", "B4"], bottom)],
    });
  });

  it.each(["L1", "L2"])("applying %s draws both layers as stacked panels on their own overlays", (id) => {
    useApp.getState().applyOriginFigure(id);
    const s = useApp.getState();
    expect(s.stackMode).toBe(true);
    const panels = panelsOf();
    expect(panels.map((p) => [p.row, p.col])).toEqual([[0, 0], [1, 0]]);
    const shown = panels.map((p) => s.datasets.find((d) => d.id === p.datasetId)!);
    expect(shown.map((d) => d.data.metadata?.origin_overlay)).toEqual([true, true]);
    expect(shown[0].data.labels).toEqual(["B1: B1 y", "B2: B2 y"]);
    expect(shown[1].data.labels).toEqual(["B2: B2 y", "B3: B3 y", "B4: B4 y"]);
    expect(panels.map((p) => p.yKeys)).toEqual([[0, 1], [0, 1, 2]]);
    expect(panels.map((p) => p.yLim)).toEqual([[-1, 10], [-2, 10]]);
    // Each overlay belongs to its own layer, so a re-apply refreshes in place.
    expect(shown.map((d) => d.data.metadata?.origin_overlay_entry)).toEqual(["L1", "L2"]);
  });

  it("re-applying refreshes the same overlays instead of adding more", () => {
    useApp.getState().applyOriginFigure("L1");
    const n = useApp.getState().datasets.length;
    useApp.getState().applyOriginFigure("L2");
    expect(useApp.getState().datasets.length).toBe(n);
    expect(n).toBe(datasets.length + 2);
  });

  it("fails closed to the clicked layer's overlay when the frames are undecoded", () => {
    useApp.setState({
      originFigures: [layer("L1", 1, ["B1", "B2"], null), layer("L2", 2, ["B2", "B3"], null)],
    });
    useApp.getState().applyOriginFigure("L2");
    const s = useApp.getState();
    expect(s.stackMode).toBe(false);
    expect(s.datasets.find((d) => d.id === s.activeId)!.data.labels).toEqual(["B2: B2 y", "B3: B3 y"]);
    // Nothing staged for the panel apply was left behind.
    expect(s.datasets.length).toBe(datasets.length + 1);
  });

  it("leaves one-book layers on the plain panel path (no overlay built)", () => {
    useApp.setState({ originFigures: [layer("L1", 1, ["B1"], top), layer("L2", 2, ["B3"], bottom)] });
    useApp.getState().applyOriginFigure("L1");
    const s = useApp.getState();
    expect(panelsOf().map((p) => p.datasetId)).toEqual(["d1", "d3"]);
    expect(s.datasets.length).toBe(datasets.length);
  });
});

describe("B2: a top-X layer shares its host's plot", () => {
  const host = () => layer("H", 1, ["B1", "B2"], top, { y_from: -700, y_to: 100 });
  const upper = () => layer("T", 2, ["B4"], top, { x_from: 0, x_to: 10, y_from: -700, y_to: 100, x_title: "1/mu" });

  it.each(["H", "T"])("applying %s draws one plot, the top layer's X mapped onto the host's", (id) => {
    useApp.setState({ originFigures: [host(), upper()] });
    useApp.getState().applyOriginFigure(id);
    const s = useApp.getState();
    expect(s.stackMode).toBe(false);
    const shown = s.datasets.find((d) => d.id === s.activeId)!;
    expect(shown.data.labels).toEqual(["B1: B1 y", "B2: B2 y", "B4: B4 y"]);
    expect(s.yKeys).toEqual([0, 1, 2]);
    expect(s.y2Keys).toBeNull(); // shares the host's Y, never a right axis
    expect(s.xLim).toEqual([0, 2500]);
    // B4's X 2, 4, 8 (top units, 0..10) sit at 500, 1000, 2000 on the host's 0..2500.
    expect(shown.data.time.slice(-3)).toEqual([500, 1000, 2000]);
    const t = s.xFmt.top!;
    expect(t).toMatchObject({ kind: "linear", title: "1/mu" });
    expect(topForward(t, 2500)).toBeCloseTo(10);
    expect(topForward(t, 1000)).toBeCloseTo(4);
  });

  it("a later plain apply drops the top axis", () => {
    useApp.setState({ originFigures: [host(), upper(), { ...layer("S", 1, ["B1"], top), figure: { ...layer("S", 1, ["B1"], top).figure, name: "Solo" } }] });
    useApp.getState().applyOriginFigure("H");
    expect(useApp.getState().xFmt.top).toBeDefined();
    useApp.getState().applyOriginFigure("S");
    expect(useApp.getState().xFmt.top).toBeUndefined();
  });
});

describe("overlayTopXPair", () => {
  const a = layer("H", 1, ["B1"], top, { y_from: 0, y_to: 1 });
  const b = layer("T", 2, ["B4"], top, { x_from: 0, x_to: 10, y_from: 0, y_to: 1 });

  it("pairs one frame, one Y range, two X ranges (either order)", () => {
    expect(overlayTopXPair([b, a])?.map((e) => e.id)).toEqual(["H", "T"]);
    expect(topXMap(a.figure, b.figure)).toEqual({ scale: 250, shift: 0 });
    expect(topXAxis(a.figure, b.figure)).toMatchObject({ kind: "linear", factor: 1 / 250, shift: -0 });
  });

  it("never pairs: a double-Y (same X), separate panels, undecoded frames, a log X, no curves, or 3 layers", () => {
    expect(overlayTopXPair([a, { ...b, figure: { ...b.figure, x_from: 0, x_to: 2500, y_to: 5 } }])).toBeNull();
    expect(overlayTopXPair([a, { ...b, figure: { ...b.figure, frame: bottom } }])).toBeNull();
    expect(overlayTopXPair([a, { ...b, figure: { ...b.figure, frame: null } }])).toBeNull();
    expect(overlayTopXPair([a, { ...b, figure: { ...b.figure, x_log: true, x_from: 1 } }])).toBeNull();
    expect(overlayTopXPair([a, { ...b, figure: { ...b.figure, y_to: 2 } }])).toBeNull();
    expect(overlayTopXPair([a, { ...b, figure: { ...b.figure, curves: [] } }])).toBeNull();
    expect(overlayTopXPair([a, b, layer("X", 3, ["B2"], bottom)])).toBeNull();
  });
});
