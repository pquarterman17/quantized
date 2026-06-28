import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, renderFigureBlob } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFigureBuilder } from "./useFigureBuilder";

vi.mock("../../../lib/api", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
  renderFigureBlob: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
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

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no object-URL impl — stub for the preview lifecycle.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: DATA }],
    activeId: "d1",
    yKeys: null,
    xLog: false,
    yLog: false,
    seriesStyles: {},
    status: "",
  });
});

describe("useFigureBuilder", () => {
  it("renders a debounced PNG preview from the active dataset", async () => {
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureBlob).toHaveBeenCalledTimes(1));
    const body = vi.mocked(renderFigureBlob).mock.calls[0][0];
    expect(body.fmt).toBe("png"); // preview is always PNG
    await waitFor(() => expect(result.current.preview).toBe("blob:preview"));
  });

  it("exports at the chosen format/DPI with the dataset stem as filename", () => {
    const { result } = renderHook(() => useFigureBuilder());
    act(() => {
      result.current.setFmt("svg");
      result.current.setTitle("My Figure");
    });
    act(() => result.current.exportNow());
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.fmt).toBe("svg");
    expect(body.title).toBe("My Figure");
    expect(body.filename).toBe("scan"); // extension stripped
  });

  it("is inert with no active dataset", () => {
    useApp.setState({ datasets: [], activeId: null });
    const { result } = renderHook(() => useFigureBuilder());
    act(() => result.current.exportNow());
    expect(exportFigure).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });
});
