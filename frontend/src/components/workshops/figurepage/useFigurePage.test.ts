import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigurePage, renderFigurePageBlob } from "../../../lib/api";
import { createFigureDocument, type FigureDocument } from "../../../lib/figureDocument";
import type { FigureDoc } from "../../../lib/figuredoc";
import { createPageDocument } from "../../../lib/pageDocument";
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

const askConfirm = vi.fn();
vi.mock("../../overlays/ConfirmDialog", () => ({
  askConfirm: (...args: unknown[]) => askConfirm(...args) as Promise<boolean>,
}));

const askParams = vi.fn();
vi.mock("../../overlays/ParamDialog", () => ({
  askParams: (...args: unknown[]) => askParams(...args) as Promise<Record<string, unknown> | null>,
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

  // FIGURE_AUTHORING_WORKFLOW_PLAN F3.1: the hook maintains its grid geometry
  // and output settings as ONE PageDocument draft, and derives a full
  // persistable projection (`pageDocument`) — panels reference a canonical
  // FigureDocument id ONLY when the session source resolves to one that has
  // actually been saved into `editableFigures` (F3.2: reference, never flatten).
  describe("F3.1 pageDocument draft", () => {
    it("starts as an empty 2x2 document matching the default grid", () => {
      const { result } = renderHook(() => useFigurePage());
      expect(result.current.pageDocument).toMatchObject({
        schema: "quantized.page",
        version: 1,
        rows: 2,
        cols: 2,
      });
      expect(result.current.pageDocument.panels).toHaveLength(4);
      expect(result.current.pageDocument.panels.every((p) => p.figureId === null)).toBe(true);
    });

    it("tracks grid resize and output-setting writes", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.setGrid(1, 3));
      act(() => {
        result.current.setFmt("svg");
        result.current.setLabelFormat("A)");
        result.current.setLabelPos("outside");
      });
      expect(result.current.pageDocument.rows).toBe(1);
      expect(result.current.pageDocument.cols).toBe(3);
      expect(result.current.pageDocument.panels).toHaveLength(3);
      expect(result.current.pageDocument.output).toMatchObject({
        format: "svg",
        labelFormat: "A)",
        labelPos: "outside",
      });
    });

    it("resolves a window source to its FigureDocument id once that document is saved", () => {
      const document = createFigureDocument({
        id: "figure-saved", name: "Loop A", datasetId: "d1", view: defaultPlotView(),
      });
      useApp.setState({
        plotWindows: [win({ id: "w1", title: "Loop A", document })],
        editableFigures: [document],
      });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      expect(result.current.pageDocument.panels[0].figureId).toBe("figure-saved");
    });

    it("resolves an open-but-unsaved window (or a legacy figdoc) to null — never a lossy flattened copy", () => {
      const document = createFigureDocument({
        id: "figure-unsaved", name: "Loop A", datasetId: "d1", view: defaultPlotView(),
      });
      useApp.setState({
        plotWindows: [win({ id: "w1", title: "Loop A", document })],
        editableFigures: [], // never saved
      });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      act(() => result.current.assign(1, result.current.docSources[0]));
      expect(result.current.pageDocument.panels[0].figureId).toBeNull();
      expect(result.current.pageDocument.panels[1].figureId).toBeNull();
    });
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
    // MAIN #24: both sources default to auto (no saved fmt on a doc, no
    // configured fmt on the window's default view) -> x_fmt/y_fmt omitted.
    expect(p0.figure.x_fmt).toBeUndefined();
    expect(p0.figure.y_fmt).toBeUndefined();
    expect(p1.figure.x_fmt).toBeUndefined();
    expect(p1.figure.y_fmt).toBeUndefined();
  });

  it("threads a window panel's OWN non-auto x_fmt/y_fmt (MAIN #24 per-panel own view fmt)", async () => {
    useApp.setState({
      plotWindows: [
        win({
          id: "w1",
          title: "Loop A",
          view: {
            ...defaultPlotView(),
            xFmt: { mode: "fixed", digits: 3 },
            yFmt: { mode: "sci", digits: 1 },
            xStep: 2000,
            yStep: 0.5,
          },
        }),
      ],
    });
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    const spec = await result.current.buildSpec();
    expect(spec!.panels[0].figure.x_fmt).toEqual({ mode: "fixed", digits: 3 });
    expect(spec!.panels[0].figure.y_fmt).toEqual({ mode: "sci", digits: 1 });
    expect(spec!.panels[0].figure.x_step).toBe(2000);
    expect(spec!.panels[0].figure.y_step).toBe(0.5);
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

  // FIGURE_AUTHORING_WORKFLOW_PLAN F3.2: missing-source behavior, surfaced.
  describe("F3.2 missing-source semantics", () => {
    it("exposes per-slot live status: empty/ok-live/ok-frozen alongside the slots", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0])); // live window
      act(() => result.current.assign(1, result.current.docSources[0])); // frozen figdoc (FROZEN_DOC)
      expect(result.current.sourceStatuses[0]).toEqual({ status: "ok", lifecycle: "live" });
      expect(result.current.sourceStatuses[1]).toEqual({ status: "ok", lifecycle: "frozen" });
      expect(result.current.sourceStatuses[2]).toEqual({ status: "empty" });
    });

    it("reports missing once an assigned window's source disappears (closed) — status flips live", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      expect(result.current.sourceStatuses[0]).toEqual({ status: "ok", lifecycle: "live" });
      act(() => {
        useApp.setState((s) => ({ plotWindows: s.plotWindows.filter((w) => w.id !== "w1") }));
      });
      expect(result.current.sourceStatuses[0]).toEqual({ status: "missing" });
    });

    it("reports missing once an assigned figdoc is deleted from the library", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.docSources[0]));
      expect(result.current.sourceStatuses[0]).toEqual({ status: "ok", lifecycle: "frozen" });
      act(() => {
        useApp.setState((s) => ({ figureDocs: s.figureDocs.filter((d) => d.id !== "f1") }));
      });
      expect(result.current.sourceStatuses[0]).toEqual({ status: "missing" });
    });

    // Fail-before/pass-after: the preview effect used to unconditionally
    // setError(null) right after buildSpec() had ALREADY set the specific
    // "slot N: ... no longer exists" message for a dead source, so the
    // preview panel silently reverted to the plain empty-state text with no
    // explanation at all — a "hole without explanation", exactly what F3.2
    // rules out. Reverting the fix (re-adding that setError(null) call) makes
    // this test fail: `error` would settle to null instead of the message.
    it("keeps the specific missing-source message on screen instead of clobbering it back to null", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), { timeout: 2000 });
      act(() => {
        useApp.setState((s) => ({ plotWindows: s.plotWindows.filter((w) => w.id !== "w1") }));
      });
      await waitFor(
        () => expect(result.current.error).toMatch(/slot 1: source "Loop A" no longer exists/),
        { timeout: 2000 },
      );
      expect(result.current.preview).toBeNull();
      // No SECOND preview fetch was attempted for the dead source.
      expect(renderFigurePageBlob).toHaveBeenCalledTimes(1);
    });

    it("gives a specific export status for a missing source, not the generic 'assign a panel' message", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      act(() => {
        useApp.setState((s) => ({ plotWindows: s.plotWindows.filter((w) => w.id !== "w1") }));
      });
      await act(async () => {
        await result.current.exportNow();
      });
      expect(exportFigurePage).not.toHaveBeenCalled();
      const status = useApp.getState().status;
      expect(status).toMatch(/panel's source is missing/);
      expect(status).not.toBe("assign at least one panel to export a figure page");
    });

    it("still gives the plain 'assign a panel' message when truly nothing is assigned", async () => {
      const { result } = renderHook(() => useFigurePage());
      await act(async () => {
        await result.current.exportNow();
      });
      expect(useApp.getState().status).toBe("assign at least one panel to export a figure page");
    });
  });
});

