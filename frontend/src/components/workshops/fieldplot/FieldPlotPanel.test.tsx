// Vector field workshop: X/Y/U/V picks -> gridded server preview -> the same
// request exported as quiver or streamline.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import { exportFieldFigure } from "../../../lib/api/figures";
import { postBlob } from "../../../lib/api/http";
import type { Dataset } from "../../../lib/types";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { PREVIEW_DPI } from "../ternary/auxFigurePreview";
import { useAuxFigureStore } from "../ternary/auxFigureStore";
import FieldPlotPanel from "./FieldPlotPanel";

vi.mock("../../../lib/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/http")>()),
  postBlob: vi.fn(),
}));
vi.mock("../../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/figures")>()),
  exportFieldFigure: vi.fn(),
}));
vi.mock("../../../lib/excludedRowsChoice", () => ({ askExcludedRows: vi.fn() }));

const postBlobMock = vi.mocked(postBlob);
const exportMock = vi.mocked(exportFieldFigure);

const ds: Dataset = {
  id: "d1",
  name: "flow.dat",
  data: {
    time: [1, 2, 3, 4],
    values: [
      [0, 0, 1, 0],
      [1, 0, 0, 1],
      [0, 2, -1, 0],
      [1, 2, 0, -1],
    ],
    labels: ["x", "y", "u", "v"],
    units: ["mm", "mm", "", ""],
    metadata: { x_column_name: "row" },
  },
};

const previewBodies = () => postBlobMock.mock.calls.map((c) => c[1] as Record<string, unknown>);
const lastToast = () => useToasts.getState().toasts.at(-1)?.msg;

beforeEach(() => {
  vi.clearAllMocks();
  postBlobMock.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  exportMock.mockResolvedValue(undefined);
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [ds], activeId: "d1", status: "", toolWindowLayout: {}, excludedDisplay: "grey" });
  useAuxFigureStore.setState({ ternaryOpen: false, fieldOpen: true });
});

describe("FieldPlotPanel", () => {
  it("opens from the Plot ▸ Build & export command", () => {
    useAuxFigureStore.setState({ fieldOpen: false });
    const cmd = buildAnalysisCommands(useApp.getState).find((c) => c.id === "field-figure");
    expect(cmd?.group).toBe("Plot");
    expect(cmd?.section).toBe("Build & export");
    cmd?.run();
    expect(useAuxFigureStore.getState().fieldOpen).toBe(true);
  });

  it("previews the gridded quiver from the first four columns and exports the same request", async () => {
    render(<FieldPlotPanel />);
    await screen.findByAltText("Vector field preview");
    expect(previewBodies().at(-1)).toEqual({
      x_axis: [0, 1],
      y_axis: [0, 2],
      u_grid: [
        [1, 0],
        [-1, 0],
      ],
      v_grid: [
        [0, 1],
        [0, -1],
      ],
      kind: "quiver",
      title: "flow.dat",
      x_label: "x (mm)",
      y_label: "y (mm)",
      filename: "flow-field",
      fmt: "png",
      dpi: PREVIEW_DPI,
    });

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(lastToast()).toBe("exported flow"));
    const [body, signal] = exportMock.mock.calls[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(body.fmt).toBe("pdf");
    expect({ ...body, fmt: "png", dpi: PREVIEW_DPI }).toEqual(previewBodies().at(-1));
  });

  it("switches to streamlines and exports that mode", async () => {
    render(<FieldPlotPanel />);
    await screen.findByAltText("Vector field preview");
    fireEvent.click(screen.getByRole("radio", { name: "Streamline" }));
    await waitFor(() => expect(previewBodies().at(-1)?.kind).toBe("streamline"));

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(lastToast()).toBe("exported flow"));
    expect(exportMock.mock.calls[0][0].kind).toBe("streamline");
  });

  it("says why an incomplete grid cannot be drawn instead of requesting a render", async () => {
    useApp.setState({ datasets: [{ ...ds, excludedRows: [3] }] });
    render(<FieldPlotPanel />);
    expect(await screen.findByText("Rows cover 3 of the 4 X×Y grid points, so no field can be drawn.")).toBeInTheDocument();
    expect(postBlobMock).not.toHaveBeenCalled();
    expect(screen.queryByAltText("Vector field preview")).not.toBeInTheDocument();
  });

  it("asks for a dataset when none is active", () => {
    useApp.setState({ datasets: [], activeId: null });
    render(<FieldPlotPanel />);
    expect(screen.getByText("Select a dataset with X, Y, U and V columns.")).toBeInTheDocument();
  });
});
