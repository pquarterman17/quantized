// F4.2c (a): "explicit choice on export if masked data". Driven through the
// real commands and the real parameter-dialog store; every wait is on dialog
// STATE (which question is open), never on a mock having been called.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, renderFigureBlob } from "./api/figures";
import { copyOfficeGraphicAsync, copySvgAsync } from "./clipboard";
import { runCopyFigureCommand, runCopyFigureSvgCommand } from "./copyFigureCommand";
import {
  askExcludedRows,
  EXCLUDED_GREY_OPTION,
  EXCLUDED_OMIT_OPTION,
} from "./excludedRowsChoice";
import { runExportFigureCommand } from "./exportFigureCommand";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { DataStruct, Dataset } from "./types";
import { useParamDialog } from "../store/paramDialog";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";
import { exportPreviewFigure } from "../components/workshops/figurebuilder/previewExport";

vi.mock("./api/figures", () => ({ exportFigure: vi.fn(), renderFigureBlob: vi.fn() }));
vi.mock("./clipboard", () => ({
  clipboardImageSupported: vi.fn(() => true),
  clipboardSvgSupported: vi.fn(() => true),
  copyOfficeGraphicAsync: vi.fn(async () => true),
  copySvgAsync: vi.fn(async () => true),
}));

const DATA: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 5],
    [20, 6],
    [30, 7],
  ],
  labels: ["M", "N"],
  units: ["emu", "emu"],
  metadata: {},
};

function seed(excludedRows?: number[]) {
  const ds: Dataset = { id: "d1", name: "scan.dat", data: DATA, ...(excludedRows ? { excludedRows } : {}) };
  useApp.setState({ datasets: [ds], activeId: "d1", yKeys: [0, 1], xKey: null, hiddenChannels: [] });
}

/** Wait until the dialog titled `title` is open, then answer it. */
async function answer(title: string, values: Record<string, string | number | boolean> | null) {
  await vi.waitFor(() => expect(useParamDialog.getState().title).toBe(title));
  const { resolve, fields, close } = useParamDialog.getState();
  close();
  resolve!(values === null ? null : { ...Object.fromEntries(fields.map((f) => [f.key, f.default])), ...values });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useParamDialog.getState().close();
  vi.mocked(renderFigureBlob).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  useApp.getState().setPref("excludedDisplay", "grey");
});

afterEach(() => {
  useApp.getState().setPref("excludedDisplay", "grey");
  useApp.setState({ datasets: [], activeId: null });
});

describe("askExcludedRows", () => {
  it("offers both choices, pre-selected to the app-wide mode", async () => {
    for (const [mode, pre] of [["grey", EXCLUDED_GREY_OPTION], ["hide", EXCLUDED_OMIT_OPTION]] as const) {
      const p = askExcludedRows(mode);
      await vi.waitFor(() => expect(useParamDialog.getState().title).toBe("Excluded rows"));
      const field = useParamDialog.getState().fields[0];
      expect(field.options).toEqual([EXCLUDED_GREY_OPTION, EXCLUDED_OMIT_OPTION]);
      expect(field.default).toBe(pre);
      await answer("Excluded rows", {});
      expect(await p).toBe(mode === "grey" ? "grey" : "omit");
    }
  });

  it("states the question in visible text and confirms with Export, not Run", async () => {
    const p = askExcludedRows("grey");
    await vi.waitFor(() => expect(useParamDialog.getState().title).toBe("Excluded rows"));
    expect(useParamDialog.getState().message).toMatch(/excluded rows/);
    expect(useParamDialog.getState().confirmLabel).toBe("Export");
    await answer("Excluded rows", null);
    expect(await p).toBeNull();
  });
});

describe("Copy figure asks about excluded rows (F4.2c (a))", () => {
  it("never asks when the figure has no excluded rows", async () => {
    seed();
    await runCopyFigureCommand(useApp.getState);
    expect(useParamDialog.getState().title).toBeNull();
    expect(vi.mocked(renderFigureBlob).mock.calls[0][0].y_keys).toEqual([0, 1]);
  });

  it("greys them when the user keeps the pre-selected greyed choice", async () => {
    seed([1]);
    const run = runCopyFigureCommand(useApp.getState);
    await answer("Excluded rows", { mode: EXCLUDED_GREY_OPTION });
    await run;
    const spec = vi.mocked(renderFigureBlob).mock.calls[0][0];
    expect(spec.y_keys).toEqual([0, 1, 2, 3]);
    expect(spec.dataset.labels.slice(2)).toEqual(["M (excluded)", "N (excluded)"]);
  });

  it("omits them when the user picks omit, even with the app greying", async () => {
    seed([1]);
    const run = runCopyFigureCommand(useApp.getState);
    await answer("Excluded rows", { mode: EXCLUDED_OMIT_OPTION });
    await run;
    const spec = vi.mocked(renderFigureBlob).mock.calls[0][0];
    expect(spec.y_keys).toEqual([0, 1]);
    expect(spec.dataset.time).toEqual([1, 3]);
  });

  it("dismissing the question cancels the copy — nothing is rendered", async () => {
    seed([1]);
    const run = runCopyFigureCommand(useApp.getState);
    await answer("Excluded rows", null);
    await run;
    expect(renderFigureBlob).not.toHaveBeenCalled();
    expect(copyOfficeGraphicAsync).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("copy cancelled");
  });
});

