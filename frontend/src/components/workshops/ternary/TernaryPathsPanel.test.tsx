// Ternary line and vector plots through the real workshop (plan item 25):
// the Draw selector, the paths route, the end-column picks, and preview ==
// export for the same state.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postBlob, postDownload } from "../../../lib/api/http";
import type { Dataset } from "../../../lib/types";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { PREVIEW_DPI } from "./auxFigurePreview";
import { useAuxFigureStore } from "./auxFigureStore";
import { TERNARY_PATHS_ROUTE } from "./ternaryTarget";
import TernaryPanel from "./TernaryPanel";

vi.mock("../../../lib/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/http")>()),
  postBlob: vi.fn(),
  postDownload: vi.fn(),
}));
vi.mock("../../../lib/excludedRowsChoice", () => ({ askExcludedRows: vi.fn() }));

const postBlobMock = vi.mocked(postBlob);
const downloadMock = vi.mocked(postDownload);

const ds: Dataset = {
  id: "d1",
  name: "drift.csv",
  data: {
    time: [1, 2, 3, 4],
    values: [
      [0.2, 0.3, 0.5, 0.3, 0.3, 0.4, 5],
      [0.5, 0.25, 0.25, 0.4, 0.3, 0.3, 6],
      [-1, 0.5, 0.5, 0.1, 0.1, 0.8, 7],
      [0.1, 0.1, 0.8, 0.2, 0.2, 0.6, 8],
    ],
    labels: ["A0", "B0", "C0", "A1", "B1", "C1", "dT"],
    units: ["", "", "", "", "", "", "K"],
    metadata: { x_column_name: "sample" },
  },
};

const lastBody = () => postBlobMock.mock.calls.at(-1)![1] as Record<string, unknown>;
const draw = (kind: string) => fireEvent.change(screen.getByLabelText("Draw"), { target: { value: kind } });

beforeEach(() => {
  vi.clearAllMocks();
  postBlobMock.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  downloadMock.mockResolvedValue(undefined);
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [ds], activeId: "d1", status: "", toolWindowLayout: {}, excludedDisplay: "grey", ternaryFigures: {} });
  useAuxFigureStore.setState({ ternaryOpen: true, fieldOpen: false });
});

describe("ternary line and vector in the workshop", () => {
  it("Line previews to the paths route, breaks at the unusable row, and exports the same body", async () => {
    render(<TernaryPanel />);
    draw("line");
    await screen.findByAltText("Ternary preview");
    await waitFor(() => expect(lastBody().kind).toBe("line"));
    expect(postBlobMock.mock.calls.at(-1)![0]).toBe(TERNARY_PATHS_ROUTE);
    const series = (lastBody().series as { rows: unknown[] }[])[0];
    expect(series.rows[2]).toEqual([null, null, null]); // the negative row is a gap
    expect(screen.getByText(/1 of 4 rows has a missing, negative or all-zero value/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(useToasts.getState().toasts.at(-1)?.msg).toBe("exported drift"));
    const [route, body] = downloadMock.mock.calls[0];
    expect(route).toBe(TERNARY_PATHS_ROUTE);
    expect({ ...(body as object), fmt: "png", dpi: PREVIEW_DPI }).toEqual(lastBody());
  });

  it("Series by splits the line into one named series per value (a series with nothing drawable is left out)", async () => {
    render(<TernaryPanel />);
    draw("line");
    fireEvent.change(screen.getByLabelText("Series by"), { target: { value: "6" } });
    await waitFor(() => expect((lastBody().series as unknown[]).length).toBe(3));
    expect((lastBody().series as { name: string }[]).map((s) => s.name)).toEqual(["dT = 5", "dT = 6", "dT = 8"]);
  });

  it("Vector offers the end columns, previews start/end, and style edits reach the body and the project", async () => {
    render(<TernaryPanel />);
    draw("vector");
    await waitFor(() => expect(lastBody().kind).toBe("vector"));
    expect(screen.getByLabelText("A end")).toHaveValue("3");
    // The row with a negative START is left out.
    expect((lastBody().start as unknown[]).length).toBe(3);
    expect(lastBody().end).toEqual([
      [0.3, 0.3, 0.4],
      [0.4, 0.3, 0.3],
      [0.2, 0.2, 0.6],
    ]);
    fireEvent.change(screen.getByLabelText("Head"), { target: { value: "open" } });
    await waitFor(() => expect(lastBody().head_style).toBe("open"));
    const saved = useApp.getState().ternaryFigures["d1"];
    expect(saved.field.kind).toBe("vector");
    expect(saved.picks).toMatchObject({ ea: 3, eb: 4, ec: 5 });
    expect(saved.field.path).toMatchObject({ head: "open" });
  });

  it("Colour by on a vector sends the values and colormap, not a fixed colour", async () => {
    render(<TernaryPanel />);
    draw("vector");
    fireEvent.change(screen.getByLabelText("Color by"), { target: { value: "6" } });
    await waitFor(() => expect(lastBody().values).toEqual([5, 6, 8]));
    expect(lastBody()).toMatchObject({ cmap: "viridis", z_label: "dT (K)" });
    expect(lastBody()).not.toHaveProperty("color");
  });
});
