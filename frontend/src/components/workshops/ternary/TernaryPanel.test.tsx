// Ternary diagram workshop: picks -> live server preview -> the same request
// exported; excluded rows are omitted (never greyed) and said so.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import { exportTernaryFigure } from "../../../lib/api/figures";
import { postBlob } from "../../../lib/api/http";
import { askExcludedRows } from "../../../lib/excludedRowsChoice";
import type { Dataset } from "../../../lib/types";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useAuxFigureStore } from "./auxFigureStore";
import { PREVIEW_DPI } from "./auxFigurePreview";
import { AUX_OMIT_REASON } from "./auxFigureExport";
import TernaryPanel from "./TernaryPanel";

vi.mock("../../../lib/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/http")>()),
  postBlob: vi.fn(),
}));
vi.mock("../../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/figures")>()),
  exportTernaryFigure: vi.fn(),
}));
vi.mock("../../../lib/excludedRowsChoice", () => ({ askExcludedRows: vi.fn() }));

const postBlobMock = vi.mocked(postBlob);
const exportMock = vi.mocked(exportTernaryFigure);
const askMock = vi.mocked(askExcludedRows);

const ds: Dataset = {
  id: "d1",
  name: "alloys.csv",
  data: {
    time: [1, 2, 3, 4],
    values: [
      [0.2, 0.3, 0.5, 300],
      [0.5, 0.25, 0.25, 310],
      [-1, 0.5, 0.5, 320],
      [0.1, 0.1, 0.8, 330],
    ],
    labels: ["Fe", "Co", "Ni", "Tc"],
    units: ["", "", "", "K"],
    metadata: { x_column_name: "sample" },
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
  useAuxFigureStore.setState({ ternaryOpen: true, fieldOpen: false });
});

describe("TernaryPanel", () => {
  it("opens from the Plot ▸ Build & export command", () => {
    useAuxFigureStore.setState({ ternaryOpen: false });
    const cmd = buildAnalysisCommands(useApp.getState).find((c) => c.id === "ternary-figure");
    expect(cmd?.group).toBe("Plot");
    expect(cmd?.section).toBe("Build & export");
    cmd?.run();
    expect(useAuxFigureStore.getState().ternaryOpen).toBe(true);
  });

  it("previews the first three columns, says which rows were left out, and exports the same request", async () => {
    render(<TernaryPanel />);
    expect(screen.getByText("1 of 4 rows has a non-finite, negative or all-zero value and was left out.")).toBeInTheDocument();
    await screen.findByAltText("Ternary preview");
    expect(previewBodies().at(-1)).toEqual({
      data: [
        [0.2, 0.3, 0.5],
        [0.5, 0.25, 0.25],
        [0.1, 0.1, 0.8],
      ],
      labels: ["Fe", "Co", "Ni"],
      values: null,
      title: "alloys.csv",
      filename: "alloys-ternary",
      fmt: "png",
      dpi: PREVIEW_DPI,
    });

    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "svg" } });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(lastToast()).toBe("exported alloys"));
    const [body, signal] = exportMock.mock.calls[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(body.fmt).toBe("svg");
    // Screen == export: the export body is the previewed body, format aside.
    expect({ ...body, fmt: "png", dpi: PREVIEW_DPI }).toEqual(previewBodies().at(-1));
    expect(askMock).not.toHaveBeenCalled();
  });

  it("colours by a fourth column and re-previews on a new pick", async () => {
    render(<TernaryPanel />);
    await screen.findByAltText("Ternary preview");
    const before = postBlobMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Colour by"), { target: { value: "3" } });
    await waitFor(() => expect(previewBodies().at(-1)?.values).toEqual([300, 310, 330]));
    expect(postBlobMock.mock.calls.length).toBeGreaterThan(before);
  });

  it("omits excluded rows from preview and export and asks with only the omit option", async () => {
    useApp.setState({ datasets: [{ ...ds, excludedRows: [0] }] });
    askMock.mockResolvedValue("omit");
    render(<TernaryPanel />);
    await screen.findByAltText("Ternary preview");
    expect(previewBodies().at(-1)?.data).toEqual([
      [0.5, 0.25, 0.25],
      [0.1, 0.1, 0.8],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(lastToast()).toBe("exported alloys"));
    expect(askMock).toHaveBeenCalledWith("grey", AUX_OMIT_REASON);
    expect(exportMock.mock.calls[0][0].data).toEqual([
      [0.5, 0.25, 0.25],
      [0.1, 0.1, 0.8],
    ]);
  });

  it("cancels the export when the excluded-rows question is dismissed", async () => {
    useApp.setState({ datasets: [{ ...ds, excludedRows: [0] }] });
    askMock.mockResolvedValue(null);
    render(<TernaryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(useApp.getState().status).toBe("export cancelled"));
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("asks for a dataset when none is active", () => {
    useApp.setState({ datasets: [], activeId: null });
    render(<TernaryPanel />);
    expect(screen.getByText("Select a dataset with three composition columns.")).toBeInTheDocument();
    expect(postBlobMock).not.toHaveBeenCalled();
  });
});
