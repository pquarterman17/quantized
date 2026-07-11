// Tests for MAIN_PLAN #19 v1 (multi-dataset panel/overlay composite windows):
// createPanelWindow's window-record shape, dataset-removal pruning (a removed
// dataset drops out of the panel; an emptied panel window is never force-
// closed), and the .dwk persistence round-trip.

import { beforeEach, describe, expect, it } from "vitest";

import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import type { DataStruct, Dataset } from "../lib/types";
import { useApp } from "./useApp";

function ds(id: string, name: string): Dataset {
  const data: DataStruct = {
    time: [0, 1, 2],
    values: [[1], [2], [3]],
    labels: ["a"],
    units: ["emu"],
    metadata: {},
  };
  return { id, name, data };
}

beforeEach(() => {
  const s = useApp.getState();
  useApp.setState({
    datasets: [ds("a", "Alpha"), ds("b", "Beta"), ds("c", "Gamma")],
    activeId: "a",
    selectedIds: ["a", "b"],
    plotWindows: [s.plotWindows[0]], // keep the invariant single default window
    focusedWindowId: s.focusedWindowId,
  });
});

describe("createPanelWindow", () => {
  it("creates a new kind:'panel' window carrying the datasetIds + layout, unfocused", () => {
    const before = useApp.getState().focusedWindowId;
    const id = useApp.getState().createPanelWindow(["a", "b"], "grid");
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win).toBeDefined();
    expect(win?.kind).toBe("panel");
    expect(win?.datasetId).toBeNull();
    expect(win?.panel).toEqual({ datasetIds: ["a", "b"], layout: "grid" });
    // Creating never moves focus (matches createWindow's own contract).
    expect(useApp.getState().focusedWindowId).toBe(before);
  });

  it("titles the window from the selected datasets' names, deduped against existing titles", () => {
    const id = useApp.getState().createPanelWindow(["a", "b"], "row");
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win?.title).toBe("Panel: Alpha, Beta");
  });

  it("overlay layout titles with the 'Overlay:' prefix", () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "overlay");
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win?.title).toBe("Overlay: Alpha, Beta, Gamma");
  });

  it("places the new window on top (highest z) without closing/hiding others", () => {
    const before = useApp.getState().plotWindows.length;
    const id = useApp.getState().createPanelWindow(["a", "b"], "column");
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(before + 1);
    const win = s.plotWindows.find((w) => w.id === id)!;
    expect(win.z).toBe(Math.max(...s.plotWindows.map((w) => w.z)));
  });
});

describe("dataset-removal pruning (item 19's 'a removed dataset drops out of the panel')", () => {
  it("removeDataset drops the removed id from panel.datasetIds, keeps the window open", () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    useApp.getState().removeDataset("b");
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win).toBeDefined(); // never force-closed
    expect(win?.panel?.datasetIds).toEqual(["a", "c"]);
  });

  it("removing every dataset in a panel empties datasetIds without closing the window", () => {
    const id = useApp.getState().createPanelWindow(["a", "b"], "overlay");
    useApp.getState().removeDataset("a");
    useApp.getState().removeDataset("b");
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win).toBeDefined();
    expect(win?.panel?.datasetIds).toEqual([]);
  });

  it("removeSelected also prunes panel.datasetIds", () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    useApp.setState({ selectedIds: ["b", "c"] });
    useApp.getState().removeSelected();
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win?.panel?.datasetIds).toEqual(["a"]);
  });

  it("a plain plot window's datasetId still nulls out (pruning didn't regress it)", () => {
    useApp.getState().setActive("a");
    useApp.getState().removeDataset("a");
    const focused = useApp.getState().plotWindows.find((w) => w.id === useApp.getState().focusedWindowId);
    expect(focused?.datasetId).toBeNull();
  });
});

describe(".dwk persistence round-trip", () => {
  it("a panel window's datasetIds/layout survive serialize -> parse", () => {
    const id = useApp.getState().createPanelWindow(["a", "c"], "overlay");
    const s = useApp.getState();
    const text = serializeWorkspace({ datasets: s.datasets, plotWindows: s.windowsForSave() });
    const loaded = parseWorkspace(text);
    const win = loaded.plotWindows.find((w) => w.id === id);
    expect(win?.kind).toBe("panel");
    expect(win?.panel).toEqual({ datasetIds: ["a", "c"], layout: "overlay" });
  });

  it("a stale dataset id (removed from the library since save) drops out on load; the window still loads", () => {
    const id = useApp.getState().createPanelWindow(["a", "b"], "grid");
    const s = useApp.getState();
    const text = serializeWorkspace({ datasets: s.datasets, plotWindows: s.windowsForSave() });
    // Simulate loading against a library that no longer has "b": strip it
    // from the serialized `datasets` array (parseWorkspace derives its live
    // dsIds set from that same array) while the panel window's `datasetIds`
    // still references it, exactly like a real stale-ref .dwk would.
    const doc = JSON.parse(text) as { datasets: { id: string }[] };
    doc.datasets = doc.datasets.filter((d) => d.id !== "b");
    const loaded = parseWorkspace(JSON.stringify(doc));
    const win = loaded.plotWindows.find((w) => w.id === id);
    expect(win).toBeDefined(); // never dropped, just emptied of the stale id
    expect(win?.panel?.datasetIds).toEqual(["a"]);
  });
});
