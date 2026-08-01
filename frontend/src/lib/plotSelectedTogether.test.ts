import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { useToasts } from "../store/toasts";
import { plotSelectedTogether } from "./plotSelectedTogether";
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

  it("merges a mixed-length selection into one new overlay dataset and makes it active", async () => {
    await plotSelectedTogether(["a", "b"]);
    const s = useApp.getState();
    const created = s.datasets.find((d) => d.id !== "a" && d.id !== "b" && d.id !== "c" && d.id !== "m");
    expect(created).toBeDefined();
    expect(created!.data.labels).toEqual(["Sample A", "Sample B"]);
    expect(created!.data.time).toEqual([1, 2, 3, 5, 6]);
    // lands as the active plot the same way applyOriginFigure's overlay does.
    expect(s.activeId).toBe(created!.id);
    expect(toastMsgs().some((m) => m.includes("plotted 2 datasets together"))).toBe(true);
  });

  it("skips a 2-D map in the selection, names it in the toast, and still overlays the rest", async () => {
    await plotSelectedTogether(["a", "b", "m"]);
    const s = useApp.getState();
    const created = s.datasets.find((d) => d.id !== "a" && d.id !== "b" && d.id !== "c" && d.id !== "m");
    expect(created).toBeDefined();
    expect(created!.data.labels).toEqual(["Sample A", "Sample B"]); // the map contributed no curve
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
});
