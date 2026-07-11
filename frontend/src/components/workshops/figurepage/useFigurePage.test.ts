import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigurePage, renderFigurePageBlob } from "../../../lib/api";
import type { FigureDoc } from "../../../lib/figuredoc";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFigurePage } from "./useFigurePage";

vi.mock("../../../lib/api", () => ({
  exportFigurePage: vi.fn().mockResolvedValue(undefined),
  renderFigurePageBlob: vi
    .fn()
    .mockResolvedValue(new Blob(["png-bytes"], { type: "image/png" })),
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

function win(over: Partial<PlotWindow>): PlotWindow {
  return {
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  };
}

const FROZEN_DOC: FigureDoc = {
  id: "f1",
  name: "MvsH figure",
  datasetId: null,
  live: false,
  dataSnapshot: DATA,
  config: {
    xKey: null,
    yKeys: [0],
    xScale: "linear",
    yScale: "log",
    title: "doc title",
    xLabel: "",
    yLabel: "",
    style: "aps",
    fmt: "pdf",
    dpi: 600,
    overrides: { grid: true, x_breaks: [[1, 2]], margins: { left: 0.2 } },
    seriesStyles: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: DATA }],
    activeId: "d1",
    focusedWindowId: null,
    plotWindows: [
      win({
        id: "w1",
        title: "Loop A",
        view: { ...defaultPlotView(), yKeys: [1], xScale: "log", plotTitle: "W title" },
      }),
      win({ id: "w2", title: "Unbound", datasetId: null }), // no dataset -> not a source
      win({ id: "w3", kind: "worksheet", title: "Sheet" }), // not a plot -> not a source
    ],
    figureDocs: [
      FROZEN_DOC,
      // Live doc whose dataset vanished: not renderable -> not a source.
      { ...FROZEN_DOC, id: "f2", name: "dead", live: true, datasetId: null, dataSnapshot: undefined },
    ],
    status: "",
  });
});

