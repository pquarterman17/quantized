// "Create subset from region" asks which plotted series go in and where the subset lands (ROW_RANGE_CONTRACT
// section 4), driven through the real plot menu, the real dialog store and the real commit.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import PlotContextMenu from "./PlotContextMenu";
import type { PlotPayload } from "../../lib/plotdata";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useParamDialog } from "../../store/paramDialog";
import { useApp } from "../../store/useApp";
import type { PlotStageActions } from "./usePlotStageActions";

const plot = {
  over: { getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400 }), clientHeight: 300 },
  data: [[0, 100, 200, 300, 400], [10, 20, 150, 40, 50]],
  series: [{}, { scale: "y" }],
  scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
  select: { left: 1, top: 15, width: 2, height: 100 },
  posToVal: (px: number) => px,
  valToPos: (v: number) => v,
} as unknown as uPlot;
const actions = { resetView: vi.fn(), smartScale: vi.fn(), savePng: vi.fn(), copyData: vi.fn(), copyFigure: vi.fn(), snapshot: vi.fn() } as PlotStageActions;
// X = 0..4; A, B (= 5 x A, but blank at row 3) and C.
const ds = (meta: Record<string, unknown> = {}): Dataset => ({
  id: "d", name: "d.csv", workbookId: "wb1",
  data: { time: [0, 1, 2, 3, 4], values: [[10, 50, 7], [20, 100, 8], [150, 750, 9], [40, Number.NaN, 10], [50, 250, 11]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: meta },
});
const win: PlotWindow = {
  id: "w1", kind: "plot", title: "w1", datasetId: "d", geometry: { x: 0, y: 0, w: 300, h: 200 }, z: 0,
  winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
};

function setup(meta: Record<string, unknown> = {}) {
  useApp.setState({
    datasets: [ds(meta)], activeId: "d", selectedIds: [], selection: { datasetId: "d", rows: [1, 3] }, plotWindows: [win], focusedWindowId: "w1",
    plotTool: "select", xKey: null, yKeys: [0, 1], y2Keys: null, hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {},
    workbooks: [{ id: "wb1", name: "Run 1" }, { id: "wb2", name: "Archive" }], history: [], future: [], status: "",
  });
  const payload = { data: plot.data, series: [{ label: "A", unit: "" }, { label: "B", unit: "" }] } as unknown as PlotPayload;
  render(<PlotContextMenu x={300} y={380} plotRef={{ current: plot }} payload={payload} plotted={[0, 1]} hidden={[false, false]} actions={actions} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText("Create subset from region (2 points)"));
}

/** The dialog the menu opened, and a way to answer it as the user would (overrides over every field's default). */
async function dialog() {
  await waitFor(() => expect(useParamDialog.getState().resolve).not.toBeNull());
  const { fields, resolve, close } = useParamDialog.getState();
  return {
    fields,
    answer: (over: Record<string, boolean | string> = {}) => { resolve?.({ ...Object.fromEntries(fields.map((f) => [f.key, f.default])), ...over }); close(); },
    cancel: () => { resolve?.(null); close(); },
  };
}
const sub = () => useApp.getState().datasets.find((d) => d.id !== "d");

beforeEach(() => useParamDialog.getState().close());

describe("the source-series checklist", () => {
  it("lists each plotted series with its rows in the region, every one ticked", async () => {
    setup();
    const { fields, cancel } = await dialog();
    expect(fields.filter((f) => f.type === "boolean").map((f) => [f.label, f.default])).toEqual([["A (2 rows)", true], ["B (1 row)", true]]); // B is blank at row 3
    cancel();
    expect(sub()).toBeUndefined(); // cancelling makes nothing
  });

  it("ticking a subset puts only those series (and every unplotted column) in the subset, rows unchanged", async () => {
    setup();
    (await dialog()).answer({ s1: false });
    await waitFor(() => expect(sub()).toBeDefined());
    expect(sub()!.data.labels).toEqual(["A", "C"]);
    expect(sub()!.data.time).toEqual([1, 3]);
    expect(sub()!.data.values).toEqual([[20, 8], [40, 10]]);
    expect(useApp.getState().activeId).toBe("d");
  });

  it("ticking nothing makes no subset and says why", async () => {
    setup();
    (await dialog()).answer({ s0: false, s1: false });
    await waitFor(() => expect(useApp.getState().status).toMatch(/tick at least one series/));
    expect(sub()).toBeUndefined();
  });

  it("a sheet with per-column metadata it cannot renumber refuses to drop a series", async () => {
    setup({ error_roles: [{ channel: 1, target: 0 }] });
    (await dialog()).answer({ s1: false });
    await waitFor(() => expect(useApp.getState().status).toMatch(/per-column metadata \(error_roles\)/));
    expect(sub()).toBeUndefined();
  });

  it("a malformed per-column list fails closed rather than being guessed at", async () => {
    setup({ label_rows: { cells: {} } });
    (await dialog()).answer({ s1: false });
    await waitFor(() => expect(useApp.getState().status).toMatch(/does not line up/));
    expect(sub()).toBeUndefined();
  });
});

describe("the destination workbook", () => {
  it("defaults to the source workbook", async () => {
    setup();
    const { fields, answer } = await dialog();
    const where = fields.find((f) => f.key === "where")!;
    expect(where.default).toBe("source");
    expect(where.optionLabels?.source).toBe("Beside the source (workbook “Run 1”)");
    expect(where.options).toEqual(["source", "new", "wb:wb2"]); // the source's own workbook is not listed twice
    answer();
    await waitFor(() => expect(sub()).toBeDefined());
    expect(sub()!.workbookId).toBe("wb1");
  });

  it("another existing workbook", async () => {
    setup();
    (await dialog()).answer({ where: "wb:wb2" });
    await waitFor(() => expect(sub()).toBeDefined());
    expect(sub()!.workbookId).toBe("wb2");
    expect(useApp.getState().workbooks).toHaveLength(2);
  });

  it("a new workbook, made in the same undo step as the subset", async () => {
    setup();
    (await dialog()).answer({ where: "new" });
    await waitFor(() => expect(sub()).toBeDefined());
    const made = useApp.getState().workbooks.find((w) => w.id === sub()!.workbookId)!;
    expect(made.name).toBe("d (subset)");
    expect(useApp.getState().workbooks).toHaveLength(3);
    useApp.getState().undo();
    expect(sub()).toBeUndefined();
    expect(useApp.getState().workbooks.map((w) => w.id)).toEqual(["wb1", "wb2"]);
  });
});
