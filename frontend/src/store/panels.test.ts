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

  it("a reordered panel's datasetIds survive serialize -> parse (drag-to-rearrange follow-up)", () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    useApp.getState().reorderPanelDatasets(id, 0, 2); // a -> c's slot: [b, c, a]
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === id)?.panel?.datasetIds).toEqual(["b", "c", "a"]);
    const text = serializeWorkspace({ datasets: s.datasets, plotWindows: s.windowsForSave() });
    const loaded = parseWorkspace(text);
    const win = loaded.plotWindows.find((w) => w.id === id);
    expect(win?.panel).toEqual({ datasetIds: ["b", "c", "a"], layout: "grid" });
  });
});

describe("reorderPanelDatasets (drag-to-rearrange follow-up)", () => {
  it("splices the dragged id into the target's slot", () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    useApp.getState().reorderPanelDatasets(id, 0, 2);
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win?.panel?.datasetIds).toEqual(["b", "c", "a"]);
  });

  it("self-drop is a no-op", () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    useApp.getState().reorderPanelDatasets(id, 1, 1);
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win?.panel?.datasetIds).toEqual(["a", "b", "c"]);
  });

  it("an unknown window id is a no-op, never throws", () => {
    useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    expect(() => useApp.getState().reorderPanelDatasets("nope", 0, 1)).not.toThrow();
  });

  it("a non-panel window is untouched (its own reorder would be meaningless)", () => {
    const before = useApp.getState().plotWindows[0];
    useApp.getState().reorderPanelDatasets(before.id, 0, 1);
    const after = useApp.getState().plotWindows.find((w) => w.id === before.id);
    expect(after).toEqual(before);
  });

  it("only touches the targeted window, leaves sibling panel windows alone", () => {
    const id1 = useApp.getState().createPanelWindow(["a", "b"], "grid");
    const id2 = useApp.getState().createPanelWindow(["a", "c"], "row");
    useApp.getState().reorderPanelDatasets(id1, 0, 1);
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === id1)?.panel?.datasetIds).toEqual(["b", "a"]);
    expect(s.plotWindows.find((w) => w.id === id2)?.panel?.datasetIds).toEqual(["a", "c"]);
  });
});

describe("removeFromPanel (cell header's x chip)", () => {
  it("drops the dataset id, keeps the window open", () => {
    const id = useApp.getState().createPanelWindow(["a", "b", "c"], "grid");
    useApp.getState().removeFromPanel(id, "b");
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win).toBeDefined();
    expect(win?.panel?.datasetIds).toEqual(["a", "c"]);
  });

  it("removing down to a single cell is fine", () => {
    const id = useApp.getState().createPanelWindow(["a", "b"], "grid");
    useApp.getState().removeFromPanel(id, "b");
    expect(useApp.getState().plotWindows.find((w) => w.id === id)?.panel?.datasetIds).toEqual(["a"]);
  });

  it("removing the last id empties the panel without closing the window", () => {
    const id = useApp.getState().createPanelWindow(["a"], "grid");
    useApp.getState().removeFromPanel(id, "a");
    const win = useApp.getState().plotWindows.find((w) => w.id === id);
    expect(win).toBeDefined();
    expect(win?.panel?.datasetIds).toEqual([]);
  });

  it("an unknown window id or dataset id is a no-op, never throws", () => {
    const id = useApp.getState().createPanelWindow(["a", "b"], "grid");
    expect(() => useApp.getState().removeFromPanel("nope", "a")).not.toThrow();
    useApp.getState().removeFromPanel(id, "gone");
    expect(useApp.getState().plotWindows.find((w) => w.id === id)?.panel?.datasetIds).toEqual(["a", "b"]);
  });
});