describe("useFigurePage", () => {
  it("enumerates live plot windows and renderable saved figures as sources", () => {
    const { result } = renderHook(() => useFigurePage());
    expect(result.current.windowSources).toEqual([
      { kind: "window", id: "w1", name: "Loop A" },
    ]);
    expect(result.current.docSources).toEqual([
      { kind: "figdoc", id: "f1", name: "MvsH figure" },
    ]);
  });

  it("assigns into slots and previews the auto label sequence", () => {
    const { result } = renderHook(() => useFigurePage());
    const [src] = result.current.windowSources;
    const [docSrc] = result.current.docSources;
    act(() => result.current.assign(3, src));
    act(() => result.current.assign(0, docSrc));
    // Row-major: slot 0 -> (a), slot 3 -> (b); empties stay blank.
    expect(result.current.labels).toEqual(["(a)", "", "", "(b)"]);
    // Re-assigning the window elsewhere moves it (appears once).
    act(() => result.current.assign(1, src));
    expect(result.current.slots[3].source).toBeNull();
    expect(result.current.slots[1].source?.id).toBe("w1");
  });

  it("assignToNext fills the selected slot, else the first empty one", () => {
    const { result } = renderHook(() => useFigurePage());
    const [src] = result.current.windowSources;
    const [docSrc] = result.current.docSources;
    act(() => result.current.assignToNext(src)); // no selection -> slot 0
    expect(result.current.slots[0].source?.id).toBe("w1");
    act(() => result.current.setSelected(2));
    act(() => result.current.assignToNext(docSrc)); // selected -> slot 2
    expect(result.current.slots[2].source?.id).toBe("f1");
  });

  it("builds panel payloads from the window view / doc config", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    act(() => result.current.assign(3, result.current.docSources[0]));
    const spec = await result.current.buildSpec();
    expect(spec).not.toBeNull();
    expect(spec!.rows).toBe(2);
    expect(spec!.cols).toBe(2);
    expect(spec!.panels).toHaveLength(2);

    const [p0, p1] = spec!.panels;
    // Window panel: grid cell (0,0), payload mirrors the window's OWN view.
    expect([p0.row, p0.col]).toEqual([0, 0]);
    expect(p0.figure.dataset).toEqual(DATA);
    expect(p0.figure.y_keys).toEqual([1]);
    expect(p0.figure.x_log).toBe(true);
    expect(p0.figure.title).toBe("W title");
    // Doc panel: grid cell (1,1), frozen snapshot + config; the page-
    // incompatible x_breaks/margins overrides are stripped, grid survives.
    expect([p1.row, p1.col]).toEqual([1, 1]);
    expect(p1.figure.dataset).toEqual(DATA);
    expect(p1.figure.y_log).toBe(true);
    expect(p1.figure.title).toBe("doc title");
    expect(p1.figure.overrides).toEqual({ grid: true });
  });

  it("grid resize preserves assignments by position", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    act(() => result.current.assign(3, result.current.docSources[0]));
    act(() => result.current.setGrid(2, 3));
    // (0,0) stays at index 0; (1,1) moves to index 4 in the 2x3 grid.
    expect(result.current.slots).toHaveLength(6);
    expect(result.current.slots[0].source?.id).toBe("w1");
    expect(result.current.slots[4].source?.id).toBe("f1");
  });

  it("exports with page-level fmt/style/dpi and per-slot overrides", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    act(() => {
      result.current.setFmt("svg");
      result.current.setStyle("aps"); // re-syncs dpi to the preset's 600
      result.current.setSlotLabel(0, "(ii)");
      result.current.setSlotTitle(0, "$\\mu_0 H$ loop");
    });
    await act(async () => {
      await result.current.exportNow();
    });
    const body = vi.mocked(exportFigurePage).mock.calls[0][0];
    expect(body.fmt).toBe("svg");
    expect(body.style).toBe("aps");
    expect(body.dpi).toBe(600);
    expect(body.label_format).toBe("(a)");
    expect(body.panels[0].label).toBe("(ii)");
    expect(body.panels[0].title).toBe("$\\mu_0 H$ loop");
  });

  it("is inert when nothing is assigned", async () => {
    const { result } = renderHook(() => useFigurePage());
    await act(async () => {
      await result.current.exportNow();
    });
    expect(exportFigurePage).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
    expect(renderFigurePageBlob).not.toHaveBeenCalled();
  });

  it("renders a debounced low-DPI PNG preview through the page route", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    const body = vi.mocked(renderFigurePageBlob).mock.calls[0][0];
    expect(body.fmt).toBe("png");
    expect(body.dpi).toBe(90);
    await waitFor(() => expect(result.current.preview).toMatch(/^data:/));
  });

  // MAIN #8g: the preview is keyed on the store state the panels render from
  // (the same reads buildSpec's export-time guard makes) — a change UNDER an
  // assigned slot re-fetches it; unrelated store churn does not.
  describe("preview invalidation (#8g)", () => {
    it("re-renders when the assigned dataset's data changes underneath the slot", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), {
        timeout: 2000,
      });
      // The dataset is corrected/recomputed: its data object is REPLACED.
      const corrected: DataStruct = {
        ...DATA,
        values: DATA.values.map((row) => row.map((v) => v * 2)),
      };
      act(() => {
        useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: corrected }] });
      });
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(2), {
        timeout: 2000,
      });
      const body = vi.mocked(renderFigurePageBlob).mock.calls[1][0];
      expect(body.panels[0].figure.dataset).toEqual(corrected);
    });

    it("re-renders on the assigned window's view change but NOT on unrelated churn", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), {
        timeout: 2000,
      });
      // Unrelated churn: status message + ANOTHER window moving -> no fetch.
      act(() => {
        useApp.setState((s) => ({
          status: "poke",
          plotWindows: s.plotWindows.map((w) =>
            w.id === "w2" ? { ...w, geometry: { ...w.geometry, x: 50 } } : w,
          ),
        }));
      });
      await new Promise((r) => setTimeout(r, 600)); // past the 400 ms debounce
      expect(renderFigurePageBlob).toHaveBeenCalledTimes(1);
      // The ASSIGNED window's view changes (title edited) -> re-render.
      act(() => {
        useApp.setState((s) => ({
          plotWindows: s.plotWindows.map((w) =>
            w.id === "w1" ? { ...w, view: { ...w.view, plotTitle: "renamed" } } : w,
          ),
        }));
      });
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(2), {
        timeout: 2000,
      });
      expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0].panels[0].figure.title).toBe(
        "renamed",
      );
    });

    it("re-renders when an assigned saved figure (doc) is edited", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.docSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), {
        timeout: 2000,
      });
      act(() => {
        useApp.setState((s) => ({
          figureDocs: s.figureDocs.map((d) =>
            d.id === "f1" ? { ...d, config: { ...d.config, title: "edited title" } } : d,
          ),
        }));
      });
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(2), {
        timeout: 2000,
      });
      expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0].panels[0].figure.title).toBe(
        "edited title",
      );
    });
  });
});