// FIGURE_AUTHORING_WORKFLOW_PLAN F3.3: Save/Save As/dirty state/reopen.
describe("useFigurePage F3.3 save/reopen/dirty", () => {
  const FIGURE: FigureDocument = createFigureDocument({
    id: "figure-1",
    name: "Saved loop",
    datasetId: "d1",
    view: { ...defaultPlotView(), yKeys: [1], plotTitle: "Saved loop title" },
  });

  beforeEach(() => {
    askConfirm.mockReset();
    askParams.mockReset();
    useApp.setState({ editableFigures: [], pages: [], pageDocSeed: null, figurePageOpen: false });
  });

  it("figureSources enumerates renderable saved (editable) figures", () => {
    useApp.setState({ editableFigures: [FIGURE] });
    const { result } = renderHook(() => useFigurePage());
    expect(result.current.figureSources).toEqual([
      { kind: "figure", id: "figure-1", name: "Saved loop" },
    ]);
  });

  it("refuses to save an open-but-unsaved window panel, naming the slot and the fix", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    act(() => result.current.save());
    expect(useApp.getState().pages).toEqual([]);
    expect(useApp.getState().status).toMatch(/cannot save page/);
    expect(useApp.getState().status).toMatch(/"Loop A" is an open plot window not yet saved/);
  });

  it("refuses to save a legacy Publication figure panel, pointing at the Editable conversion", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.docSources[0]));
    act(() => result.current.save());
    expect(useApp.getState().pages).toEqual([]);
    expect(useApp.getState().status).toMatch(/is a Publication figure/);
    expect(useApp.getState().status).toMatch(/create an editable copy/);
  });

  it("saves a page whose panels are all resolved (figure-kind sources), and clears dirty", () => {
    useApp.setState({ editableFigures: [FIGURE] });
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.figureSources[0]));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.save());
    expect(useApp.getState().pages).toHaveLength(1);
    expect(useApp.getState().pages[0].panels[0].figureId).toBe("figure-1");
    expect(result.current.dirty).toBe(false);
    expect(result.current.everSaved).toBe(true);
  });

  it("becomes dirty again after a saved page is edited further", () => {
    useApp.setState({ editableFigures: [FIGURE] });
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.figureSources[0]));
    act(() => result.current.save());
    expect(result.current.dirty).toBe(false);

    act(() => result.current.setName("Renamed"));
    expect(result.current.dirty).toBe(true);
  });

  it("Save As creates a new named entry and rebinds the session to it", async () => {
    useApp.setState({ editableFigures: [FIGURE] });
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.figureSources[0]));
    askParams.mockResolvedValueOnce({ name: "Copy of page" });

    await act(async () => {
      await result.current.saveAs();
    });

    expect(useApp.getState().pages).toHaveLength(1);
    expect(useApp.getState().pages[0].name).toBe("Copy of page");
    expect(result.current.dirty).toBe(false);

    // A later plain Save updates the SAME (new) entry, not a second one.
    act(() => result.current.setName("Copy of page")); // no-op edit, still clean-equivalent
    act(() => result.current.save());
    expect(useApp.getState().pages).toHaveLength(1);
  });

  it("Save As refuses the same unresolved-panel check as Save", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.docSources[0]));
    await act(async () => {
      await result.current.saveAs();
    });
    expect(askParams).not.toHaveBeenCalled();
    expect(useApp.getState().pages).toEqual([]);
  });

  it("reopens a saved page: grid, output, and panel references are restored", () => {
    const saved = createPageDocument({
      id: "page-1",
      name: "Reopened page",
      rows: 1,
      cols: 2,
      panels: [
        { figureId: "figure-1", label: "(x)", title: "custom" },
        { figureId: null, label: null, title: null },
      ],
      output: { format: "svg", stylePreset: "aps", dpi: 600, labelFormat: "A)", labelPos: "outside" },
    });
    useApp.setState({ editableFigures: [FIGURE], pages: [saved] });
    useApp.getState().openPageDocument("page-1");

    const { result } = renderHook(() => useFigurePage());
    expect(result.current.name).toBe("Reopened page");
    expect(result.current.rows).toBe(1);
    expect(result.current.cols).toBe(2);
    expect(result.current.fmt).toBe("svg");
    expect(result.current.style).toBe("aps");
    expect(result.current.slots[0].source).toEqual({
      kind: "figure",
      id: "figure-1",
      name: "Saved loop",
    });
    expect(result.current.slots[0].label).toBe("(x)");
    expect(result.current.slots[0].title).toBe("custom");
    expect(result.current.slots[1].source).toBeNull();
    // Reopening an unmodified page is clean, not dirty.
    expect(result.current.dirty).toBe(false);
    expect(useApp.getState().pageDocSeed).toBeNull(); // one-shot seed consumed
  });

  it("reopening a page whose figure was since deleted surfaces it as missing, not dropped", () => {
    const saved = createPageDocument({
      id: "page-1",
      name: "Stale page",
      panels: [{ figureId: "figure-gone", label: null, title: null }],
    });
    useApp.setState({ editableFigures: [], pages: [saved] }); // the figure never existed here
    useApp.getState().openPageDocument("page-1");

    const { result } = renderHook(() => useFigurePage());
    expect(result.current.slots[0].source).toMatchObject({ kind: "figure", id: "figure-gone" });
    expect(result.current.sourceStatuses[0]).toEqual({ status: "missing" });
    // The dangling reference survives a re-save rather than being silently dropped.
    act(() => result.current.save());
    expect(useApp.getState().pages[0].panels[0].figureId).toBe("figure-gone");
  });

  describe("requestClose", () => {
    it("closes a fresh, never-saved page without any confirm", async () => {
      const { result } = renderHook(() => useFigurePage());
      const ok = await result.current.requestClose();
      expect(ok).toBe(true);
      expect(askConfirm).not.toHaveBeenCalled();
    });

    it("gates a SAVED page that has since drifted, and cancel keeps it open", async () => {
      useApp.setState({ editableFigures: [FIGURE] });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.figureSources[0]));
      act(() => result.current.save());
      act(() => result.current.setName("Drifted"));

      askConfirm.mockResolvedValueOnce(false);
      expect(await result.current.requestClose()).toBe(false);
      expect(askConfirm).toHaveBeenCalledOnce();

      askConfirm.mockResolvedValueOnce(true);
      expect(await result.current.requestClose()).toBe(true);
    });

    it("closes an unmodified reopened (saved) page without a confirm", async () => {
      const saved = createPageDocument({ id: "page-1", name: "Clean page" });
      useApp.setState({ pages: [saved] });
      useApp.getState().openPageDocument("page-1");
      const { result } = renderHook(() => useFigurePage());
      expect(await result.current.requestClose()).toBe(true);
      expect(askConfirm).not.toHaveBeenCalled();
    });
  });
});
