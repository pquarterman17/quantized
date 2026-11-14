import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { useToasts } from "../store/toasts";
import { plotSelectedTogether } from "./plotSelectedTogether";
import { LINKED_GRAPH_EDIT_NOTICE } from "./rederived";
import type { Dataset } from "./types";

const plain = (id: string, name: string, time: number[], y: number[]): Dataset => ({
  id,
  name,
  data: {
    time,
    values: time.map((_, i) => [y[i]]),
    labels: ["Y"],
    units: ["V"],
    metadata: {},
  },
});

const a = plain("a", "Sample A", [1, 2, 3], [10, 20, 30]);
const b = plain("b", "Sample B", [5, 6], [50, 60]);
const c = plain("c", "Sample C", [7, 8, 9], [70, 80, 90]);
const rsm: Dataset = {
  id: "m",
  name: "RSM scan",
  data: {
    time: [0, 1],
    values: [
      [0, 0, 1],
      [1, 1, 2],
    ],
    labels: ["Qx", "Qz", "Intensity"],
    units: ["", "", ""],
    metadata: { is2D: true },
  },
};

function toastMsgs(): string[] {
  return useToasts.getState().toasts.map((t) => t.msg);
}

beforeEach(() => {
  useApp.setState({ datasets: [a, b, c, rsm], selectedIds: [] });
  useToasts.setState({ toasts: [] });
});

describe("plotSelectedTogether (PLOT_WORKFLOW_PLAN #3)", () => {
  it("requires >=2 selected datasets — toasts why and adds nothing otherwise", async () => {
    const before = useApp.getState().datasets.length;
    await plotSelectedTogether(["a"]);
    expect(useApp.getState().datasets).toHaveLength(before);
    expect(toastMsgs().some((m) => m.includes("select at least 2 datasets"))).toBe(true);
  });

  it("makes one new LIVE graph of a mixed-length selection, named Graph1, and makes it active", async () => {
    await plotSelectedTogether(["a", "b"]);
    const s = useApp.getState();
    const created = s.datasets.find((d) => d.id !== "a" && d.id !== "b" && d.id !== "c" && d.id !== "m");
    expect(created).toBeDefined();
    expect(created!.name).toBe("Graph1"); // Origin-style, not "overlay (2)"
    expect(created!.linkedCurves).toEqual([
      { datasetId: "a", xKey: null, yKey: 0 },
      { datasetId: "b", xKey: null, yKey: 0 },
    ]);
    // The Y title names the quantity; the legend names the source.
    expect(created!.data.labels).toEqual(["Y", "Y"]);
    expect(created!.data.metadata.linked_curve_legends).toEqual(["Sample A", "Sample B"]);
    expect(created!.data.time).toEqual([1, 2, 3, 5, 6]);
    // lands as the active plot the same way applyOriginFigure's overlay does.
    expect(s.activeId).toBe(created!.id);
    expect(toastMsgs().some((m) => m.includes("plotted 2 datasets together"))).toBe(true);
  });

  it("titles the overlay's x axis from the selection, not the Origin column letter", async () => {
    const meta = { x_column_name: "2-Theta", x_column_unit: "deg" };
    const xrd = (id: string): Dataset => ({ ...plain(id, id, [1, 2], [3, 4]), data: { ...a.data, metadata: meta } });
    useApp.setState({ datasets: [xrd("p"), xrd("q")] });
    await plotSelectedTogether(["p", "q"]);
    const created = useApp.getState().datasets.find((d) => d.id !== "p" && d.id !== "q")!.data.metadata;
    expect([created.x_column_long, created.x_column_unit]).toEqual(["2-Theta", "deg"]);
  });

  it("skips a 2-D map in the selection, names it in the toast, and still overlays the rest", async () => {
    await plotSelectedTogether(["a", "b", "m"]);
    const s = useApp.getState();
    const created = s.datasets.find((d) => d.id !== "a" && d.id !== "b" && d.id !== "c" && d.id !== "m");
    expect(created).toBeDefined();
    expect(created!.data.metadata.linked_curve_legends).toEqual(["Sample A", "Sample B"]); // the map contributed no curve
    const msg = toastMsgs().find((m) => m.includes("plotted 2 datasets together"));
    expect(msg).toBeDefined();
    expect(msg).toContain("skipped 1 map dataset (RSM scan): maps don't overlay");
  });

  it("refuses when fewer than 2 plottable datasets remain after skipping maps", async () => {
    const before = useApp.getState().datasets.length;
    await plotSelectedTogether(["a", "m"]);
    expect(useApp.getState().datasets).toHaveLength(before); // nothing added
    const msg = toastMsgs().find((m) => m.includes("need at least 2 plottable datasets"));
    expect(msg).toBeDefined();
    expect(msg).toContain("skipped 1 map dataset (RSM scan): maps don't overlay");
  });

  it("toasts a failed full-data load instead of rejecting silently", async () => {
    // Silent-failure audit (2026-10-01): every entry point fires this as
    // `void plotSelectedTogether(...)`, so a rejected resolve (a pending
    // book whose fetch failed) did nothing visible.
    const original = useApp.getState().resolveDatasets;
    useApp.setState({ resolveDatasets: () => Promise.reject(new Error("book fetch failed")) });
    try {
      await expect(plotSelectedTogether(["a", "b"])).resolves.toBeUndefined();
    } finally {
      useApp.setState({ resolveDatasets: original });
    }
    const t = useToasts.getState().toasts.find((x) => x.msg.includes("book fetch failed"));
    expect(t?.kind).toBe("danger");
  });

  it("the graph is LIVE: editing a source cell updates it; a second graph is Graph2", async () => {
    await plotSelectedTogether(["a", "b"]);
    const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;
    useApp.getState().setCellValue("a", 0, 0, 99);
    await new Promise((r) => setTimeout(r, 0));
    expect(graph().data.values[0][0]).toBe(99);
    await plotSelectedTogether(["b", "c"]);
    expect(useApp.getState().datasets.filter((d) => d.linkedCurves).map((d) => d.name)).toEqual(["Graph1", "Graph2"]);
  });

  it("typing into the graph's sheet is refused with the graph notice", async () => {
    await plotSelectedTogether(["a", "b"]);
    const g = useApp.getState().datasets.find((d) => d.linkedCurves)!;
    const before = g.data;
    useApp.getState().setCellValue(g.id, 0, 0, 5);
    expect(useApp.getState().datasets.find((d) => d.id === g.id)!.data).toBe(before);
    expect(useApp.getState().status).toBe(LINKED_GRAPH_EDIT_NOTICE);
  });
});
