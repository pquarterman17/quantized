import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, fetchBookData, renderFigureHitmap } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { FIGURE_STYLE_DPI, useFigureBuilder } from "./useFigureBuilder";

vi.mock("../../../lib/api", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
  // the preview now renders through the #13 hit-map endpoint
  renderFigureHitmap: vi.fn().mockResolvedValue({
    image: "cGln",
    width: 600,
    height: 400,
    elements: [{ id: "title", x0: 1, y0: 1, x1: 2, y1: 2 }],
    axes: { x0: 0, y0: 0, x1: 600, y1: 400, xlim: [0, 1], ylim: [0, 1], xlog: false, ylog: false },
  }),
  fetchBookData: vi.fn(),
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
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: DATA }],
    activeId: "d1",
    yKeys: null,
    xScale: "linear",
    yScale: "linear",
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    seriesStyles: {},
    figureDocSeed: null,
    figureBuilderOpen: false,
    status: "",
  });
});

describe("useFigureBuilder", () => {
  it("renders a debounced preview + hit-map from the active dataset", async () => {
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.preview).toBe("data:image/png;base64,cGln"),
    );
    expect(result.current.hitmap?.elements[0].id).toBe("title");
  });

  it("exports at the chosen format/DPI with the dataset stem as filename", async () => {
    const { result } = renderHook(() => useFigureBuilder());
    act(() => {
      result.current.setFmt("svg");
      result.current.setTitle("My Figure");
    });
    await act(async () => {
      await result.current.exportNow();
    });
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.fmt).toBe("svg");
    expect(body.title).toBe("My Figure");
    expect(body.filename).toBe("scan"); // extension stripped
  });

  it("is inert with no active dataset", async () => {
    useApp.setState({ datasets: [], activeId: null });
    const { result } = renderHook(() => useFigureBuilder());
    await act(async () => {
      await result.current.exportNow();
    });
    expect(exportFigure).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });

  it("resolves a still-pending active dataset before exporting (#38)", async () => {
    const full: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [1, 9],
        [2, 8],
        [3, 7],
        [4, 6],
      ],
      labels: ["A", "B"],
      units: ["u", "v"],
      metadata: {},
    };
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [0], values: [[1, 9]], labels: ["A", "B"], units: ["u", "v"], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 4, cols: 2 },
        },
      ],
      activeId: "d1",
    });
    vi.mocked(fetchBookData).mockResolvedValue(full);
    const { result } = renderHook(() => useFigureBuilder());

    await act(async () => {
      await result.current.exportNow();
    });

    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.dataset).toEqual(full);
    expect(useApp.getState().datasets[0].pending).toBeUndefined();
  });

  it("omits x_fmt/y_fmt when both axes are auto (MAIN #24)", async () => {
    const { result } = renderHook(() => useFigureBuilder());
    await act(async () => {
      await result.current.exportNow();
    });
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.x_fmt).toBeUndefined();
    expect(body.y_fmt).toBeUndefined();
  });

  it("sends the live x_fmt/y_fmt when non-auto (MAIN #24)", async () => {
    useApp.setState({
      xFmt: { mode: "fixed", digits: 3 },
      yFmt: { mode: "sci", digits: 1 },
    });
    const { result } = renderHook(() => useFigureBuilder());
    await act(async () => {
      await result.current.exportNow();
    });
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.x_fmt).toEqual({ mode: "fixed", digits: 3 });
    expect(body.y_fmt).toEqual({ mode: "sci", digits: 1 });
  });

  it("restores a FigureDoc's display-ordered series styles into preview and export", async () => {
    useApp.setState({
      figureDocSeed: {
        id: "draft",
        name: "Point plot",
        datasetId: "d1",
        live: true,
        config: {
          xKey: null,
          yKeys: [1],
          xScale: "linear",
          yScale: "linear",
          title: "",
          xLabel: "",
          yLabel: "",
          style: "default",
          fmt: "pdf",
          dpi: 300,
          overrides: null,
          seriesStyles: [{ color: "#123456", line: "none", marker: true }],
        },
      },
    });
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());
    const preview = vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0];
    expect(preview?.series_styles).toEqual([{ color: "#123456", line: "none", marker: true }]);
    expect(useApp.getState().figureDocSeed).toBeNull();

    await act(async () => result.current.exportNow());
    expect(vi.mocked(exportFigure).mock.calls.at(-1)?.[0].series_styles).toEqual([
      { color: "#123456", line: "none", marker: true },
    ]);
  });

  // GUI_INTERACTION #12 Slice 5: a grouped FigureDoc (the Graph Builder
  // handoff, plotSpecToFigureDoc) carries config.groupCol through the SAME
  // preview/export request path as every other doc field -- opening,
  // previewing, exporting, and re-saving must all thread it.
  it("threads a grouped FigureDoc's groupCol through preview, export, and re-save", async () => {
    useApp.setState({
      figureDocSeed: {
        id: "draft",
        name: "Grouped plot",
        datasetId: "d1",
        live: true,
        config: {
          xKey: null,
          yKeys: [0],
          groupCol: 1,
          xScale: "linear",
          yScale: "linear",
          title: "",
          xLabel: "",
          yLabel: "",
          style: "default",
          fmt: "pdf",
          dpi: 300,
          overrides: null,
          seriesStyles: null,
        },
      },
    });
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());
    const preview = vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0];
    expect(preview?.group_col).toBe(1);

    await act(async () => result.current.exportNow());
    expect(vi.mocked(exportFigure).mock.calls.at(-1)?.[0].group_col).toBe(1);

    act(() => result.current.saveAsFigure("Re-saved", true));
    const saved = useApp.getState().figureDocs.at(-1);
    expect(saved?.config.groupCol).toBe(1);
  });

  it("a plain (non-doc-seeded) builder sends no group_col", async () => {
    const { result } = renderHook(() => useFigureBuilder());
    await act(async () => {
      await result.current.exportNow();
    });
    expect(vi.mocked(exportFigure).mock.calls[0][0].group_col).toBeUndefined();
  });

  it("syncs DPI to the preset's calibrated value when the style changes", () => {
    const { result } = renderHook(() => useFigureBuilder());
    expect(result.current.dpi).toBe(FIGURE_STYLE_DPI.default);

    act(() => result.current.setStyle("aps"));
    expect(result.current.style).toBe("aps");
    expect(result.current.dpi).toBe(600); // FIGURE_STYLE_DPI.aps

    act(() => result.current.setStyle("web"));
    expect(result.current.dpi).toBe(150); // FIGURE_STYLE_DPI.web
  });

  it("still lets the user override DPI after a preset sync", () => {
    const { result } = renderHook(() => useFigureBuilder());
    act(() => result.current.setStyle("nature"));
    expect(result.current.dpi).toBe(600);

    act(() => result.current.setDpi(1200));
    expect(result.current.dpi).toBe(1200); // manual override sticks

    act(() => result.current.setFmt("png")); // unrelated change doesn't reset it
    expect(result.current.dpi).toBe(1200);
  });
});
