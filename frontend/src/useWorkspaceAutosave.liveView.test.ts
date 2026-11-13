// Figures integration (owner must-fix): a view-only edit of the FOCUSED
// window -- an axis break, a title, a reference line, a shade, stat mode --
// changes only the store's live PlotView fields, never `plotWindows`, so it
// scheduled no autosave and a reload lost it. Reload here = save through the
// real debounced autosave, then mount a fresh session on what was saved.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { setAutosaveBackend } from "./lib/autosave";
import { memoryBackend } from "./lib/autosaveBackend";
import type { Dataset } from "./lib/types";
import { useApp } from "./store/useApp";
import { useRecentProjects } from "./store/recentProjects";
import { useWorkspaceAutosave } from "./useWorkspaceAutosave";

const ds: Dataset = { id: "a", name: "a.csv", data: { time: [0, 1, 2], values: [[1], [2], [1000]], labels: ["y"], units: [""], metadata: {} } };

async function settle(ms: number) {
  await act(async () => {
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("autosave keeps the focused window's view-only edits across a reload", () => {
  it("an axis break, a title, a reference line and a shade survive", async () => {
    const backend = memoryBackend();
    setAutosaveBackend(backend);
    useRecentProjects.setState({ recentProjects: [] });
    useApp.setState(useApp.getInitialState(), true);
    const first = renderHook(() => useWorkspaceAutosave());
    await settle(50);
    act(() => useApp.getState().addDataset(ds));
    await settle(1000); // the dataset's own save
    const before = (await backend.read()).length;

    act(() => {
      const s = useApp.getState();
      useApp.setState({ yFmt: { mode: "auto", digits: 2, breaks: [[3, 900]] } });
      s.setPlotTitle("Sweep");
      s.addRefLine("x", 1);
      s.addRegionShade({ x1: 0, y1: 0, x2: 1, y2: 1, fill: "#336699", fullHeight: true });
    });
    expect(useApp.getState().projectDirty).toBe(true);
    await settle(1000);
    const gens = await backend.read();
    expect(gens.length).toBeGreaterThan(before);
    first.unmount();

    // Reload: a fresh session restores from what autosave wrote.
    useApp.setState(useApp.getInitialState(), true);
    setAutosaveBackend(memoryBackend(gens));
    renderHook(() => useWorkspaceAutosave());
    await settle(200);
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.name)).toEqual(["a.csv"]);
    expect(s.yFmt.breaks).toEqual([[3, 900]]);
    expect(s.plotTitle).toBe("Sweep");
    expect(s.refLines).toHaveLength(1);
    expect(s.regionShades).toHaveLength(1);
  });
});
