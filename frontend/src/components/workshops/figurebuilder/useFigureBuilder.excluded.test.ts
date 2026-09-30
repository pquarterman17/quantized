// F4.2c (a) for the Publication Preview's LEGACY (live-plot) mode. It used to
// send the active dataset's raw rows, so an excluded or filter-dropped row was
// drawn as ordinary data in both the preview and the export, while the canvas
// hid or greyed it. Now the preview follows the app-wide "Excluded rows" mode
// and the export asks "greyed or omitted?", only when rows are masked. Every
// wait is on STATE (the dialog, the hook's preview), never on a mock call.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, renderFigureHitmap, type FigureSpec } from "../../../lib/api/figures";
import { EXCLUDED_GREY_OPTION, EXCLUDED_OMIT_OPTION } from "../../../lib/excludedRowsChoice";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useParamDialog } from "../../../store/paramDialog";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import { buildLegacyFigureSpec, type LegacyFigureState } from "./legacyFigure";
import { useFigureBuilder } from "./useFigureBuilder";

vi.mock("../../../lib/api/figures", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
  renderFigureHitmap: vi.fn().mockResolvedValue({
    image: "cGln",
    width: 600,
    height: 400,
    elements: [],
    axes: { x0: 0, y0: 0, x1: 600, y1: 400, xlim: [0, 1], ylim: [0, 1], xlog: false, ylog: false },
  }),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[1], [2], [3], [4]],
  labels: ["M"],
  units: ["emu"],
  metadata: {},
};

function seed(excludedRows?: number[]) {
  const ds: Dataset = { id: "d1", name: "scan.dat", data: DATA, ...(excludedRows ? { excludedRows } : {}) };
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    xKey: null,
    yKeys: [0],
    y2Keys: null,
    seriesStyles: {},
    figureDocSeed: null,
    figurePublicationSession: null,
    status: "",
  });
}

const lastPreview = (): FigureSpec | undefined => vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0];
const lastExport = (): FigureSpec | undefined => vi.mocked(exportFigure).mock.calls.at(-1)?.[0];

async function answerExcluded(mode: string | null) {
  await waitFor(() => expect(useParamDialog.getState().title).toBe("Excluded rows"));
  const { resolve, close } = useParamDialog.getState();
  close();
  resolve!(mode === null ? null : { mode });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useParamDialog.getState().close();
  useApp.getState().setPref("excludedDisplay", "grey");
});

describe("legacy Publication Preview honours excluded rows", () => {
  it("the preview follows the app mode: greyed companions, or the rows left out", async () => {
    seed([1]);
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(lastPreview()?.dataset.labels).toEqual(["M", "M (excluded)"]);
    expect(lastPreview()?.dataset.time).toEqual([0, 2, 3, 1]);

    act(() => useApp.getState().setPref("excludedDisplay", "hide"));
    await waitFor(() => expect(lastPreview()?.dataset.time).toEqual([0, 2, 3]));
    expect(lastPreview()?.y_keys).toEqual([0]);
  });

  it("exports without asking when no row is masked", async () => {
    seed();
    const { result } = renderHook(() => useFigureBuilder());
    await act(async () => result.current.exportNow());
    expect(useParamDialog.getState().title).toBeNull();
    expect(lastExport()?.dataset.time).toEqual([0, 1, 2, 3]);
  });

  it.each([
    [EXCLUDED_GREY_OPTION, [0, 2, 3, 1], [0, 1]],
    [EXCLUDED_OMIT_OPTION, [0, 2, 3], [0]],
  ])("asks on export; %s draws exactly that", async (mode, time, yKeys) => {
    seed([1]);
    const { result } = renderHook(() => useFigureBuilder());
    let run!: Promise<void>;
    act(() => {
      run = result.current.exportNow();
    });
    await answerExcluded(mode);
    await act(async () => run);
    expect(lastExport()?.dataset.time).toEqual(time);
    expect(lastExport()?.y_keys).toEqual(yKeys);
  });

  it("dismissing the question exports nothing", async () => {
    seed([1]);
    const { result } = renderHook(() => useFigureBuilder());
    let run!: Promise<void>;
    act(() => {
      run = result.current.exportNow();
    });
    await answerExcluded(null);
    await act(async () => run);
    expect(exportFigure).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("export cancelled");
  });
});

describe("the legacy wire dataset stays one object across unrelated edits", () => {
  // The preview's dataset-handle cache is keyed on the dataset OBJECT, so a
  // fresh pruned/greyed copy per keystroke would re-upload every row.
  it("reuses it for a title edit, rebuilds it for a channel or mode change", () => {
    seed([1]);
    const live = useApp.getState().datasets[0];
    const state: LegacyFigureState = {
      data: DATA, liveDataset: live, xKey: null, yKeys: [0], xScale: "linear", yScale: "linear",
      xFmt: { mode: "auto", digits: 2 }, yFmt: { mode: "auto", digits: 2 }, style: "default", overrides: {},
      title: "", xLabel: "", yLabel: "", seriesStyles: {}, docSeriesStyles: undefined, docGroupCol: null, y2: null,
    };
    const first = buildLegacyFigureSpec(state)!;
    expect(buildLegacyFigureSpec({ ...state, title: "Loop" })!.dataset).toBe(first.dataset);
    expect(buildLegacyFigureSpec({ ...state, yKeys: null })!.dataset).not.toBe(first.dataset);
    const grey = buildLegacyFigureSpec(state, (spec) => ({ ...spec, dataset: { ...spec.dataset } }))!;
    expect(grey.dataset).not.toBe(first.dataset);
  });
});
