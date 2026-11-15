// Gap audit 3 N3: "Link X axis with…" puts the picked graph windows in one
// x-link group (lib/windowsync.ts zooms them together), unticking unlinks, it
// is one undo step, and the link survives a .dwk save/load.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../store/useApp";
import { defaultPlotView, type PlotWindow } from "./plotview";
import type { Dataset } from "./types";
import { linkXAxisWith, linkXGroups, linkYAxisWith } from "./windowLinkX";
import { parseWorkspace } from "./workspace";
import { serializeWorkspace } from "./workspaceSerialize";

vi.mock("../store/paramDialog", () => ({ askParams: vi.fn() }));
import { askParams } from "../store/paramDialog";

const win = (id: string, linkGroup: number | null = null, kind: PlotWindow["kind"] = "plot"): PlotWindow => ({
  id, kind, title: id.toUpperCase(), datasetId: "d", geometry: { x: 0, y: 0, w: 300, h: 200 }, z: 0,
  winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup, pinned: false,
});
const ds: Dataset = { id: "d", name: "d", data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} } };
const groups = () => Object.fromEntries(useApp.getState().plotWindows.map((w) => [w.id, w.linkGroup]));

beforeEach(() => {
  useApp.setState({ datasets: [ds], activeId: "d", plotWindows: [win("a"), win("b"), win("c")], focusedWindowId: "a", history: [], future: [] });
});

describe("linkXGroups", () => {
  it("joins the picked windows in a group nobody else uses, and drops unpicked members", () => {
    expect([...linkXGroups([win("a"), win("b"), win("c", 1)], "a", ["b"])!]).toEqual([["a", 2], ["b", 2]]);
    expect([...linkXGroups([win("a", 1), win("b", 1), win("c", 1)], "a", ["c"])!]).toEqual([["b", null]]);
  });

  it("never borrows another link group when all are taken: refuses instead", () => {
    const busy = [win("a"), win("b"), win("c", 1), win("d", 1), win("e", 2), win("f", 2), win("g", 3), win("h", 3)];
    expect(linkXGroups(busy, "a", ["b"])).toBeNull();
  });

  it("picking none unlinks this window (and a partner left alone)", () => {
    expect([...linkXGroups([win("a", 1), win("b", 1)], "a", [])!]).toEqual([["a", null], ["b", null]]);
    expect([...linkXGroups([win("a", 1), win("b", 1), win("c", 1)], "a", [])!]).toEqual([["a", null]]);
  });
});

describe("Link X axis with…", () => {
  it("links the ticked windows as one undo step, and the link round-trips a .dwk", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({ b: true, c: false });
    await linkXAxisWith();
    expect(vi.mocked(askParams).mock.calls[0][1].map((f) => f.label)).toEqual(["B", "C"]);
    expect(groups()).toEqual({ a: 1, b: 1, c: null });
    expect(useApp.getState().history).toHaveLength(1);

    const loaded = parseWorkspace(serializeWorkspace(useApp.getState()));
    useApp.getState().loadWorkspace(loaded);
    const after = Object.fromEntries(useApp.getState().plotWindows.map((w) => [w.title, w.linkGroup]));
    expect(after).toMatchObject({ A: 1, B: 1, C: null });
  });

  it("unticking every window unlinks; Undo relinks", async () => {
    useApp.setState({ plotWindows: [win("a", 1), win("b", 1), win("c")] });
    vi.mocked(askParams).mockResolvedValueOnce({ b: false, c: false });
    await linkXAxisWith();
    expect(groups()).toEqual({ a: null, b: null, c: null });
    useApp.getState().undo();
    expect(groups()).toEqual({ a: 1, b: 1, c: null });
  });
});

// Gap audit 4 G19: "Link Y axis with…" -- the same group model on its own
// field (`linkYGroup`), the same refusals, independent of the X link.
const winY = (id: string, linkYGroup: number | null = null, linkGroup: number | null = null): PlotWindow => ({ ...win(id, linkGroup), linkYGroup });
const yGroups = () => Object.fromEntries(useApp.getState().plotWindows.map((w) => [w.id, w.linkYGroup ?? null]));

describe("linkXGroups on the Y field", () => {
  it("groups by linkYGroup only: an X link with the same number is not a Y link", () => {
    expect([...linkXGroups([winY("a", null, 1), winY("b", null, 1), winY("c", 1)], "a", ["b"], "linkYGroup")!]).toEqual([["a", 2], ["b", 2]]);
  });

  it("refuses when every Y group is taken, exactly as X does", () => {
    const busy = [winY("a"), winY("b"), winY("c", 1), winY("d", 1), winY("e", 2), winY("f", 2), winY("g", 3), winY("h", 3)];
    expect(linkXGroups(busy, "a", ["b"], "linkYGroup")).toBeNull();
  });
});

describe("Link Y axis with…", () => {
  it("links Y as one undo step, leaves X alone, and round-trips a .dwk", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({ b: true, c: false });
    await linkYAxisWith();
    expect(vi.mocked(askParams).mock.calls.at(-1)![0]).toMatch(/^Link Y axis of/);
    expect(yGroups()).toEqual({ a: 1, b: 1, c: null });
    expect(groups()).toEqual({ a: null, b: null, c: null });
    expect(useApp.getState().history).toHaveLength(1);
    const loaded = parseWorkspace(serializeWorkspace(useApp.getState()));
    useApp.getState().loadWorkspace(loaded);
    const after = Object.fromEntries(useApp.getState().plotWindows.map((w) => [w.title, w.linkYGroup ?? null]));
    expect(after).toMatchObject({ A: 1, B: 1, C: null });
    useApp.getState().undo();
  });

  it("refuses without a focused graph or another graph window", async () => {
    vi.mocked(askParams).mockClear();
    useApp.setState({ plotWindows: [winY("a")] });
    await linkYAxisWith();
    expect(askParams).not.toHaveBeenCalled();
    useApp.setState({ plotWindows: [winY("a"), winY("b")], focusedWindowId: null });
    await linkYAxisWith();
    expect(askParams).not.toHaveBeenCalled();
    expect(yGroups()).toEqual({ a: null, b: null });
  });

  it("a hand-edited .dwk cannot smuggle in a Y group out of range", () => {
    useApp.setState({ plotWindows: [winY("a", 9), winY("b", 2)] });
    const loaded = parseWorkspace(serializeWorkspace(useApp.getState()));
    useApp.getState().loadWorkspace(loaded);
    expect(Object.fromEntries(useApp.getState().plotWindows.map((w) => [w.title, w.linkYGroup ?? null]))).toEqual({ A: null, B: 2 });
  });
});
