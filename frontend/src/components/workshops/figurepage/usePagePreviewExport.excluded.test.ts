// F4.2c (a) in the Figure Page composer: the preview draws excluded rows the
// way the app does, and Export / Copy ask "greyed or omitted?" whenever a
// panel has any. Waits are on STATE (dialog title, preview URL, the busy
// flag), answered through the real parameter-dialog store.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigurePage, renderFigurePageBlob } from "../../../lib/api";
import { EXCLUDED_GREY_OPTION, EXCLUDED_OMIT_OPTION } from "../../../lib/excludedRowsChoice";
import { createFigureDocument } from "../../../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { DataStruct } from "../../../lib/types";
import { useParamDialog } from "../../../store/paramDialog";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import { useFigurePage } from "./useFigurePage";

vi.mock("../../../lib/api", () => ({
  exportFigurePage: vi.fn().mockResolvedValue(undefined),
  renderFigurePageBlob: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/clipboard", () => ({
  clipboardImageSupported: vi.fn(() => true),
  copyOfficeGraphicAsync: vi.fn(async (source: { png: Promise<Blob>; svg: Promise<Blob> }) => {
    await Promise.all([source.png, source.svg]);
    return true;
  }),
}));

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 9],
    [2, 8],
    [3, 7],
  ],
  labels: ["A", "B"],
  units: ["u", "v"],
  metadata: {},
};

function plotWindow(): PlotWindow {
  const view = { ...defaultPlotView(), yKeys: [1] };
  return {
    id: "w1",
    kind: "plot",
    title: "Loop",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0,
    winState: "normal",
    view,
    bg: "theme",
    linkGroup: null,
    pinned: false,
    document: createFigureDocument({ id: "figure-w1", name: "Loop", datasetId: "d1", view }),
  };
}

async function answer(values: Record<string, string> | null) {
  await vi.waitFor(() => expect(useParamDialog.getState().title).toBe("Excluded rows"));
  const { resolve, close } = useParamDialog.getState();
  close();
  resolve!(values);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useParamDialog.getState().close();
  useApp.getState().setPref("excludedDisplay", "grey");
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: DATA, excludedRows: [1] }],
    activeId: "d1",
    focusedWindowId: null,
    plotWindows: [plotWindow()],
    figureDocs: [],
    status: "",
  });
});

describe("Figure Page composer excluded rows (F4.2c (a))", () => {
  it("the preview follows the app-wide mode and re-renders when it flips", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    await waitFor(() => expect(result.current.preview).toMatch(/^data:/), { timeout: 2000 });
    const last = () => vi.mocked(renderFigurePageBlob).mock.calls.at(-1)![0].panels[0].figure.y_keys;
    expect(last()).toEqual([1, 2]);
    act(() => useApp.getState().setPref("excludedDisplay", "hide"));
    expect(result.current.busy).toBe(true); // the flip scheduled a re-render
    await waitFor(() => expect(result.current.busy).toBe(false), { timeout: 2000 });
    expect(last()).toEqual([1]);
  });

  it("Export asks, and the answer controls the exported page", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    let run!: Promise<void>;
    act(() => {
      run = result.current.exportNow();
    });
    await answer({ mode: EXCLUDED_OMIT_OPTION });
    await act(async () => {
      await run;
    });
    expect(vi.mocked(exportFigurePage).mock.calls[0][0].panels[0].figure.y_keys).toEqual([1]);
  });

  it("dismissing the question cancels the export", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    let run!: Promise<void>;
    act(() => {
      run = result.current.exportNow();
    });
    await answer(null);
    await act(async () => {
      await run;
    });
    expect(exportFigurePage).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("export cancelled");
  });

  it("Copy asks too, and greys when chosen", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    let run!: Promise<void>;
    act(() => {
      run = result.current.copyNow();
    });
    await answer({ mode: EXCLUDED_GREY_OPTION });
    await act(async () => {
      await run;
    });
    const copied = vi.mocked(renderFigurePageBlob).mock.calls.map((c) => c[0]).find((b) => b.dpi === 300);
    expect(copied?.panels[0].figure.y_keys).toEqual([1, 2]);
  });
});
