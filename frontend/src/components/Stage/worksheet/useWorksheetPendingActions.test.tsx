import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../../../lib/api";
import { copyText } from "../../../lib/clipboard";
import { resetBookTransportForTests } from "../../../lib/bookData";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWorksheetView } from "./useWorksheetView";

vi.mock("../../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api")>()),
  fetchBookData: vi.fn(),
}));

vi.mock("../../../lib/clipboard", async (orig) => ({
  ...(await orig<typeof import("../../../lib/clipboard")>()),
  copyText: vi.fn(),
}));

const full: DataStruct = {
  time: [0, 1, 2, 3, 4],
  values: [[10], [20], [30], [40], [50]],
  labels: ["signal"],
  units: ["V"],
  metadata: { x_column_name: "time", x_column_unit: "s" },
};

const pending = (withMap = true): Dataset => ({
  id: "lazy",
  name: "book.opj",
  data: {
    time: [0, 4],
    values: [[10], [50]],
    labels: ["signal"],
    units: ["V"],
    metadata: {
      x_column_name: "time",
      x_column_unit: "s",
      ...(withMap ? { preview_source_rows: [0, 4] } : {}),
    },
  },
  pending: {
    kind: "path",
    path: "book.opj",
    bookId: "book",
    rows: 5,
    cols: 1,
    previewSampled: true,
  },
});

beforeEach(() => {
  resetBookTransportForTests();
  vi.mocked(fetchBookData).mockReset().mockResolvedValue(full);
  vi.mocked(copyText).mockReset().mockResolvedValue(true);
  useApp.setState({
    datasets: [pending()],
    activeId: "lazy",
    stageTab: "worksheet",
    selection: null,
    worksheetSelections: {},
    status: "",
  });
});

describe("pending worksheet extract/copy actions (BUG-009)", () => {
  it("keeps ordinary row copy working for an already complete dataset", async () => {
    const source: Dataset = { id: "full", name: "full.dat", data: full };
    useApp.setState({ datasets: [source], activeId: source.id, status: "" });
    const { result } = renderHook(() => useWorksheetView(source));
    act(() => result.current.copyRow(2));
    await vi.waitFor(() => expect(useApp.getState().status).toBe("copied row 3"));
    expect(copyText).toHaveBeenCalledWith("time (s)\tsignal (V)\n2\t30");
    expect(fetchBookData).not.toHaveBeenCalled();
  });

  it("copies the complete, re-filtered book instead of the sampled preview", async () => {
    const source = useApp.getState().datasets[0];
    const { result } = renderHook(() => useWorksheetView(source));
    act(() => {
      result.current.setFilterCol("-1");
      result.current.setFilterOp(">");
      result.current.setFilterV1("1");
    });

    act(() => result.current.copyRows());
    expect(copyText).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(useApp.getState().status).toBe("copied 3 rows to clipboard"));
    expect(copyText).toHaveBeenCalledWith("time (s)\tsignal (V)\n2\t30\n3\t40\n4\t50");
  });

  it("maps a copied sampled-preview row back to its exact source row", async () => {
    const source = useApp.getState().datasets[0];
    const { result } = renderHook(() => useWorksheetView(source));
    act(() => result.current.copyRow(1));
    await vi.waitFor(() => expect(useApp.getState().status).toBe("copied row 5"));
    expect(copyText).toHaveBeenCalledWith("time (s)\tsignal (V)\n4\t50");
    expect(useApp.getState().status).toBe("copied row 5");
  });

  it("extracts the complete book using the filter the user chose", async () => {
    const source = useApp.getState().datasets[0];
    const { result } = renderHook(() => useWorksheetView(source));
    act(() => {
      result.current.setFilterCol("-1");
      result.current.setFilterOp(">");
      result.current.setFilterV1("1");
    });
    expect(result.current.canExtract).toBe(true);

    act(() => result.current.extractSubset());
    await vi.waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const subset = useApp.getState().datasets[1];
    expect(subset.data.time).toEqual([2, 3, 4]);
    expect(subset.data.values).toEqual([[30], [40], [50]]);
  });

  it("does not guess a single row when an old sampled preview has no row map", async () => {
    const source = pending(false);
    useApp.setState({ datasets: [source], activeId: source.id, status: "" });
    const { result } = renderHook(() => useWorksheetView(source));
    act(() => result.current.copyRow(1));
    await vi.waitFor(() => expect(useApp.getState().datasets[0].pending).toBeUndefined());
    expect(copyText).not.toHaveBeenCalled();
    expect(useApp.getState().status).toMatch(/could not be matched/);
  });
});
