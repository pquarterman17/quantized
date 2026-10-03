// Round-4 chrome audit: a NEW graph/panel/snapshot/document window used to
// open at its fixed default size (480x360, panels 760x560) whatever the stage
// size, so in a 1000x700 window part of it was clipped by the stage. New
// windows now fit the live stage (`plotCanvasBounds`); saved/existing window
// geometry is never touched.

import { beforeEach, describe, expect, it } from "vitest";

import type { PlotWindow } from "../lib/plotview";
import type { DataStruct, Dataset } from "../lib/types";
import { useApp } from "./useApp";

function ds(id: string, name: string): Dataset {
  const data: DataStruct = { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["a"], units: [""], metadata: {} };
  return { id, name, data };
}

const SMALL = { width: 560, height: 420 };

function inside(w: PlotWindow, b: { width: number; height: number }): boolean {
  const g = w.geometry;
  return g.x >= 0 && g.y >= 0 && g.x + g.w <= b.width && g.y + g.h <= b.height;
}

const created = (id: string | null) => useApp.getState().plotWindows.find((w) => w.id === id)!;

beforeEach(() => {
  const s = useApp.getState();
  const main = { ...s.plotWindows[0], winState: "normal" as const, geometry: { x: 900, y: 900, w: 2000, h: 1500 } };
  useApp.setState({
    datasets: [ds("a", "Alpha"), ds("b", "Beta")],
    activeId: "a",
    selectedIds: ["a", "b"],
    plotWindows: [main],
    focusedWindowId: main.id,
    plotCanvasBounds: SMALL,
  });
});

describe("a new window fits a small stage", () => {
  it("createWindow (New Graph Window)", () => {
    const id = useApp.getState().createWindow("a");
    expect(inside(created(id), SMALL)).toBe(true);
  });

  it("createPanelWindow (Panel / Overlay), whose default is 760x560", () => {
    const id = useApp.getState().createPanelWindow(["a", "b"], "grid");
    const w = created(id);
    expect(inside(w, SMALL)).toBe(true);
    expect(w.geometry).toMatchObject({ w: SMALL.width, h: SMALL.height });
  });

  it("createDocumentWindow, createSnapshotWindow and duplicateWindow", () => {
    const s = useApp.getState();
    expect(inside(created(s.createDocumentWindow("worksheet", "a")), SMALL)).toBe(true);
    const snap = s.createSnapshotWindow({} as never);
    expect(inside(created(snap), SMALL)).toBe(true);
    expect(inside(created(s.duplicateWindow(s.focusedWindowId!)), SMALL)).toBe(true);
  });

  it("createWindowAt (a Library drop) on a stage narrower than the default size", () => {
    const tiny = { width: 400, height: 300 };
    useApp.setState({ plotCanvasBounds: tiny });
    const w = created(useApp.getState().createWindowAt("a", 350, 250));
    expect(w.geometry).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it("successive windows keep cascading until the stage edge, then stay inside it", () => {
    for (let i = 0; i < 12; i++) {
      const id = useApp.getState().createWindow("a");
      expect(inside(created(id), SMALL), `window #${i + 1}`).toBe(true);
    }
  });

  it("keeps the default size and cascade spot on a stage big enough for it", () => {
    useApp.setState({ plotCanvasBounds: { width: 1400, height: 900 } });
    const id = useApp.getState().createWindow("a");
    expect(created(id).geometry).toEqual({ x: 64, y: 64, w: 480, h: 360 });
  });

  it("never touches an existing window's saved geometry", () => {
    const before = useApp.getState().plotWindows[0].geometry;
    useApp.getState().createWindow("a");
    useApp.getState().createPanelWindow(["a", "b"], "row");
    expect(useApp.getState().plotWindows[0].geometry).toEqual(before);
  });
});