describe("Export figure asks about excluded rows (F4.2c (a))", () => {
  it("asks after the export dialog, pre-selected to the app's hide mode", async () => {
    seed([1]);
    useApp.getState().setPref("excludedDisplay", "hide");
    const run = runExportFigureCommand(useApp.getState);
    await answer("Export figure", {});
    await vi.waitFor(() => expect(useParamDialog.getState().title).toBe("Excluded rows"));
    expect(useParamDialog.getState().fields[0].default).toBe(EXCLUDED_OMIT_OPTION);
    await answer("Excluded rows", {});
    await run;
    expect(vi.mocked(exportFigure).mock.calls[0][0].y_keys).toEqual([0, 1]);
  });

  it("greys when chosen, and never asks for a figure without excluded rows", async () => {
    seed([2]);
    let run = runExportFigureCommand(useApp.getState);
    await answer("Export figure", {});
    await answer("Excluded rows", { mode: EXCLUDED_GREY_OPTION });
    await run;
    expect(vi.mocked(exportFigure).mock.calls[0][0].y_keys).toEqual([0, 1, 2, 3]);

    seed();
    run = runExportFigureCommand(useApp.getState);
    await answer("Export figure", {});
    await run;
    expect(useParamDialog.getState().title).toBeNull();
    expect(vi.mocked(exportFigure).mock.calls[1][0].y_keys).toEqual([0, 1]);
  });
});

describe("Figure Builder's canonical Export asks about excluded rows (F4.2c (a))", () => {
  it("exports the chosen treatment of a live document's excluded rows", async () => {
    seed([0]);
    const ds = useApp.getState().datasets[0];
    const doc = createFigureDocument({ id: "f1", name: "Loop", datasetId: "d1", view: { ...defaultPlotView(), yKeys: [1] } });
    const setStatus = vi.fn();
    const run = exportPreviewFigure({
      canonicalDocument: doc,
      canonicalReadiness: { state: "ready", data: DATA, spec: { dataset: DATA } },
      canonicalDataset: ds,
      spec: null,
      frozenData: null,
      active: ds,
      fmt: "pdf",
      dpi: 300,
      autoSeriesStyles: false,
      setStatus,
    });
    await answer("Excluded rows", { mode: EXCLUDED_GREY_OPTION });
    await run;
    expect(vi.mocked(exportFigure).mock.calls[0][0].y_keys).toEqual([1, 2]);
    expect(setStatus).toHaveBeenLastCalledWith("exported scan.pdf");
  });
});

describe("Copy figure routes the choice through every Stage builder (F4.2c (a))", () => {
  it("Copy figure (vector) asks too, and the answer reaches the SVG render", async () => {
    seed([1]);
    const run = runCopyFigureSvgCommand(useApp.getState);
    await answer("Excluded rows", { mode: EXCLUDED_GREY_OPTION });
    await run;
    const spec = vi.mocked(renderFigureBlob).mock.calls[0][0];
    expect(spec.fmt).toBe("svg");
    expect(spec.y_keys).toEqual([0, 1, 2, 3]);
    expect(copySvgAsync).toHaveBeenCalledTimes(1);
  });

  it("greys through the focused window's canonical document, not only the live-view fallback", async () => {
    seed([1]);
    const view = { ...defaultPlotView(), yKeys: [1] };
    const document = createFigureDocument({ id: "figure-w1", name: "Loop", datasetId: "d1", view });
    useApp.setState({
      yKeys: [1],
      focusedWindowId: "w1",
      plotWindows: [
        {
          id: "w1", kind: "plot", title: "Loop", datasetId: "d1", geometry: { x: 0, y: 0, w: 400, h: 300 },
          z: 0, winState: "normal", view, bg: "theme", linkGroup: null, pinned: false, document,
        },
      ],
    });
    const run = runCopyFigureCommand(useApp.getState);
    await answer("Excluded rows", { mode: EXCLUDED_GREY_OPTION });
    await run;
    expect(vi.mocked(renderFigureBlob).mock.calls[0][0].y_keys).toEqual([1, 2]);
    useApp.setState({ focusedWindowId: null, plotWindows: [] });
  });
});
